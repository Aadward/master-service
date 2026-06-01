"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import { useDebouncedValue } from "@/lib/useDebouncedValue";

interface AuditRow {
  id: number;
  customerId?: string | null;
  taskId?: number | null;
  eventType: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actor?: string | null;
  reason?: string | null;
  createdAt: string;
}

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [filterCustomer, setFilterCustomer] = useState("");
  const dCustomer = useDebouncedValue(filterCustomer, 300);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const q = dCustomer ? `?customerId=${encodeURIComponent(dCustomer)}` : "";
      const res = await fetch(`/api/audit${q}`);
      const j = await res.json();
      if (!cancelled) setRows(j.items ?? []);
    }
    load();
    const id = setInterval(load, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [dCustomer]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <p className="mt-1 text-sm text-slate-500">
            所有状态迁移的不可篡改记录。POC 中按最新 200 条显示。
          </p>
        </div>
        <input
          className="input w-48"
          placeholder="filter by customer_id"
          value={filterCustomer}
          onChange={(e) => setFilterCustomer(e.target.value)}
        />
      </header>

      <section className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-left">Task</th>
              <th className="px-3 py-2 text-left">Event</th>
              <th className="px-3 py-2 text-left">From → To</th>
              <th className="px-3 py-2 text-left">Actor</th>
              <th className="px-3 py-2 text-left">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  No audit entries yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-xs text-slate-500 tabular-nums">
                    <div title={new Date(r.createdAt).toLocaleString()}>
                      <div>{relative(r.createdAt)}</div>
                      <div className="text-[10px] text-slate-400">
                        {fmtTime(r.createdAt)}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.customerId ? (
                      <Link href={`/customers/${r.customerId}`} className="text-blue-600 hover:underline">
                        {r.customerId}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.taskId ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.eventType}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {r.fromStatus && <StatusBadge status={r.fromStatus} size="sm" />}
                      {r.fromStatus && r.toStatus && (
                        <span className="text-slate-400">→</span>
                      )}
                      {r.toStatus && <StatusBadge status={r.toStatus} size="sm" />}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">{r.actor ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{r.reason ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function relative(iso: string) {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  if (diff < 5000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
