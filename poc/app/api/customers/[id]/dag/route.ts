import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildCustomerMinData } from "@/lib/customer-shape";

/**
 * GET /api/customers/{id}/dag
 * 返回 DAG 视图所需的 nodes + edges
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const customer = await db.customer.findUnique({
    where: { customerId: params.id },
    include: {
      tasks: true,
      locations: true,
    },
  });
  if (!customer) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });

  const nodes = customer.tasks.map((t) => ({
    taskId: t.taskId,
    taskKey: t.taskKey,
    module: t.module,
    status: t.status,
    pageRef: t.pageRef,
    claimOwner: t.claimOwner,
    claimedAt: t.claimedAt,
    claimTimeoutAt: t.claimTimeoutAt,
    retryCount: t.retryCount,
    lastErrorCode: t.lastErrorCode,
    lastErrorMsg: t.lastErrorMsg,
    dependsOn: JSON.parse(t.dependsOnJson || "[]") as string[],
    suggestedConfig: t.suggestedConfigSnapshot
      ? JSON.parse(t.suggestedConfigSnapshot)
      : null,
  }));

  const taskByKey = new Map(customer.tasks.map((t) => [t.taskKey, t.taskId]));
  const edges: Array<{ from: number; to: number; fromKey: string; toKey: string }> = [];
  for (const t of customer.tasks) {
    const deps: string[] = JSON.parse(t.dependsOnJson || "[]");
    for (const d of deps) {
      const fromId = taskByKey.get(d);
      if (fromId !== undefined) {
        edges.push({ from: fromId, to: t.taskId, fromKey: d, toKey: t.taskKey });
      }
    }
  }

  return NextResponse.json({
    customerId: customer.customerId,
    customerName: customer.custName, // 保留旧字段名供前端兼容
    custNo: customer.custNo,
    overallStatus: customer.overallStatus,
    customerMinData: buildCustomerMinData(customer, customer.locations),
    nodes,
    edges,
  });
}
