import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { transitionTask } from "@/lib/transitions";
import { onTaskTerminal } from "@/lib/dag-coordinator";
import { TaskStatus } from "@/lib/types";

/**
 * POST /api/customers/{id}/auto-step
 * Demo 辅助：模拟一个下游 owner 的动作；所有写入都经过状态机校验
 * body: { mode: "step" | "all" | "failRandom" | "skipRandom" | "retryAllFailed" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => ({}));
  const mode = (body?.mode as string) ?? "step";
  const customerId = params.id;
  const all = await db.configTask.findMany({ where: { customerId } });

  if (mode === "step" || mode === "all") {
    const ready = all.filter((t) => t.status === TaskStatus.READY);
    if (ready.length === 0) {
      return NextResponse.json({ stepped: 0, message: "no READY tasks" });
    }
    const target = ready[Math.floor(Math.random() * ready.length)];
    const res = await transitionTask({
      taskId: target.taskId,
      expectFromStatus: TaskStatus.READY,
      toStatus: TaskStatus.DONE,
      patch: { completedAt: new Date() },
      audit: { actor: "demo-helper", reason: `auto step mode=${mode}` },
    });
    if (!res.ok) {
      return NextResponse.json(
        { code: res.code, message: `auto-step failed: ${"currentStatus" in res ? res.currentStatus : "?"}` },
        { status: 400 }
      );
    }
    await onTaskTerminal(target.taskId);
    return NextResponse.json({
      stepped: 1,
      taskId: target.taskId,
      taskKey: target.taskKey,
      remainingReady: ready.length - 1,
    });
  }

  if (mode === "failRandom") {
    const candidates = all.filter(
      (t) => t.status === TaskStatus.READY || t.status === TaskStatus.CLAIMED
    );
    if (candidates.length === 0) {
      return NextResponse.json({ failed: 0, message: "no READY/CLAIMED tasks" });
    }
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const res = await transitionTask({
      taskId: target.taskId,
      toStatus: TaskStatus.FAILED,
      patch: {
        retryCount: target.retryCount + 1,
        lastErrorCode: "VALIDATION_FAILED",
        lastErrorMsg: "simulated failure for demo",
      },
      audit: { actor: "demo-helper", reason: "simulated failure" },
    });
    if (!res.ok) {
      return NextResponse.json(
        { code: res.code, message: "auto-step failed (failRandom)" },
        { status: 400 }
      );
    }
    await onTaskTerminal(target.taskId);
    return NextResponse.json({
      failed: 1,
      taskId: target.taskId,
      taskKey: target.taskKey,
    });
  }

  if (mode === "skipRandom") {
    const candidates = all.filter(
      (t) => t.status === TaskStatus.READY || t.status === TaskStatus.WAITING
    );
    if (candidates.length === 0) {
      return NextResponse.json({ skipped: 0, message: "no eligible tasks" });
    }
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const res = await transitionTask({
      taskId: target.taskId,
      toStatus: TaskStatus.SKIPPED,
      patch: { completedAt: new Date() },
      audit: { actor: "demo-helper", reason: "simulated skip" },
    });
    if (!res.ok) {
      return NextResponse.json(
        { code: res.code, message: "auto-step failed (skipRandom)" },
        { status: 400 }
      );
    }
    await onTaskTerminal(target.taskId);
    return NextResponse.json({
      skipped: 1,
      taskId: target.taskId,
      taskKey: target.taskKey,
    });
  }

  if (mode === "retryAllFailed") {
    const failed = all.filter((t) => t.status === TaskStatus.FAILED);
    let retried = 0;
    for (const t of failed) {
      const res = await transitionTask({
        taskId: t.taskId,
        expectFromStatus: TaskStatus.FAILED,
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
          actor: "demo-helper",
          reason: `bulk retry (count was ${t.retryCount})`,
        },
      });
      if (res.ok) retried++;
    }
    return NextResponse.json({ retried });
  }

  return NextResponse.json({ code: "INVALID_MODE", message: `unknown mode: ${mode}` }, { status: 400 });
}
