"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { usePolling } from "@/lib/usePolling";
import StatusBadge from "@/components/StatusBadge";
import ProgressBar from "@/components/ProgressBar";
import ModulePills from "@/components/ModulePills";
import DAGViewer, { type DAGTaskInput, type DAGEdgeInput } from "@/components/DAGViewer";
import TaskDetailPanel, { type PanelTask } from "@/components/TaskDetailPanel";
import DemoHelper from "@/components/DemoHelper";
import RecentActivity from "@/components/RecentActivity";

interface DAGNode {
  taskId: number;
  taskKey: string;
  module: string;
  status: string;
  pageRef?: string | null;
  claimOwner?: string | null;
  claimedAt?: string | null;
  claimTimeoutAt?: string | null;
  retryCount?: number;
  lastErrorCode?: string | null;
  lastErrorMsg?: string | null;
  dependsOn: string[];
  suggestedConfig: Record<string, unknown> | null;
}

interface DAGResp {
  customerId: string;
  customerName: string;
  overallStatus: string;
  customerMinData: Record<string, unknown>;
  nodes: DAGNode[];
  edges: Array<{ from: number; to: number; fromKey: string; toKey: string }>;
}

interface StatusResp {
  overallStatus: string;
  progress: Record<string, number>;
  progressDone: number;
  modules: Record<string, { total: number; done: number; failed: number }>;
  blockers: Array<{
    taskId: number;
    taskKey: string;
    reasonCode?: string | null;
    message?: string | null;
  }>;
}

const POLL_MS = 2000;

export default function CustomerDetailPage({ params }: { params: { id: string } }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const dagFetcher = useCallback(
    () =>
      fetch(`/api/customers/${params.id}/dag`).then(async (r) => {
        if (r.status === 404) return { __notFound: true } as any;
        return r.json();
      }),
    [params.id]
  );
  const statusFetcher = useCallback(
    () => fetch(`/api/customers/${params.id}/status`).then((r) => r.json()),
    [params.id]
  );
  const { data: dag, refresh: refreshDag } = usePolling<DAGResp>(dagFetcher, POLL_MS);
  const { data: status, refresh: refreshStatus } = usePolling<StatusResp>(statusFetcher, POLL_MS);

  // 手动 refresh（demo helper / 抽屉里的操作触发）
  useEffect(() => {
    if (refreshTick > 0) {
      refreshDag();
      refreshStatus();
    }
  }, [refreshTick, refreshDag, refreshStatus]);
  const onChange = useCallback(() => setRefreshTick((t) => t + 1), []);

  // ESC 关闭详情抽屉
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && selected != null) setSelected(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  // DAG → 给 DAGViewer 用的精简数据；用 useMemo 稳定引用，避免 viewer 多次 layout
  const dagTasks = useMemo<DAGTaskInput[]>(() => {
    if (!dag) return [];
    return dag.nodes.map((n) => ({
      taskId: n.taskId,
      taskKey: n.taskKey,
      module: n.module,
      status: n.status,
      retryCount: n.retryCount,
      lastErrorCode: n.lastErrorCode,
    }));
  }, [dag]);

  const dagEdges = useMemo<DAGEdgeInput[]>(() => {
    if (!dag) return [];
    return dag.edges.map((e) => ({ from: e.from, to: e.to }));
  }, [dag]);

  // 选中节点的完整数据（从 DAG 响应里挑出来，避免 panel 自己 fetch）
  const selectedTask = useMemo<PanelTask | null>(() => {
    if (!selected || !dag) return null;
    const n = dag.nodes.find((x) => x.taskId === selected);
    if (!n) return null;
    return {
      taskId: n.taskId,
      taskKey: n.taskKey,
      module: n.module,
      pageRef: n.pageRef,
      status: n.status,
      dependsOn: n.dependsOn ?? [],
      suggestedConfig: n.suggestedConfig,
      claimOwner: n.claimOwner,
      claimedAt: n.claimedAt,
      claimTimeoutAt: n.claimTimeoutAt,
      retryCount: n.retryCount ?? 0,
      lastErrorCode: n.lastErrorCode,
      lastErrorMsg: n.lastErrorMsg,
      customerMinData: dag.customerMinData,
    };
  }, [selected, dag]);

  if (!dag) {
    return <div className="text-sm text-slate-400">Loading…</div>;
  }
  if ((dag as any).__notFound) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-xl font-bold">Customer not found</h1>
        <p className="mt-2 text-sm text-slate-600">
          客户 <code>{params.id}</code> 不存在，或已被删除。
        </p>
        <Link href="/" className="btn btn-primary mt-6">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const total = status?.progress.total ?? dagTasks.length;
  const done = status ? (status.progress.done ?? 0) + (status.progress.skipped ?? 0) : 0;
  const failed = status?.progress.failed ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="btn btn-ghost p-1.5">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="font-mono text-xs text-slate-500">{dag.customerId}</div>
            <h1 className="text-xl font-bold">{dag.customerName}</h1>
          </div>
          <StatusBadge status={dag.overallStatus} />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span>
            {done} / {total} done
          </span>
          {failed > 0 && <span className="text-red-600">· {failed} failed</span>}
        </div>
      </header>

      {/* Top strip: min data + modules + progress */}
      <section className="grid grid-cols-12 gap-4">
        <div className="card col-span-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Customer Min Data
          </div>
          <dl className="space-y-1 text-sm">
            {Object.entries(dag.customerMinData).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-slate-500">{k}</dt>
                <dd className="font-mono text-slate-800">
                  {v == null || v === "" ? "—" : String(v)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="card col-span-8 flex flex-col justify-between">
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Modules Progress
            </div>
            {status?.modules && <ModulePills modules={status.modules} />}
          </div>
          <div className="mt-3">
            <ProgressBar done={done} total={total} failed={failed} />
          </div>
          {status?.blockers && status.blockers.length > 0 && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              <div className="font-semibold">Blockers:</div>
              <ul className="mt-1 space-y-0.5">
                {status.blockers.map((b) => (
                  <li key={b.taskId}>
                    <button
                      className="underline-offset-2 hover:underline"
                      onClick={() => setSelected(b.taskId)}
                    >
                      <code>{b.taskKey}</code>
                    </button>
                    {" — "}
                    {b.reasonCode}: {b.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* Main: DAG + side */}
      <section
        className="grid grid-cols-12 gap-4"
        style={{ minHeight: "calc(100vh - 320px)" }}
      >
        <div className="col-span-2">
          <DemoHelper customerId={dag.customerId} onChange={onChange} />
        </div>
        <div className="card col-span-7 overflow-hidden p-0">
          <div className="border-b border-slate-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Task DAG · 点击节点查看详情
          </div>
          <div className="h-[600px]">
            <DAGViewer
              tasks={dagTasks}
              edges={dagEdges}
              selectedTaskId={selected}
              onSelect={(id) => setSelected(id < 0 ? null : id)}
            />
          </div>
        </div>
        <div className="col-span-3 h-[640px]">
          <TaskDetailPanel
            task={selectedTask}
            onClose={() => setSelected(null)}
            onActionDone={onChange}
          />
        </div>
      </section>

      {/* Bottom: per-customer audit timeline */}
      <RecentActivity customerId={dag.customerId} />
    </div>
  );
}
