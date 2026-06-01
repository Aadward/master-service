"use client";

import { X, RefreshCw, FastForward, AlertCircle } from "lucide-react";
import StatusBadge from "./StatusBadge";
import JSONView from "./JSONView";
import { useToast } from "./ToastProvider";

/**
 * 改造点（性能优化）：
 * - 不再自己 fetch /api/tasks/[id]。整个 task 数据由父组件从 DAG 轮询里挑出来传入。
 * - 这样：客户详情页只有 2 个轮询（DAG + status），而不是过去打开 panel 后的 3 个。
 * - 操作后通过 onActionDone 让父组件刷新即可。
 */

export interface PanelTask {
  taskId: number;
  taskKey: string;
  module: string;
  pageRef?: string | null;
  status: string;
  dependsOn: string[];
  suggestedConfig: Record<string, unknown> | null;
  claimOwner?: string | null;
  claimedAt?: string | null;
  claimTimeoutAt?: string | null;
  retryCount: number;
  lastErrorCode?: string | null;
  lastErrorMsg?: string | null;
  customerMinData: Record<string, unknown>;
}

export default function TaskDetailPanel({
  task,
  onClose,
  onActionDone,
}: {
  task: PanelTask | null;
  onClose: () => void;
  onActionDone: () => void;
}) {
  const toast = useToast();
  async function callAction(path: string, body?: object) {
    if (!task) return;
    const res = await fetch(`/api/tasks/${task.taskId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      toast.push({ kind: "error", title: `${path} failed`, message: j?.message ?? res.statusText });
    } else {
      toast.push({
        kind: "success",
        message: `${path}: ${task.taskKey}`,
      });
      onActionDone();
    }
  }

  if (!task) {
    return (
      <aside className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white text-sm text-slate-400">
        点击 DAG 节点查看任务详情
      </aside>
    );
  }

  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      {/* header */}
      <div className="flex items-start justify-between border-b border-slate-100 p-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            Task #{task.taskId}
          </div>
          <div className="mt-0.5 font-mono text-sm font-semibold">{task.taskKey}</div>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge status={task.status} />
            {task.pageRef && (
              <span className="text-[10px] text-slate-500">→ {task.pageRef}</span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="btn btn-ghost p-1.5">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* body */}
      <div className="flex-1 space-y-4 overflow-auto p-3 text-sm">
        {/* depends on */}
        <Section title="Dependencies (upstream)">
          {task.dependsOn.length === 0 ? (
            <div className="text-xs text-slate-400">— (no dependencies)</div>
          ) : (
            <ul className="space-y-1">
              {task.dependsOn.map((d) => (
                <li key={d} className="font-mono text-xs text-slate-700">
                  • {d}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* min data */}
        <Section title="Customer Min Data">
          <JSONView value={task.customerMinData} />
        </Section>

        {/* suggested */}
        <Section title="Suggested Config (派生快照)">
          {task.suggestedConfig && Object.keys(task.suggestedConfig).length > 0 ? (
            <JSONView value={task.suggestedConfig} />
          ) : (
            <div className="text-xs text-slate-400">
              {task.status === "WAITING"
                ? "尚未进入 READY，未派生"
                : "此任务没有 suggestion 规则"}
            </div>
          )}
        </Section>

        {/* claim */}
        {task.claimOwner && (
          <Section title="Claim Info">
            <div className="text-xs">
              <div>
                Owner: <code>{task.claimOwner}</code>
              </div>
              {task.claimedAt && (
                <div className="text-slate-500">
                  Claimed: {new Date(task.claimedAt).toLocaleString()}
                </div>
              )}
              {task.claimTimeoutAt && (
                <div className="text-slate-500">
                  Timeout: {new Date(task.claimTimeoutAt).toLocaleString()}
                </div>
              )}
            </div>
          </Section>
        )}

        {/* error */}
        {task.lastErrorCode && (
          <Section title="Last Error">
            <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
              <div className="flex items-center gap-1 font-semibold">
                <AlertCircle className="h-3.5 w-3.5" />
                {task.lastErrorCode}
              </div>
              {task.lastErrorMsg && (
                <div className="mt-1 font-mono">{task.lastErrorMsg}</div>
              )}
              <div className="mt-1 text-red-600">retry count: {task.retryCount}</div>
            </div>
          </Section>
        )}
      </div>

      {/* actions */}
      <div className="space-y-2 border-t border-slate-100 p-3">
        {task.status === "READY" && (
          <>
            <button
              onClick={() => callAction("claim", { owner: "panel-actor", ttlMinutes: 30 })}
              className="btn w-full justify-center"
            >
              Claim as panel-actor
            </button>
            <button
              onClick={() => callAction("done", { note: "marked done via detail panel" })}
              className="btn btn-primary w-full justify-center"
            >
              <FastForward className="h-4 w-4" /> Mark Done (skip claim)
            </button>
            <button
              onClick={() =>
                callAction("failed", {
                  reasonCode: "VALIDATION_FAILED",
                  message: "marked failed via detail panel",
                })
              }
              className="btn btn-danger w-full justify-center"
            >
              Mark Failed
            </button>
            <button
              onClick={() => callAction("skip", { reason: "manual skip" })}
              className="btn w-full justify-center"
            >
              Skip
            </button>
          </>
        )}
        {task.status === "CLAIMED" && (
          <>
            <button onClick={() => callAction("done")} className="btn btn-primary w-full justify-center">
              Mark Done
            </button>
            <button
              onClick={() =>
                callAction("failed", {
                  reasonCode: "VALIDATION_FAILED",
                  message: "marked failed via detail panel",
                })
              }
              className="btn btn-danger w-full justify-center"
            >
              Mark Failed
            </button>
          </>
        )}
        {task.status === "FAILED" && (
          <button onClick={() => callAction("retry")} className="btn btn-primary w-full justify-center">
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        )}
        {task.status === "WAITING" && (
          <div className="text-center text-xs text-slate-400">
            等待依赖完成后会自动进入 READY
          </div>
        )}
        {["DONE", "SKIPPED", "CANCELLED"].includes(task.status) && (
          <div className="text-center text-xs text-slate-400">终态：无可用操作</div>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </div>
      {children}
    </div>
  );
}
