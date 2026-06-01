import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildCustomerMinData } from "@/lib/customer-shape";

/**
 * GET /api/tasks/{id}
 * 单个任务详情（含 customer min_data + suggested_config）
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const taskId = Number(params.id);
  if (Number.isNaN(taskId)) {
    return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 });
  }
  const task = await db.configTask.findUnique({
    where: { taskId },
    include: {
      customer: {
        include: { locations: true },
      },
    },
  });
  if (!task) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json({
    taskId: task.taskId,
    taskKey: task.taskKey,
    module: task.module,
    pageRef: task.pageRef,
    status: task.status,
    dependsOn: JSON.parse(task.dependsOnJson || "[]"),
    suggestedConfig: task.suggestedConfigSnapshot
      ? JSON.parse(task.suggestedConfigSnapshot)
      : null,
    claim: task.claimOwner
      ? {
          owner: task.claimOwner,
          claimedAt: task.claimedAt,
          claimTimeoutAt: task.claimTimeoutAt,
        }
      : null,
    retryCount: task.retryCount,
    lastErrorCode: task.lastErrorCode,
    lastErrorMsg: task.lastErrorMsg,
    createdAt: task.createdAt,
    readyAt: task.readyAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    customerMinData: buildCustomerMinData(task.customer, task.customer.locations),
  });
}
