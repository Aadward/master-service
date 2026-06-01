import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { transitionTask } from "@/lib/transitions";
import { TaskStatus } from "@/lib/types";

/**
 * POST /api/tasks/{id}/retry
 * 把 FAILED 任务恢复成 READY，重新参与调度
 * 保留 retryCount 不清零，便于熔断与人工识别
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const taskId = Number(params.id);
  if (Number.isNaN(taskId)) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 });

  const task = await db.configTask.findUnique({ where: { taskId } });
  if (!task) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });

  const res = await transitionTask({
    taskId,
    toStatus: TaskStatus.READY,
    patch: {
      claimOwner: null,
      claimedAt: null,
      claimTimeoutAt: null,
      lastErrorCode: null,
      lastErrorMsg: null,
      readyAt: new Date(),
    },
    audit: {
      actor: "user",
      reason: `manual retry (count was ${task.retryCount})`,
    },
  });

  if (!res.ok) {
    if (res.code === "NOT_FOUND") return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json(
      { code: res.code, message: `Cannot retry from ${res.currentStatus}`, currentStatus: res.currentStatus },
      { status: 400 }
    );
  }

  return NextResponse.json({ taskId, status: TaskStatus.READY, retryCount: task.retryCount });
}
