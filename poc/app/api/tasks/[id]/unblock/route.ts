import { NextRequest, NextResponse } from "next/server";
import { transitionTask } from "@/lib/transitions";
import { recomputeReadyTasks } from "@/lib/dag-coordinator";
import { TaskStatus } from "@/lib/types";

/**
 * POST /api/tasks/{id}/unblock
 * 解除挂起：回到 WAITING；之后由 recomputeReadyTasks 决定能否前进到 READY
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const taskId = Number(params.id);
  if (Number.isNaN(taskId)) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 });

  const res = await transitionTask({
    taskId,
    toStatus: TaskStatus.WAITING,
    audit: { actor: "user", reason: "manual unblock" },
  });
  if (!res.ok) {
    if (res.code === "NOT_FOUND") return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json(
      { code: res.code, message: `Cannot unblock from ${res.currentStatus}`, currentStatus: res.currentStatus },
      { status: 400 }
    );
  }

  // 解除挂起后重新评估这个客户的 WAITING 任务（不只这一个；可能多个互相阻塞）
  const newlyReady = await recomputeReadyTasks(res.customerId, "deps re-evaluated after unblock");
  return NextResponse.json({ taskId, status: TaskStatus.WAITING, newlyReadyTasks: newlyReady });
}
