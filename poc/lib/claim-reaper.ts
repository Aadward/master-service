import { db } from "./db";
import { TaskStatus } from "./types";

/**
 * Claim Reaper
 *
 * 周期性扫描 CLAIMED / IN_PROGRESS 状态、且 claim_timeout_at 已过期的任务，
 * 把它们重置为 READY（清空 claim 字段）并写一条 audit。
 *
 * 这是 docs/02-task-state-machine.md §6 "CLAIMED 必有超时回收"的实现。
 */

let started = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

/** 幂等启动；多次调用只会启动一次 */
export function ensureReaperStarted(periodMs = 60_000) {
  if (started) return;
  started = true;
  // 启动后稍微等几秒再首次扫描，避免和应用启动抢资源
  setTimeout(() => {
    reapExpiredClaims().catch((e) => console.error("[reaper] initial run failed:", e));
  }, 3_000);
  intervalHandle = setInterval(() => {
    reapExpiredClaims().catch((e) => console.error("[reaper] tick failed:", e));
  }, periodMs);
  console.log(`[reaper] started (every ${periodMs} ms)`);
}

export function stopReaper() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  started = false;
}

/**
 * 扫一次过期 claim 并回收
 * 返回被回收的任务数（同步可供 /api/admin/reap-expired 使用）
 */
export async function reapExpiredClaims(): Promise<number> {
  const now = new Date();
  const expired = await db.configTask.findMany({
    where: {
      status: { in: [TaskStatus.CLAIMED, TaskStatus.IN_PROGRESS] },
      claimTimeoutAt: { lt: now },
    },
  });
  if (expired.length === 0) return 0;

  for (const task of expired) {
    try {
      await db.$transaction(async (tx) => {
        // 二次确认状态（避免在我们读取和更新之间被人工动过）
        const fresh = await tx.configTask.findUnique({ where: { taskId: task.taskId } });
        if (!fresh) return;
        if (![TaskStatus.CLAIMED, TaskStatus.IN_PROGRESS].includes(fresh.status as any)) return;
        if (!fresh.claimTimeoutAt || fresh.claimTimeoutAt > now) return;

        await tx.configTask.update({
          where: { taskId: task.taskId },
          data: {
            status: TaskStatus.READY,
            claimOwner: null,
            claimedAt: null,
            claimTimeoutAt: null,
            readyAt: now,
          },
        });
        await tx.auditLog.create({
          data: {
            customerId: task.customerId,
            taskId: task.taskId,
            eventType: "task_state_change",
            fromStatus: fresh.status,
            toStatus: TaskStatus.READY,
            actor: "system:reaper",
            reason: `claim timeout (was claimed by ${task.claimOwner})`,
          },
        });
      });
    } catch (e) {
      console.error(`[reaper] failed to reclaim task ${task.taskId}:`, e);
    }
  }
  console.log(`[reaper] reclaimed ${expired.length} expired claim(s)`);
  return expired.length;
}
