import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { TaskStatus } from "@/lib/types";

/**
 * GET /api/customers/{id}/next-tasks?owner=<module-or-actor>&module=<module>
 *   - owner 仅用于在响应里回显（POC 不做 owner 鉴权）
 *   - module 可选：过滤到某个模块
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const url = new URL(req.url);
  const owner = url.searchParams.get("owner") ?? "anonymous";
  const moduleFilter = url.searchParams.get("module");

  const where: any = {
    customerId: params.id,
    status: TaskStatus.READY,
  };
  if (moduleFilter) where.module = moduleFilter;

  const tasks = await db.configTask.findMany({
    where,
    orderBy: { readyAt: "asc" },
  });

  return NextResponse.json({
    customerId: params.id,
    owner,
    items: tasks.map((t) => ({
      taskId: t.taskId,
      taskKey: t.taskKey,
      module: t.module,
      pageRef: t.pageRef,
      status: t.status,
      readyAt: t.readyAt,
      suggestedConfig: t.suggestedConfigSnapshot
        ? JSON.parse(t.suggestedConfigSnapshot)
        : null,
    })),
  });
}
