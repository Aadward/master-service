"use client";

import Link from "next/link";
import { Plus, Database, GitBranch, ClipboardList } from "lucide-react";
import { usePolling } from "@/lib/usePolling";
import StatusBadge from "@/components/StatusBadge";
import ProgressBar from "@/components/ProgressBar";

interface CustomerRow {
  customerId: string;
  custNo: string;
  custName: string;
  globalCustNo?: string | null;
  regionNo?: string | null;
  companyNo?: string | null;
  isMaster: boolean;
  isInterCompany: boolean;
  customerType: string;
  overallStatus: string;
  tasksTotal: number;
  tasksDone: number;
  tasksFailed: number;
  locationsCount: number;
  createdAt: string;
}

export default function DashboardPage() {
  const { data, loading } = usePolling<{ items: CustomerRow[] }>(
    () => fetch("/api/customers").then((r) => r.json()),
    1500
  );

  const items = data?.items ?? [];
  const stats = {
    total: items.length,
    done: items.filter((c) => c.overallStatus === "READY").length,
    running: items.filter((c) => c.overallStatus === "IN_PROGRESS").length,
    failed: items.filter((c) => c.overallStatus === "PARTIAL").length,
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            所有客户的配置进度全景。Master-service 只维护最小集合 + 任务状态，不存域内配置。
          </p>
        </div>
        <Link href="/customers/new" className="btn btn-primary">
          <Plus className="h-4 w-4" />
          Create Customer
        </Link>
      </header>

      <section className="grid grid-cols-4 gap-3">
        <StatCard icon={<Database className="h-4 w-4" />} label="Total" value={stats.total} color="text-slate-700" />
        <StatCard icon={<ClipboardList className="h-4 w-4" />} label="Ready" value={stats.done} color="text-emerald-600" />
        <StatCard icon={<GitBranch className="h-4 w-4" />} label="In Progress" value={stats.running} color="text-blue-600" />
        <StatCard icon={<ClipboardList className="h-4 w-4" />} label="Partial / Stuck" value={stats.failed} color="text-amber-600" />
      </section>

      <section className="card">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Customers</h2>
        {loading && !items.length ? (
          <div className="py-12 text-center text-sm text-slate-500">Loading…</div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-slate-200 py-12 text-center">
            <p className="text-sm text-slate-500">还没有客户。</p>
            <Link href="/customers/new" className="mt-3 inline-flex btn btn-primary">
              <Plus className="h-4 w-4" />
              Create your first customer
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((c) => (
              <Link
                key={c.customerId}
                href={`/customers/${c.customerId}`}
                className="flex items-center gap-4 py-3 transition hover:bg-slate-50"
              >
                <div className="w-28 font-mono text-sm text-slate-700">{c.custNo}</div>
                <div className="flex-1">
                  <div className="font-medium text-slate-900">{c.custName}</div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{c.regionNo ?? "—"}</span>
                    <span className="text-slate-300">·</span>
                    <span>company {c.companyNo ?? "—"}</span>
                    {c.isMaster && (
                      <span className="rounded bg-indigo-100 px-1 py-0.5 text-[10px] font-semibold text-indigo-700">
                        master
                      </span>
                    )}
                    {c.isInterCompany && (
                      <span className="rounded bg-violet-100 px-1 py-0.5 text-[10px] font-semibold text-violet-700">
                        inter-company
                      </span>
                    )}
                    {c.locationsCount > 0 && (
                      <span className="text-[11px] text-slate-400">
                        · {c.locationsCount} loc
                      </span>
                    )}
                  </div>
                </div>
                <div className="w-48">
                  <ProgressBar done={c.tasksDone} total={c.tasksTotal} failed={c.tasksFailed} />
                </div>
                <div className="w-32 text-right">
                  <StatusBadge status={c.overallStatus} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  icon, label, value, color,
}: {
  icon: React.ReactNode; label: string; value: number; color: string;
}) {
  return (
    <div className="card flex items-center gap-3">
      <div className={`rounded-md bg-slate-100 p-2 ${color}`}>{icon}</div>
      <div>
        <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
        <div className="text-xl font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  );
}
