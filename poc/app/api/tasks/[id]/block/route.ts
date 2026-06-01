import { NextRequest, NextResponse } from "next/server";
import { transitionTask } from "@/lib/transitions";
import { refreshOverallStatus } from "@/lib/status-aggregator";
import { TaskStatus } from "@/lib/types";

/**
 * POST /api/tasks/{id}/block
 * 人工把任务挂起；不参与调度，不广播事件
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const taskId = Number(params.id);
  if (Number.isNaN(taskId)) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const reason = (body?.reason as string) ?? "manual block";

  const res = await transitionTask({
    taskId,
    toStatus: TaskStatus.BLOCKED,
    audit: { actor: "user", reason },
  });

  if (!res.ok) {
    if (res.code === "NOT_FOUND") return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json(
      { code: res.code, message: `Cannot block from ${res.currentStatus}`, currentStatus: res.currentStatus },
      { status: 400 }
    );
  }
  await refreshOverallStatus(res.customerId);
  return NextResponse.json({ taskId, status: TaskStatus.BLOCKED });
}
