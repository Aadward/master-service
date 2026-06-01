"use client";

import { Handle, Position, NodeProps } from "@xyflow/react";

/**
 * DAG 节点：根据状态着色，附带模块标签和 task_key
 */
export interface TaskNodeData extends Record<string, unknown> {
  taskKey: string;
  module: string;
  status: string;
  retryCount?: number;
  lastErrorCode?: string | null;
  selected?: boolean;
}

const styleByStatus: Record<string, { bg: string; border: string; text: string; ring?: string; anim?: string }> = {
  WAITING:     { bg: "bg-slate-100",    border: "border-slate-300",     text: "text-slate-600" },
  READY:       { bg: "bg-blue-50",      border: "border-blue-500",      text: "text-blue-800",  ring: "ring-2 ring-blue-300", anim: "animate-pulseGlow" },
  CLAIMED:     { bg: "bg-amber-50",     border: "border-amber-500",     text: "text-amber-800" },
  IN_PROGRESS: { bg: "bg-orange-50",    border: "border-orange-500",    text: "text-orange-800" },
  DONE:        { bg: "bg-emerald-50",   border: "border-emerald-600",   text: "text-emerald-800" },
  FAILED:      { bg: "bg-red-50",       border: "border-red-600",       text: "text-red-800", anim: "animate-shake" },
  SKIPPED:     { bg: "bg-violet-50",    border: "border-violet-400",    text: "text-violet-700" },
  BLOCKED:     { bg: "bg-purple-100",   border: "border-purple-500",    text: "text-purple-800" },
  CANCELLED:   { bg: "bg-slate-200",    border: "border-slate-400",     text: "text-slate-500" },
};

const moduleColor: Record<string, string> = {
  sales:   "bg-pink-100   text-pink-700",
  crm:     "bg-cyan-100   text-cyan-700",
  finance: "bg-indigo-100 text-indigo-700",
  mrp:     "bg-teal-100   text-teal-700",
  plm:     "bg-yellow-100 text-yellow-800",
};

export default function TaskNode({ data, selected }: NodeProps) {
  const d = data as TaskNodeData;
  const style = styleByStatus[d.status] ?? styleByStatus.WAITING;
  const modStyle = moduleColor[d.module] ?? "bg-slate-100 text-slate-700";
  return (
    <div
      className={[
        "rounded-md border-2 shadow-sm transition-all duration-300",
        "min-w-[180px] px-3 py-2",
        style.bg, style.border, style.text,
        style.ring ?? "",
        style.anim ?? "",
        selected ? "ring-2 ring-offset-2 ring-blue-400" : "",
      ].join(" ")}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !bg-slate-400" />
      <div className="flex items-center justify-between gap-2">
        <span
          className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${modStyle}`}
        >
          {d.module}
        </span>
        <span className="text-[9px] font-medium uppercase tracking-wider opacity-70">
          {d.status}
        </span>
      </div>
      <div className="mt-1 truncate text-sm font-semibold">
        {d.taskKey.split(".").slice(1).join(".") || d.taskKey}
      </div>
      {d.retryCount && d.retryCount > 0 ? (
        <div className="mt-1 text-[10px] text-red-700">↻ retry {d.retryCount}</div>
      ) : null}
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !bg-slate-400" />
    </div>
  );
}
