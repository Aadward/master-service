export default function ProgressBar({
  done,
  total,
  failed = 0,
  className = "",
}: {
  done: number;
  total: number;
  failed?: number;
  className?: string;
}) {
  const donePct = total ? (done / total) * 100 : 0;
  const failPct = total ? (failed / total) * 100 : 0;
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div
          className="absolute left-0 top-0 h-full bg-emerald-500 transition-all"
          style={{ width: `${donePct}%` }}
        />
        <div
          className="absolute top-0 h-full bg-red-500 transition-all"
          style={{ left: `${donePct}%`, width: `${failPct}%` }}
        />
      </div>
      <span className="w-14 text-right text-xs tabular-nums text-slate-600">
        {done}/{total}
      </span>
    </div>
  );
}
