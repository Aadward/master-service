"use client";

import Link from "next/link";
import { useCallback } from "react";
import { Clock, Activity } from "lucide-react";
import { usePolling } from "@/lib/usePolling";
import StatusBadge from "./StatusBadge";

interface AuditItem {
  id: number;
  taskId?: number | null;
  eventType: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actor?: string | null;
  reason?: string | null;
  createdAt: string;
}

/**
 * 客户详情页底部用：仅显示该客户最近 N 条状态迁移
 */
export default function RecentActivity({ customerId, limit = 15 }: { customerId: string; limit?: number }) {
  const fetcher = useCallback(
    () =>
      fetch(`/api/audit?customerId=${customerId}&limit=${limit}`).then((r) => r.json()),
    [customerId, limit]
  );
  const { data } = usePolling<{ items: AuditItem[] }>(fetcher, 2500);
  const items = data?.items ?? [];

  return (
    <section className="card">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Activity className="h-4 w-4 text-blue-600" />
        Recent Activity
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-500">
          last {items.length}
        </span>
        <Link
          href={`/audit?customerId=${customerId}`}
          className="ml-auto text-xs font-normal text-blue-600 hover:underline"
        >
          full audit log →
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="rounded border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
          No events yet.
        </div>
      ) : (
        <ol className="relative space-y-1 border-l border-slate-200 pl-4">
          {items.map((r) => (
            <li key={r.id} className="relative pb-1.5 text-xs">
              <span className="absolute -left-[19px] mt-1 inline-block h-2 w-2 rounded-full bg-slate-300" />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-1 text-slate-400">
                  <Clock className="h-3 w-3" />
                  {relative(r.createdAt)}
                </span>
                {r.taskId && (
                  <span className="font-mono text-slate-500">task#{r.taskId}</span>
                )}
                {r.fromStatus && <StatusBadge status={r.fromStatus} size="sm" />}
                {r.fromStatus && r.toStatus && <span className="text-slate-300">→</span>}
                {r.toStatus && <StatusBadge status={r.toStatus} size="sm" />}
                <span className="text-slate-600">by</span>
                <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-700">
                  {r.actor ?? "—"}
                </code>
                {r.reason && (
                  <span className="text-slate-500">· {r.reason}</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function relative(iso: string) {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 0) return new Date(iso).toLocaleTimeString();
  if (diff < 5000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleString();
}
