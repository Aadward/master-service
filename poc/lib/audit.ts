import { db } from "./db";

/**
 * Audit Log helper
 */

export interface AuditPayload {
  customerId?: string | null;
  taskId?: number | null;
  eventType: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actor?: string | null;
  reason?: string | null;
  extra?: Record<string, unknown> | null;
}

export async function writeAudit(payload: AuditPayload) {
  await db.auditLog.create({
    data: {
      customerId: payload.customerId ?? null,
      taskId: payload.taskId ?? null,
      eventType: payload.eventType,
      fromStatus: payload.fromStatus ?? null,
      toStatus: payload.toStatus ?? null,
      actor: payload.actor ?? "system",
      reason: payload.reason ?? null,
      extra: payload.extra ? JSON.stringify(payload.extra) : null,
    },
  });
}
