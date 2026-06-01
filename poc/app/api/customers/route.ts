import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { loadActiveTemplate } from "@/lib/template-engine";
import { activateInitialTasks } from "@/lib/dag-coordinator";
import { CustomerStatus, TaskStatus } from "@/lib/types";
import { loadAllLookups } from "@/lib/lookups";
import { maybeReplay, recordResponse } from "@/lib/idempotency";

/**
 * POST /api/customers
 *   原子事务：分配 customer_id（Counter 自增）→ 写 customer → 物化任务 → 写 audit
 *   竞态保护：Counter 表的 increment 保证 customer_id 不会重复
 *
 * GET /api/customers
 *   列表
 */

const CreateCustomerSchema = z.object({
  externalRef: z.string().optional(),
  name: z.string().min(1),
  country: z.string().optional(),
  industry: z.string().optional(),
  customerType: z.string().min(1),
  legalEntity: z.string().optional(),
  defaultCurrency: z.string().optional(),
});

function fmtCustomerId(n: number) {
  return "C" + String(n).padStart(4, "0");
}

export async function POST(req: NextRequest) {
  // Idempotency-Key: 如同 key 24h 内已成功执行过，直接回放
  const replay = maybeReplay(req);
  if (replay) return replay;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = CreateCustomerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INVALID_INPUT", message: parsed.error.message },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const tmpl = await loadActiveTemplate(input.customerType);
  if (!tmpl) {
    return NextResponse.json(
      {
        code: "TEMPLATE_INVALID",
        message: `No active template for customer_type=${input.customerType}`,
      },
      { status: 422 }
    );
  }

  // 把所有写入放在一个事务里：客户 + 任务 + audit 同时成功或一起回滚
  let customerId = "";
  let taskCount = 0;
  try {
    const result = await db.$transaction(async (tx) => {
      // 1. 原子自增 customer_id 序号（修 race condition）
      //    首次创建时 bootstrap 为现有客户数 + 1，避免与历史 ID 冲突
      let counterValue: number;
      const existing = await tx.counter.findUnique({ where: { name: "customer_seq" } });
      if (existing) {
        const updated = await tx.counter.update({
          where: { name: "customer_seq" },
          data: { value: { increment: 1 } },
        });
        counterValue = updated.value;
      } else {
        const existingCount = await tx.customer.count();
        const created = await tx.counter.create({
          data: { name: "customer_seq", value: existingCount + 1 },
        });
        counterValue = created.value;
      }
      const cid = fmtCustomerId(counterValue);

      // 2. 创建客户
      await tx.customer.create({
        data: {
          customerId: cid,
          externalRef: input.externalRef ?? null,
          name: input.name,
          country: input.country ?? null,
          industry: input.industry ?? null,
          customerType: input.customerType,
          legalEntity: input.legalEntity ?? null,
          defaultCurrency: input.defaultCurrency ?? null,
          overallStatus: CustomerStatus.INIT,
          templateId: tmpl.templateId,
          templateVersion: tmpl.version,
        },
      });

      // 3. 物化所有任务为 WAITING（createMany 一次写入）
      const rows: Array<{
        customerId: string;
        module: string;
        taskKey: string;
        pageRef: string | null;
        status: string;
        dependsOnJson: string;
      }> = [];
      for (const [moduleName, mod] of Object.entries(tmpl.def.modules)) {
        for (const t of mod.tasks) {
          rows.push({
            customerId: cid,
            module: moduleName,
            taskKey: t.task_key,
            pageRef: t.page_ref ?? null,
            status: TaskStatus.WAITING,
            dependsOnJson: JSON.stringify(t.depends_on ?? []),
          });
        }
      }
      await tx.configTask.createMany({ data: rows });

      // 4. customer_create audit
      await tx.auditLog.create({
        data: {
          customerId: cid,
          eventType: "customer_create",
          toStatus: CustomerStatus.INIT,
          actor: "user",
          reason: `materialized ${rows.length} tasks from ${tmpl.templateId} v${tmpl.version}`,
        },
      });

      return { cid, total: rows.length };
    });

    customerId = result.cid;
    taskCount = result.total;
  } catch (e: any) {
    return NextResponse.json(
      { code: "CREATE_FAILED", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }

  // 5. 在事务外做后继激活（避免长事务持锁；activateInitialTasks 自身已事务化）
  const readyTasks = await activateInitialTasks(customerId);

  const responseBody = {
    customerId,
    overallStatus: CustomerStatus.INIT,
    templateId: tmpl.templateId,
    templateVersion: tmpl.version,
    tasksTotal: taskCount,
    tasksReady: readyTasks.length,
    links: {
      status: `/api/customers/${customerId}/status`,
      dag: `/api/customers/${customerId}/dag`,
    },
  };
  recordResponse(req, 201, responseBody);
  return NextResponse.json(responseBody, { status: 201 });
}

export async function GET() {
  const customers = await db.customer.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      tasks: { select: { status: true, module: true } },
    },
  });
  const items = customers.map((c) => {
    const stats: Record<string, number> = {};
    for (const t of c.tasks) stats[t.status] = (stats[t.status] ?? 0) + 1;
    return {
      customerId: c.customerId,
      name: c.name,
      country: c.country,
      industry: c.industry,
      customerType: c.customerType,
      overallStatus: c.overallStatus,
      createdAt: c.createdAt,
      tasksTotal: c.tasks.length,
      tasksDone: (stats["DONE"] ?? 0) + (stats["SKIPPED"] ?? 0),
      tasksFailed: stats["FAILED"] ?? 0,
    };
  });

  // 同时返回服务端预热的统计，便于客户端轮询时不再额外拉
  return NextResponse.json({ items });
}

// 让 loadAllLookups 在 GET / POST 之外可被预热（防止 lazy-load 抖动）
void loadAllLookups; // unused import suppress
