import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { transitionTask } from "@/lib/transitions";
import { TaskStatus } from "@/lib/types";
import { maybeReplay, recordResponse } from "@/lib/idempotency";

const ClaimSchema = z.object({
  owner: z.string().min(1),
  ttlMinutes: z.number().int().positive().default(30),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const replay = maybeReplay(req);
  if (replay) return replay;

  const taskId = Number(params.id);
  if (Number.isNaN(taskId)) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = ClaimSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INVALID_INPUT", message: parsed.error.message },
      { status: 400 }
    );
  }
  const { owner, ttlMinutes } = parsed.data;

  // 幂等 / 冲突的特判要在 transition 之前看：
  const existing = await db.configTask.findUnique({ where: { taskId } });
  if (!existing) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });

  if (existing.status === TaskStatus.CLAIMED && existing.claimOwner === owner) {
    return NextResponse.json({
      taskId,
      status: existing.status,
      claimedAt: existing.claimedAt,
      claimTimeoutAt: existing.claimTimeoutAt,
      idempotent: true,
    });
  }
  if (existing.status === TaskStatus.CLAIMED && existing.claimOwner !== owner) {
    return NextResponse.json(
      { code: "CONFLICT", message: `Already claimed by ${existing.claimOwner}` },
      { status: 409 }
    );
  }

  const now = new Date();
  const timeoutAt = new Date(now.getTime() + ttlMinutes * 60_000);
  const res = await transitionTask({
    taskId,
    toStatus: TaskStatus.CLAIMED,
    patch: { claimOwner: owner, claimedAt: now, claimTimeoutAt: timeoutAt },
    audit: {
      actor: `downstream:${owner}`,
      reason: `claimed by ${owner}, ttl ${ttlMinutes}m`,
    },
  });

  if (!res.ok) {
    if (res.code === "NOT_FOUND") return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json(
      { code: res.code, message: `Cannot claim task in status ${res.currentStatus}`, currentStatus: res.currentStatus },
      { status: 400 }
    );
  }

  return NextResponse.json(
    (() => {
      const body = {
        taskId,
        status: TaskStatus.CLAIMED,
        claimedAt: now,
        claimTimeoutAt: timeoutAt,
      };
      recordResponse(req, 200, body);
      return body;
    })()
  );
}
