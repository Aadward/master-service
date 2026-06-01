export default function ModulePills({
  modules,
}: {
  modules: Record<string, { total: number; done: number; failed: number }>;
}) {
  const order = ["sales", "crm", "finance", "mrp", "plm"];
  const keys = order.filter((k) => modules[k]).concat(
    Object.keys(modules).filter((k) => !order.includes(k))
  );
  return (
    <div className="flex flex-wrap gap-2">
      {keys.map((m) => {
        const x = modules[m];
        const pct = x.total ? Math.round((x.done / x.total) * 100) : 0;
        const full = x.done === x.total;
        const hasFail = x.failed > 0;
        const color = hasFail
          ? "bg-red-50 border-red-300 text-red-800"
          : full
          ? "bg-emerald-50 border-emerald-300 text-emerald-800"
          : x.done > 0
          ? "bg-blue-50 border-blue-300 text-blue-800"
          : "bg-slate-50 border-slate-300 text-slate-600";
        return (
          <div
            key={m}
            className={`rounded-md border px-2 py-1 text-xs ${color}`}
          >
            <span className="font-semibold uppercase tracking-wider">{m}</span>
            <span className="ml-1 font-mono">
              {x.done}/{x.total}
            </span>
            {hasFail && <span className="ml-1">⚠</span>}
            {full && !hasFail && <span className="ml-1">✓</span>}
          </div>
        );
      })}
    </div>
  );
}
