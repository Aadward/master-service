import { db } from "./db";
import { isValidTransition, type TaskStatusT } from "./types";

/**
 * 事务包装：在单个事务内完成"更新 task + 写 audit"
 * 各 endpoint 用这个 helper 避免半完成状态
 */

export interface TransitionInput {
  taskId: number;
  /** 调用方期望的当前状态（可选，传了就做一次乐观校验） */
  expectFromStatus?: TaskStatusT;
  toStatus: TaskStatusT;
  /** 额外要写入 task 表的字段 */
  patch?: Record<string, unknown>;
  audit: {
    actor: string;
    reason?: string;
    extra?: Record<string, unknown>;
  };
}

export type TransitionResult =
  | { ok: true; from: TaskStatusT; to: TaskStatusT; customerId: string }
  | { ok: false; code: "NOT_FOUND" }
  | { ok: false; code: "INVALID_TRANSITION"; currentStatus: TaskStatusT };

export async function transitionTask(input: TransitionInput): Promise<TransitionResult> {
  return db.$transaction(async (tx) => {
    const task = await tx.configTask.findUnique({ where: { taskId: input.taskId } });
    if (!task) return { ok: false, code: "NOT_FOUND" } as const;

    const from = task.status as TaskStatusT;

    if (input.expectFromStatus && from !== input.expectFromStatus) {
      return { ok: false, code: "INVALID_TRANSITION", currentStatus: from } as const;
    }
    if (!isValidTransition(from, input.toStatus)) {
      return { ok: false, code: "INVALID_TRANSITION", currentStatus: from } as const;
    }

    await tx.configTask.update({
      where: { taskId: input.taskId },
      data: { status: input.toStatus, ...(input.patch ?? {}) },
    });
    await tx.auditLog.create({
      data: {
        customerId: task.customerId,
        taskId: input.taskId,
        eventType: "task_state_change",
        fromStatus: from,
        toStatus: input.toStatus,
        actor: input.audit.actor,
        reason: input.audit.reason ?? null,
        extra: input.audit.extra ? JSON.stringify(input.audit.extra) : null,
      },
    });

    return { ok: true, from, to: input.toStatus, customerId: task.customerId } as const;
  });
}
