import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { loadActiveTemplate } from "@/lib/template-engine";
import { activateInitialTasks } from "@/lib/dag-coordinator";
import { CustomerStatus, TaskStatus } from "@/lib/types";
import { maybeReplay, recordResponse } from "@/lib/idempotency";

/**
 * POST /api/customers
 *   原子事务：分配 customer_id → 写 customer + locations → 物化任务 → 写 audit
 *
 * GET /api/customers
 *   列表
 */

const LocationSchema = z.object({
  domain: z.string().min(1),
  locNo: z.string().regex(/^\d+$/, "loc_no must be digits only"),
});

const DIGITS = /^\d+$/;
const REGION_OPTIONS = ["10001", "10002", "10006", "10007"] as const;

const CreateCustomerSchema = z.object({
  custNo: z.string().regex(DIGITS, "cust_no must be digits only"),
  custName: z.string().min(1),
  globalCustNo: z
    .string()
    .regex(DIGITS, "global_cust_no must be digits only")
    .optional()
    .nullable(),
  globalCustName: z.string().optional().nullable(),
  globalCustCode: z.string().optional().nullable(),
  regionNo: z.enum(REGION_OPTIONS).optional().nullable(),
  companyNo: z.string().regex(DIGITS, "company_no must be digits only").optional().nullable(),
  isMaster: z.boolean().default(false),
  isInterCompany: z.boolean().default(false),
  customerType: z.string().default("standard_b2b"),
  externalRef: z.string().optional().nullable(),
  locations: z.array(LocationSchema).default([]),
});

function fmtCustomerId(n: number) {
  return "C" + String(n).padStart(4, "0");
}

export async function POST(req: NextRequest) {
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

  // cust_no 唯一性预校验，给出友好错误
  const existsByCustNo = await db.customer.findUnique({ where: { custNo: input.custNo } });
  if (existsByCustNo) {
    return NextResponse.json(
      { code: "DUPLICATE_CUST_NO", message: `cust_no '${input.custNo}' already exists` },
      { status: 409 }
    );
  }

  let customerId = "";
  let taskCount = 0;
  try {
    const result = await db.$transaction(async (tx) => {
      // 1. 原子自增内部 customerId 序号（首次创建时按当前数 bootstrap）
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
          custNo: input.custNo,
          custName: input.custName,
          globalCustNo: input.globalCustNo ?? null,
          globalCustName: input.globalCustName ?? null,
          globalCustCode: input.globalCustCode ?? null,
          regionNo: input.regionNo ?? null,
          companyNo: input.companyNo ?? null,
          isMaster: input.isMaster,
          isInterCompany: input.isInterCompany,
          externalRef: input.externalRef ?? null,
          customerType: input.customerType,
          overallStatus: CustomerStatus.INIT,
          templateId: tmpl.templateId,
          templateVersion: tmpl.version,
        },
      });

      // 2b. 写入 locations（如有）
      if (input.locations.length > 0) {
        await tx.customerLocation.createMany({
          data: input.locations.map((l) => ({
            customerId: cid,
            domain: l.domain,
            locNo: l.locNo,
          })),
        });
      }

      // 3. 物化所有任务为 WAITING
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

      // 4. audit
      await tx.auditLog.create({
        data: {
          customerId: cid,
          eventType: "customer_create",
          toStatus: CustomerStatus.INIT,
          actor: "user",
          reason: `materialized ${rows.length} tasks from ${tmpl.templateId} v${tmpl.version}, ${input.locations.length} locations`,
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

  const readyTasks = await activateInitialTasks(customerId);

  const responseBody = {
    customerId,
    custNo: input.custNo,
    overallStatus: CustomerStatus.INIT,
    templateId: tmpl.templateId,
    templateVersion: tmpl.version,
    tasksTotal: taskCount,
    tasksReady: readyTasks.length,
    locationsCount: input.locations.length,
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
      tasks: { select: { status: true } },
      locations: true,
    },
  });
  const items = customers.map((c) => {
    const stats: Record<string, number> = {};
    for (const t of c.tasks) stats[t.status] = (stats[t.status] ?? 0) + 1;
    return {
      customerId: c.customerId,
      custNo: c.custNo,
      custName: c.custName,
      globalCustNo: c.globalCustNo,
      regionNo: c.regionNo,
      companyNo: c.companyNo,
      isMaster: c.isMaster,
      isInterCompany: c.isInterCompany,
      customerType: c.customerType,
      overallStatus: c.overallStatus,
      createdAt: c.createdAt,
      tasksTotal: c.tasks.length,
      tasksDone: (stats["DONE"] ?? 0) + (stats["SKIPPED"] ?? 0),
      tasksFailed: stats["FAILED"] ?? 0,
      locationsCount: c.locations.length,
    };
  });
  return NextResponse.json({ items });
}
