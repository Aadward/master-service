import { db } from "./db";
import type { TemplateDef, CustomerMinData } from "./types";
import { TaskStatus } from "./types";

/**
 * Template Engine
 * - 加载/缓存模板（从 DB）
 * - 客户创建时物化任务为 WAITING
 */

/** 根据 customerType 拿出当前 active 的模板（含 version） */
export async function loadActiveTemplate(customerType: string): Promise<{
  templateId: string;
  version: number;
  def: TemplateDef;
} | null> {
  const row = await db.configTemplate.findFirst({
    where: { customerType, isActive: true },
    orderBy: { version: "desc" },
  });
  if (!row) return null;
  return {
    templateId: row.templateId,
    version: row.version,
    def: JSON.parse(row.definition) as TemplateDef,
  };
}

/** 按 templateId+version 精确加载 */
export async function loadTemplate(
  templateId: string,
  version: number
): Promise<TemplateDef | null> {
  const row = await db.configTemplate.findUnique({
    where: { templateId_version: { templateId, version } },
  });
  if (!row) return null;
  return JSON.parse(row.definition) as TemplateDef;
}

/**
 * 客户创建时一次性物化所有任务，全部初始为 WAITING
 * 不在这里激活 READY；交给 dag-coordinator 在 evaluateSuccessors 中统一推进
 */
export async function materializeTasks(
  customer: CustomerMinData,
  templateId: string,
  version: number
): Promise<number> {
  const def = await loadTemplate(templateId, version);
  if (!def) throw new Error(`template not found: ${templateId} v${version}`);

  let count = 0;
  for (const [moduleName, mod] of Object.entries(def.modules)) {
    for (const task of mod.tasks) {
      await db.configTask.create({
        data: {
          customerId: customer.customerId,
          module: moduleName,
          taskKey: task.task_key,
          pageRef: task.page_ref ?? null,
          status: TaskStatus.WAITING,
          dependsOnJson: JSON.stringify(task.depends_on ?? []),
        },
      });
      count++;
    }
  }
  return count;
}

/**
 * 找到某个 taskKey 在模板里的定义（含 suggestions 等）
 * 用于 dag-coordinator 计算 suggested_config
 */
export function findTaskDefInTemplate(
  def: TemplateDef,
  taskKey: string
): { module: string; task: TemplateDef["modules"][string]["tasks"][number] } | null {
  for (const [moduleName, mod] of Object.entries(def.modules)) {
    const t = mod.tasks.find((x) => x.task_key === taskKey);
    if (t) return { module: moduleName, task: t };
  }
  return null;
}
