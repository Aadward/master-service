import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { transitionTask } from "@/lib/transitions";
import { onTaskTerminal } from "@/lib/dag-coordinator";
import { TaskStatus, FailureReasonCode } from "@/lib/types";

const FailSchema = z.object({
  owner: z.string().optional(),
  reasonCode: z.string().default(FailureReasonCode.UNKNOWN),
  message: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const taskId = Number(params.id);
  if (Number.isNaN(taskId)) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const parsed = FailSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ code: "INVALID_INPUT", message: parsed.error.message }, { status: 400 });
  }
  const { owner, reasonCode, message } = parsed.data;

  const existing = await db.configTask.findUnique({ where: { taskId } });
  if (!existing) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });

  const res = await transitionTask({
    taskId,
    toStatus: TaskStatus.FAILED,
    patch: {
      retryCount: existing.retryCount + 1,
      lastErrorCode: reasonCode,
      lastErrorMsg: message ?? null,
    },
    audit: {
      actor: owner ? `downstream:${owner}` : "user",
      reason: `${reasonCode}: ${message ?? ""}`,
      extra: { reasonCode, message },
    },
  });

  if (!res.ok) {
    if (res.code === "NOT_FOUND") return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json(
      { code: res.code, message: `Cannot fail from ${res.currentStatus}`, currentStatus: res.currentStatus },
      { status: 400 }
    );
  }

  // FAILED 也会刷新 customer.overallStatus（虽然不触发后继）
  await onTaskTerminal(taskId);

  const requiresHuman = reasonCode !== FailureReasonCode.TRANSIENT_ERROR;
  return NextResponse.json({
    taskId,
    status: TaskStatus.FAILED,
    retryCount: existing.retryCount + 1,
    requiresHuman,
    reasonCode,
  });
}
