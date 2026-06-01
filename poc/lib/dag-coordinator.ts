import { db } from "./db";
import { loadAllLookups } from "./lookups";
import { evaluateSuggestions } from "./expression-evaluator";
import { findTaskDefInTemplate, loadTemplate } from "./template-engine";
import { TaskStatus, SuccessorTriggerStatuses, type CustomerMinData, type TemplateDef } from "./types";
import { refreshOverallStatus } from "./status-aggregator";
import type { Prisma } from "@prisma/client";

/**
 * DAG Coordinator
 *
 * 两个入口都用 $transaction 包裹"激活一批任务 + 写 audit"，
 * 避免中途崩溃留下半完成状态。
 */

type TxClient = Omit<typeof db, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

interface ActivationResult {
  taskId: number;
  taskKey: string;
  module: string;
}

/**
 * 共享的"找符合条件的 WAITING → 激活成 READY"内核
 * 调用方决定"完成键集合"是谁，并提供事务句柄
 */
async function activateMatchingWaiting(
  tx: Prisma.TransactionClient,
  customerId: string,
  completedKeys: Set<string>,
  tmpl: TemplateDef,
  minData: CustomerMinData,
  lookups: Awaited<ReturnType<typeof loadAllLookups>>,
  triggerReason: string
): Promise<ActivationResult[]> {
  const waiting = await tx.configTask.findMany({
    where: { customerId, status: TaskStatus.WAITING },
  });

  const out: ActivationResult[] = [];
  for (const succ of waiting) {
    const deps: string[] = JSON.parse(succ.dependsOnJson || "[]");
    if (!deps.every((d) => completedKeys.has(d))) continue;

    const def = findTaskDefInTemplate(tmpl, succ.taskKey);
    const suggested = evaluateSuggestions(def?.task.suggestions, minData, lookups);

    await tx.configTask.update({
      where: { taskId: succ.taskId },
      data: {
        status: TaskStatus.READY,
        readyAt: new Date(),
        suggestedConfigSnapshot: JSON.stringify(suggested),
      },
    });
    await tx.auditLog.create({
      data: {
        customerId,
        taskId: succ.taskId,
        eventType: "task_state_change",
        fromStatus: TaskStatus.WAITING,
        toStatus: TaskStatus.READY,
        actor: "system",
        reason: triggerReason,
      },
    });
    out.push({ taskId: succ.taskId, taskKey: succ.taskKey, module: succ.module });
  }
  return out;
}

/**
 * onTaskTerminal —— 在每次任务进入终态后调用
 * 若新状态属于"触发后继的终态"(DONE/SKIPPED)，把符合依赖的 WAITING → READY
 * 全程事务化；之后刷新 customer.overallStatus（这是单行更新，独立做）
 */
export async function onTaskTerminal(taskId: number): Promise<{
  newlyReady: ActivationResult[];
}> {
  const task = await db.configTask.findUnique({ where: { taskId } });
  if (!task) return { newlyReady: [] };

  let newlyReady: ActivationResult[] = [];

  if (SuccessorTriggerStatuses.includes(task.status as any)) {
    const customer = await db.customer.findUnique({ where: { customerId: task.customerId } });
    if (!customer) return { newlyReady };
    const tmpl = await loadTemplate(customer.templateId, customer.templateVersion);
    if (!tmpl) return { newlyReady };
    const lookups = await loadAllLookups();
    const minData: CustomerMinData = {
      customerId: customer.customerId,
      name: customer.name,
      country: customer.country,
      industry: customer.industry,
      customerType: customer.customerType,
      legalEntity: customer.legalEntity,
      defaultCurrency: customer.defaultCurrency,
    };

    newlyReady = await db.$transaction(async (tx) => {
      // 在事务内重新查"已完成键集合"，确保看到的是最新视图
      const all = await tx.configTask.findMany({
        where: { customerId: task.customerId },
        select: { taskKey: true, status: true },
      });
      const completedKeys = new Set(
        all
          .filter((t) => SuccessorTriggerStatuses.includes(t.status as any))
          .map((t) => t.taskKey)
      );
      return activateMatchingWaiting(
        tx,
        task.customerId,
        completedKeys,
        tmpl,
        minData,
        lookups,
        `triggered by ${task.taskKey} entering ${task.status}`
      );
    });
  }

  await refreshOverallStatus(task.customerId);
  return { newlyReady };
}

/**
 * activateInitialTasks —— 客户创建后调用一次
 * 找入度=0 的任务，事务内全部激活为 READY
 */
export async function activateInitialTasks(customerId: string): Promise<ActivationResult[]> {
  const customer = await db.customer.findUnique({ where: { customerId } });
  if (!customer) return [];
  const tmpl = await loadTemplate(customer.templateId, customer.templateVersion);
  if (!tmpl) return [];
  const lookups = await loadAllLookups();
  const minData: CustomerMinData = {
    customerId: customer.customerId,
    name: customer.name,
    country: customer.country,
    industry: customer.industry,
    customerType: customer.customerType,
    legalEntity: customer.legalEntity,
    defaultCurrency: customer.defaultCurrency,
  };

  const out = await db.$transaction(async (tx) => {
    // 初始激活时"完成键集合"为空 → 只有无依赖的任务会被激活
    return activateMatchingWaiting(
      tx,
      customerId,
      new Set(),
      tmpl,
      minData,
      lookups,
      "initial activation (no dependencies)"
    );
  });
  await refreshOverallStatus(customerId);
  return out;
}

/**
 * recomputeReadyTasks —— 重新扫描某客户的所有 WAITING 任务，
 * 把依赖已满足的提升到 READY。用于 unblock 之后 / 模板补齐等场景。
 */
export async function recomputeReadyTasks(
  customerId: string,
  reason = "recompute after manual change"
): Promise<ActivationResult[]> {
  const customer = await db.customer.findUnique({ where: { customerId } });
  if (!customer) return [];
  const tmpl = await loadTemplate(customer.templateId, customer.templateVersion);
  if (!tmpl) return [];
  const lookups = await loadAllLookups();
  const minData: CustomerMinData = {
    customerId: customer.customerId,
    name: customer.name,
    country: customer.country,
    industry: customer.industry,
    customerType: customer.customerType,
    legalEntity: customer.legalEntity,
    defaultCurrency: customer.defaultCurrency,
  };

  const out = await db.$transaction(async (tx) => {
    const all = await tx.configTask.findMany({
      where: { customerId },
      select: { taskKey: true, status: true },
    });
    const completedKeys = new Set(
      all
        .filter((t) => SuccessorTriggerStatuses.includes(t.status as any))
        .map((t) => t.taskKey)
    );
    return activateMatchingWaiting(tx, customerId, completedKeys, tmpl, minData, lookups, reason);
  });
  await refreshOverallStatus(customerId);
  return out;
}
