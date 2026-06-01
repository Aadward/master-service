import { db } from "./db";
import { TaskStatus, CustomerStatus, type CustomerStatusT } from "./types";

/**
 * 根据 customer 下所有 task 的状态聚合 overallStatus
 * 规则与 docs/03-dag-scheduling.md §6 一致
 */
export async function refreshOverallStatus(customerId: string): Promise<CustomerStatusT> {
  const tasks = await db.configTask.findMany({
    where: { customerId },
    select: { status: true },
  });
  if (tasks.length === 0) {
    await db.customer.update({
      where: { customerId },
      data: { overallStatus: CustomerStatus.INIT },
    });
    return CustomerStatus.INIT;
  }

  const counts: Record<string, number> = {};
  for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;

  const total = tasks.length;
  const done = counts[TaskStatus.DONE] ?? 0;
  const skipped = counts[TaskStatus.SKIPPED] ?? 0;
  const failed = counts[TaskStatus.FAILED] ?? 0;
  const blocked = counts[TaskStatus.BLOCKED] ?? 0;
  const cancelled = counts[TaskStatus.CANCELLED] ?? 0;

  let status: CustomerStatusT;

  if (cancelled === total) {
    status = CustomerStatus.CANCELLED;
  } else if (done + skipped === total) {
    status = CustomerStatus.READY;
  } else if (failed > 0 || blocked > 0) {
    // 还有未完成任务，但有失败/阻塞 → PARTIAL（如果只剩 failed/blocked 终态）
    const inFlight = total - (done + skipped + failed + blocked + cancelled);
    status = inFlight > 0 ? CustomerStatus.IN_PROGRESS : CustomerStatus.PARTIAL;
  } else if (done + skipped > 0) {
    status = CustomerStatus.IN_PROGRESS;
  } else {
    status = CustomerStatus.INIT;
  }

  await db.customer.update({
    where: { customerId },
    data: { overallStatus: status },
  });
  return status;
}
