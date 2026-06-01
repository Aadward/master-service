import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { transitionTask } from "@/lib/transitions";
import { onTaskTerminal } from "@/lib/dag-coordinator";
import { TaskStatus } from "@/lib/types";
import { maybeReplay, recordResponse } from "@/lib/idempotency";

const DoneSchema = z
  .object({
    owner: z.string().optional(),
    note: z.string().optional(),
  })
  .optional();

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const replay = maybeReplay(req);
  if (replay) return replay;

  const taskId = Number(params.id);
  if (Number.isNaN(taskId)) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const parsed = DoneSchema.safeParse(body);
  const input = parsed.success ? parsed.data ?? {} : {};

  // 幂等：已经 DONE 直接返回
  const existing = await db.configTask.findUnique({ where: { taskId } });
  if (!existing) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
  if (existing.status === TaskStatus.DONE) {
    return NextResponse.json({
      taskId,
      status: TaskStatus.DONE,
      idempotent: true,
      newlyReadyTasks: [],
    });
  }

  const now = new Date();
  const res = await transitionTask({
    taskId,
    toStatus: TaskStatus.DONE,
    patch: { completedAt: now },
    audit: {
      actor: input?.owner ? `downstream:${input.owner}` : "user",
      reason: input?.note,
    },
  });

  if (!res.ok) {
    if (res.code === "NOT_FOUND") return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json(
      { code: res.code, message: `Cannot mark done from ${res.currentStatus}`, currentStatus: res.currentStatus },
      { status: 400 }
    );
  }

  const { newlyReady } = await onTaskTerminal(taskId);
  const responseBody = {
    taskId,
    status: TaskStatus.DONE,
    completedAt: now,
    newlyReadyTasks: newlyReady,
  };
  recordResponse(req, 200, responseBody);
  return NextResponse.json(responseBody);
}
