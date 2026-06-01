import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { TaskStatus } from "@/lib/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const customer = await db.customer.findUnique({
    where: { customerId: params.id },
    include: {
      tasks: {
        select: {
          taskId: true,
          taskKey: true,
          module: true,
          status: true,
          lastErrorCode: true,
          lastErrorMsg: true,
          retryCount: true,
        },
      },
    },
  });
  if (!customer) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });

  const counts: Record<string, number> = {};
  for (const t of customer.tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
  const total = customer.tasks.length;
  const done = (counts[TaskStatus.DONE] ?? 0) + (counts[TaskStatus.SKIPPED] ?? 0);

  // 按模块聚合
  const modules: Record<string, { total: number; done: number; failed: number }> = {};
  for (const t of customer.tasks) {
    const m = modules[t.module] ?? { total: 0, done: 0, failed: 0 };
    m.total++;
    if (t.status === TaskStatus.DONE || t.status === TaskStatus.SKIPPED) m.done++;
    if (t.status === TaskStatus.FAILED) m.failed++;
    modules[t.module] = m;
  }

  // 阻塞点：FAILED 任务
  const blockers = customer.tasks
    .filter((t) => t.status === TaskStatus.FAILED)
    .map((t) => ({
      taskId: t.taskId,
      taskKey: t.taskKey,
      reasonCode: t.lastErrorCode,
      message: t.lastErrorMsg,
    }));

  return NextResponse.json({
    customerId: customer.customerId,
    overallStatus: customer.overallStatus,
    progress: {
      total,
      done: counts[TaskStatus.DONE] ?? 0,
      skipped: counts[TaskStatus.SKIPPED] ?? 0,
      failed: counts[TaskStatus.FAILED] ?? 0,
      claimed: counts[TaskStatus.CLAIMED] ?? 0,
      inProgress: counts[TaskStatus.IN_PROGRESS] ?? 0,
      ready: counts[TaskStatus.READY] ?? 0,
      waiting: counts[TaskStatus.WAITING] ?? 0,
      blocked: counts[TaskStatus.BLOCKED] ?? 0,
    },
    progressDone: done,
    modules,
    blockers,
  });
}
