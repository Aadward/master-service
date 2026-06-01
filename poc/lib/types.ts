/**
 * 状态机相关类型与常量
 * 与 docs/02-task-state-machine.md 保持一致
 */

export const TaskStatus = {
  WAITING: "WAITING",
  READY: "READY",
  CLAIMED: "CLAIMED",
  IN_PROGRESS: "IN_PROGRESS",
  DONE: "DONE",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED",
  BLOCKED: "BLOCKED",
  CANCELLED: "CANCELLED",
} as const;

export type TaskStatusT = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TerminalStatuses: TaskStatusT[] = [
  TaskStatus.DONE,
  TaskStatus.FAILED,
  TaskStatus.SKIPPED,
  TaskStatus.CANCELLED,
];

export const SuccessorTriggerStatuses: TaskStatusT[] = [
  TaskStatus.DONE,
  TaskStatus.SKIPPED,
];

export const CustomerStatus = {
  INIT: "INIT",
  IN_PROGRESS: "IN_PROGRESS",
  READY: "READY",
  PARTIAL: "PARTIAL",
  CANCELLED: "CANCELLED",
} as const;

export type CustomerStatusT = (typeof CustomerStatus)[keyof typeof CustomerStatus];

export const FailureReasonCode = {
  TRANSIENT_ERROR: "TRANSIENT_ERROR",       // 瞬时（可自动重试）
  VALIDATION_FAILED: "VALIDATION_FAILED",   // 业务（不自动重试）
  DEPENDENCY_MISSING: "DEPENDENCY_MISSING", // 业务（不自动重试）
  UNKNOWN: "UNKNOWN",
} as const;

export type FailureReasonCodeT = (typeof FailureReasonCode)[keyof typeof FailureReasonCode];

/**
 * 合法的状态转换。返回 true 表示允许该迁移。
 * 不在此表里的迁移一律拒绝，避免状态机被污染。
 */
export function isValidTransition(from: TaskStatusT, to: TaskStatusT): boolean {
  const allowed: Record<TaskStatusT, TaskStatusT[]> = {
    WAITING: [TaskStatus.READY, TaskStatus.BLOCKED, TaskStatus.CANCELLED, TaskStatus.SKIPPED],
    READY: [TaskStatus.CLAIMED, TaskStatus.SKIPPED, TaskStatus.BLOCKED, TaskStatus.CANCELLED, TaskStatus.DONE],
    CLAIMED: [TaskStatus.IN_PROGRESS, TaskStatus.DONE, TaskStatus.FAILED, TaskStatus.SKIPPED, TaskStatus.READY, TaskStatus.BLOCKED],
    IN_PROGRESS: [TaskStatus.DONE, TaskStatus.FAILED, TaskStatus.SKIPPED, TaskStatus.BLOCKED],
    DONE: [],
    FAILED: [TaskStatus.READY, TaskStatus.SKIPPED, TaskStatus.CANCELLED, TaskStatus.BLOCKED],
    SKIPPED: [],
    BLOCKED: [TaskStatus.WAITING],
    CANCELLED: [],
  };
  return allowed[from]?.includes(to) ?? false;
}

/**
 * 模板定义类型（与 YAML 一致）
 */
export interface TemplateDef {
  customer_type: string;
  version: number;
  description?: string;
  modules: Record<
    string,
    {
      tasks: Array<{
        task_key: string;
        page_ref?: string;
        required?: boolean;
        depends_on?: string[];
        suggestions?: Record<string, unknown>;
      }>;
    }
  >;
}

/**
 * 客户最小集合的字段集
 * 这里只是 TS 类型；真正的"什么进入 minimum"由业务定义
 *
 * 注意：locations 在 API 返回的 customerMinData 里会被扁平化为
 * `${domain}_loc_no` 形式，方便模板表达式直接引用
 * （例如 ${customer.sales_loc_no}）。
 */
export interface CustomerMinData {
  customerId: string;
  custNo: string;
  custName: string;
  globalCustNo?: string | null;
  globalCustName?: string | null;
  globalCustCode?: string | null;
  regionNo?: string | null;
  companyNo?: string | null;
  isMaster?: boolean;
  isInterCompany?: boolean;
  customerType: string;
  // 扁平化的 location 字段（动态 key，由 API 注入）
  [extraLocKey: string]: unknown;
}
