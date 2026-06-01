import { TaskStatus, type TaskStatusT } from "@/lib/types";

const labelMap: Record<TaskStatusT, string> = {
  [TaskStatus.WAITING]: "WAITING",
  [TaskStatus.READY]: "READY",
  [TaskStatus.CLAIMED]: "CLAIMED",
  [TaskStatus.IN_PROGRESS]: "IN PROGRESS",
  [TaskStatus.DONE]: "DONE",
  [TaskStatus.FAILED]: "FAILED",
  [TaskStatus.SKIPPED]: "SKIPPED",
  [TaskStatus.BLOCKED]: "BLOCKED",
  [TaskStatus.CANCELLED]: "CANCELLED",
};

const colorMap: Record<string, string> = {
  WAITING: "bg-slate-100 text-slate-600 border-slate-300",
  READY: "bg-blue-100 text-blue-700 border-blue-300",
  CLAIMED: "bg-amber-100 text-amber-700 border-amber-300",
  IN_PROGRESS: "bg-orange-100 text-orange-700 border-orange-300",
  DONE: "bg-emerald-100 text-emerald-700 border-emerald-300",
  FAILED: "bg-red-100 text-red-700 border-red-300",
  SKIPPED: "bg-violet-100 text-violet-700 border-violet-300",
  BLOCKED: "bg-purple-100 text-purple-700 border-purple-400",
  CANCELLED: "bg-slate-200 text-slate-600 border-slate-400",

  // customer overall status
  INIT: "bg-slate-100 text-slate-600 border-slate-300",
  PARTIAL: "bg-amber-100 text-amber-700 border-amber-300",
};

export default function StatusBadge({
  status,
  size = "md",
}: {
  status: string;
  size?: "sm" | "md";
}) {
  const label = (labelMap as any)[status] ?? status;
  const color = colorMap[status] ?? "bg-slate-100 text-slate-600 border-slate-300";
  const sizing = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border font-medium uppercase tracking-wider ${color} ${sizing}`}
    >
      <span className={`status-dot status-${status}`} />
      {label}
    </span>
  );
}
