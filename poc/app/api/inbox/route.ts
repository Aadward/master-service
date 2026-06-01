import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { TaskStatus } from "@/lib/types";

/**
 * GET /api/inbox?domain=<module>&owner=<who>[&recent=<n>]
 *
 * 域 owner 的"收件箱"：按 domain 维度返回我可见的任务
 *   - available     : 该 domain 下所有 READY 任务（你可以认领的）
 *   - claimedByMe   : 你已 claim、待你"在自己系统里完成 + 回来 Confirm"的任务
 *   - claimedByOthers : 同 domain 中其他 owner 已认领（只读，让你知道有人在处理）
 *   - failed        : 该 domain 下所有 FAILED 任务（需要重试或转交人工）
 *   - recentlyDone  : 最近 N 条 DONE/SKIPPED（默认 5，看看团队的进展）
 *
 * Master-service 不参与下游系统的实际配置；本接口只回答"现在你应该看哪几个任务"。
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const domain = url.searchParams.get("domain");
  if (!domain) {
    return NextResponse.json({ code: "INVALID_INPUT", message: "domain required" }, { status: 400 });
  }
  const owner = url.searchParams.get("owner") ?? `${domain}-team-owner`;
  const recent = Math.max(0, Number(url.searchParams.get("recent") ?? "5"));

  const tasks = await db.configTask.findMany({
    where: {
      module: domain,
      status: {
        in: [
          TaskStatus.READY,
          TaskStatus.CLAIMED,
          TaskStatus.IN_PROGRESS,
          TaskStatus.FAILED,
        ],
      },
    },
    include: { customer: true },
    orderBy: [{ readyAt: "desc" }],
  });

  const recentDone = recent
    ? await db.configTask.findMany({
        where: {
          module: domain,
          status: { in: [TaskStatus.DONE, TaskStatus.SKIPPED] },
        },
        include: { customer: true },
        orderBy: { completedAt: "desc" },
        take: recent,
      })
    : [];

  const shape = (t: (typeof tasks)[number]) => ({
    taskId: t.taskId,
    taskKey: t.taskKey,
    pageRef: t.pageRef,
    status: t.status,
    customerId: t.customer.customerId,
    customerName: t.customer.name,
    customerMinData: {
      customerId: t.customer.customerId,
      name: t.customer.name,
      country: t.customer.country,
      industry: t.customer.industry,
      customerType: t.customer.customerType,
      legalEntity: t.customer.legalEntity,
      defaultCurrency: t.customer.defaultCurrency,
    },
    suggestedConfig: t.suggestedConfigSnapshot
      ? JSON.parse(t.suggestedConfigSnapshot)
      : null,
    claimOwner: t.claimOwner,
    claimedAt: t.claimedAt,
    claimTimeoutAt: t.claimTimeoutAt,
    retryCount: t.retryCount,
    lastErrorCode: t.lastErrorCode,
    lastErrorMsg: t.lastErrorMsg,
    readyAt: t.readyAt,
    completedAt: t.completedAt,
  });

  // 各域的计数（顶部 tabs 上的数字）
  const allDomainCounts = await db.configTask.groupBy({
    by: ["module", "status"],
    _count: { _all: true },
  });
  const domainCounts: Record<string, { pending: number; failed: number }> = {};
  for (const r of allDomainCounts) {
    const m = (domainCounts[r.module] ??= { pending: 0, failed: 0 });
    if (
      [TaskStatus.READY, TaskStatus.CLAIMED, TaskStatus.IN_PROGRESS].includes(r.status as any)
    ) {
      m.pending += r._count._all;
    } else if (r.status === TaskStatus.FAILED) {
      m.failed += r._count._all;
    }
  }

  return NextResponse.json({
    domain,
    owner,
    available: tasks.filter((t) => t.status === TaskStatus.READY).map(shape),
    claimedByMe: tasks
      .filter(
        (t) =>
          (t.status === TaskStatus.CLAIMED || t.status === TaskStatus.IN_PROGRESS) &&
          t.claimOwner === owner
      )
      .map(shape),
    claimedByOthers: tasks
      .filter(
        (t) =>
          (t.status === TaskStatus.CLAIMED || t.status === TaskStatus.IN_PROGRESS) &&
          t.claimOwner !== owner
      )
      .map(shape),
    failed: tasks.filter((t) => t.status === TaskStatus.FAILED).map(shape),
    recentlyDone: recentDone.map(shape),
    domainCounts,
  });
}
