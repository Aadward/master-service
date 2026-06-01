import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { transitionTask } from "@/lib/transitions";
import { onTaskTerminal } from "@/lib/dag-coordinator";
import { TaskStatus } from "@/lib/types";

const SkipSchema = z.object({
  owner: z.string().optional(),
  reason: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const taskId = Number(params.id);
  if (Number.isNaN(taskId)) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const parsed = SkipSchema.safeParse(body);
  const input = parsed.success ? parsed.data : {};

  const res = await transitionTask({
    taskId,
    toStatus: TaskStatus.SKIPPED,
    patch: { completedAt: new Date() },
    audit: {
      actor: input.owner ? `downstream:${input.owner}` : "user",
      reason: input.reason ?? "task not applicable",
    },
  });

  if (!res.ok) {
    if (res.code === "NOT_FOUND") return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json(
      { code: res.code, message: `Cannot skip from ${res.currentStatus}`, currentStatus: res.currentStatus },
      { status: 400 }
    );
  }

  const { newlyReady } = await onTaskTerminal(taskId);
  return NextResponse.json({
    taskId,
    status: TaskStatus.SKIPPED,
    newlyReadyTasks: newlyReady,
  });
}
