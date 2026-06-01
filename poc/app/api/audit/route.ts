import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/audit?customerId=&limit=&taskId=
 * 审计日志（最新在前）
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const customerId = url.searchParams.get("customerId");
  const taskIdRaw = url.searchParams.get("taskId");
  const limit = Number(url.searchParams.get("limit") ?? "200");

  const where: any = {};
  if (customerId) where.customerId = customerId;
  if (taskIdRaw) where.taskId = Number(taskIdRaw);

  const rows = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      customerId: r.customerId,
      taskId: r.taskId,
      eventType: r.eventType,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      actor: r.actor,
      reason: r.reason,
      extra: r.extra ? JSON.parse(r.extra) : null,
      createdAt: r.createdAt,
    })),
  });
}
