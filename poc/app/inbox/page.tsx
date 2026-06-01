"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Inbox,
  CheckCircle2,
  XCircle,
  SkipForward,
  RotateCcw,
  ExternalLink,
  MapPin,
  Sparkles,
  Users,
  AlertTriangle,
} from "lucide-react";

import { usePolling } from "@/lib/usePolling";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import StatusBadge from "@/components/StatusBadge";
import { useToast } from "@/components/ToastProvider";

const DEFAULT_DOMAINS = ["sales", "crm", "finance", "mrp", "plm"];

interface Task {
  taskId: number;
  taskKey: string;
  pageRef?: string | null;
  status: string;
  customerId: string;
  customerName: string;
  customerMinData: Record<string, unknown>;
  suggestedConfig: Record<string, unknown> | null;
  claimOwner?: string | null;
  claimedAt?: string | null;
  claimTimeoutAt?: string | null;
  retryCount: number;
  lastErrorCode?: string | null;
  lastErrorMsg?: string | null;
  readyAt?: string | null;
  completedAt?: string | null;
}

interface Resp {
  domain: string;
  owner: string;
  available: Task[];
  claimedByMe: Task[];
  claimedByOthers: Task[];
  failed: Task[];
  recentlyDone: Task[];
  domainCounts: Record<string, { pending: number; failed: number }>;
}

export default function InboxPage({
  searchParams,
}: {
  searchParams: { domain?: string; owner?: string };
}) {
  const domain = (searchParams.domain ?? "sales").toLowerCase();
  const defaultOwner = `${domain}-team-owner`;
  const [owner, setOwner] = useState<string>(searchParams.owner ?? defaultOwner);

  // 从后端拉取实际启用的模块列表（避免硬编码漂移）
  const [domainsList, setDomainsList] = useState<string[]>(DEFAULT_DOMAINS);
  useEffect(() => {
    fetch("/api/modules")
      .then((r) => r.json())
      .then((j: { items: string[] }) => {
        if (Array.isArray(j.items) && j.items.length > 0) setDomainsList(j.items);
      })
      .catch(() => {
        // 保留默认值，不打扰
      });
  }, []);

  // 当用户从 URL 切 domain 时，自动同步 owner 默认值（如果当前 owner 还是上个 domain 的默认值）
  useEffect(() => {
    if (
      !searchParams.owner &&
      !domainsList.every((d) => owner !== `${d}-team-owner` || d === domain)
    ) {
      setOwner(`${domain}-team-owner`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, domainsList]);

  // owner 输入框 debounce，避免每次键入都触发轮询切换
  const debouncedOwner = useDebouncedValue(owner, 350);

  const fetcher = useCallback(
    () =>
      fetch(`/api/inbox?domain=${domain}&owner=${encodeURIComponent(debouncedOwner)}`).then((r) =>
        r.json()
      ),
    [domain, debouncedOwner]
  );
  const { data, refresh } = usePolling<Resp>(fetcher, 1500);

  const toast = useToast();
  async function act(taskId: number, path: string, body?: object) {
    const res = await fetch(`/api/tasks/${taskId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      toast.push({ kind: "error", title: `${path} failed`, message: j?.message ?? res.statusText });
    } else {
      toast.push({ kind: "success", message: `${path} succeeded` });
    }
    refresh();
  }

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      available: data.available.length,
      mine: data.claimedByMe.length,
      others: data.claimedByOthers.length,
      failed: data.failed.length,
    };
  }, [data]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-blue-100 p-2 text-blue-700">
            <Inbox className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Configuration Inbox</h1>
            <p className="text-sm text-slate-500">
              你的域团队待办的客户配置任务。
              <span className="text-slate-400">
                实际配置在你的 {domain.toUpperCase()} 系统里完成，回来 Confirm 即可。
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Users className="h-4 w-4 text-slate-400" />
          <span className="text-slate-500">You are:</span>
          <input
            className="input !w-60 !py-1 !text-sm"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="e.g. sales-alice"
          />
          <span className="text-xs text-slate-400">
            POC 用：直接编辑这个字段就能模拟切换"团队不同成员"
          </span>
        </div>
      </header>

      {/* Domain tabs */}
      <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {domainsList.map((d) => {
          const cnt = data?.domainCounts[d] ?? { pending: 0, failed: 0 };
          const active = d === domain;
          return (
            <Link
              key={d}
              href={`/inbox?domain=${d}`}
              className={[
                "rounded-md px-3 py-1.5 text-sm transition",
                active
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-white text-slate-600 hover:bg-slate-100",
              ].join(" ")}
            >
              <span className="font-medium capitalize">{d}</span>
              {cnt.pending > 0 && (
                <span
                  className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${
                    active ? "bg-blue-700" : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {cnt.pending}
                </span>
              )}
              {cnt.failed > 0 && (
                <span
                  className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] ${
                    active ? "bg-red-500" : "bg-red-100 text-red-700"
                  }`}
                >
                  ⚠ {cnt.failed}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Quick stats */}
      {totals && (
        <div className="flex gap-2">
          <Tag color="blue" label="Available" value={totals.available} />
          <Tag color="amber" label="In your queue" value={totals.mine} />
          {totals.others > 0 && <Tag color="slate" label="Claimed by others" value={totals.others} />}
          {totals.failed > 0 && <Tag color="red" label="Failed" value={totals.failed} />}
        </div>
      )}

      {/* In your queue */}
      <section>
        <SectionHeader
          icon={<Inbox className="h-4 w-4 text-amber-600" />}
          title="In your queue"
          subtitle="你已认领，等你在系统里配完后回来 Confirm"
          count={data?.claimedByMe.length ?? 0}
        />
        {data?.claimedByMe.length === 0 ? (
          <EmptyHint>当前没有你认领的任务。从下方 Available 列表认领一个开始。</EmptyHint>
        ) : (
          <div className="space-y-3">
            {data?.claimedByMe.map((t) => (
              <PendingCard key={t.taskId} task={t} domain={domain} owner={owner} act={act} />
            ))}
          </div>
        )}
      </section>

      {/* Available */}
      <section>
        <SectionHeader
          icon={<Sparkles className="h-4 w-4 text-blue-600" />}
          title="Available to claim"
          subtitle={`${domain.toUpperCase()} 域中等待领取的配置任务`}
          count={data?.available.length ?? 0}
        />
        {data?.available.length === 0 ? (
          <EmptyHint>当前 {domain.toUpperCase()} 没有可领取的任务。等上游 DAG 推进。</EmptyHint>
        ) : (
          <div className="space-y-2">
            {data?.available.map((t) => (
              <AvailableRow key={t.taskId} task={t} owner={owner} act={act} />
            ))}
          </div>
        )}
      </section>

      {/* Failed */}
      {data?.failed && data.failed.length > 0 && (
        <section>
          <SectionHeader
            icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
            title="Failed (need attention)"
            subtitle="需要人工介入：修复后点 Retry 让它重新进入 Available"
            count={data.failed.length}
          />
          <div className="space-y-2">
            {data.failed.map((t) => (
              <FailedRow key={t.taskId} task={t} act={act} />
            ))}
          </div>
        </section>
      )}

      {/* Claimed by others */}
      {data?.claimedByOthers && data.claimedByOthers.length > 0 && (
        <section className="opacity-70">
          <SectionHeader
            icon={<Users className="h-4 w-4 text-slate-500" />}
            title="Being handled by others"
            subtitle="只读：同域中其他人正在处理的任务"
            count={data.claimedByOthers.length}
          />
          <ul className="space-y-1 text-sm">
            {data.claimedByOthers.map((t) => (
              <li key={t.taskId} className="rounded border border-slate-200 bg-white px-3 py-2">
                <div className="flex items-center gap-2">
                  <Link href={`/customers/${t.customerId}`} className="font-mono text-xs text-slate-500 hover:underline">
                    {t.customerId}
                  </Link>
                  <span className="text-slate-600">·</span>
                  <code className="text-slate-700">{t.taskKey}</code>
                  <span className="ml-auto text-xs text-slate-500">
                    claimed by <code>{t.claimOwner}</code>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Recently done (context) */}
      {data?.recentlyDone && data.recentlyDone.length > 0 && (
        <section>
          <SectionHeader
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
            title="Recently completed"
            subtitle="本域最近完成的任务（参考用）"
            count={data.recentlyDone.length}
          />
          <ul className="space-y-1 text-sm">
            {data.recentlyDone.map((t) => (
              <li key={t.taskId} className="flex items-center gap-2 rounded border border-slate-100 bg-white px-3 py-1.5">
                <Link href={`/customers/${t.customerId}`} className="font-mono text-xs text-slate-500 hover:underline">
                  {t.customerId}
                </Link>
                <code className="text-xs text-slate-600">{t.taskKey}</code>
                <StatusBadge status={t.status} size="sm" />
                <span className="ml-auto text-xs text-slate-400">
                  {t.completedAt ? new Date(t.completedAt).toLocaleString() : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Cards & rows
// ────────────────────────────────────────────────────────────

function PendingCard({
  task,
  domain,
  owner,
  act,
}: {
  task: Task;
  domain: string;
  owner: string;
  act: (id: number, path: string, body?: object) => Promise<void>;
}) {
  const hasSuggestions =
    task.suggestedConfig && Object.keys(task.suggestedConfig).length > 0;

  return (
    <article className="rounded-lg border border-amber-200 bg-white shadow-sm">
      {/* card header */}
      <div className="flex items-start justify-between border-b border-amber-100 bg-amber-50 px-4 py-2">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href={`/customers/${task.customerId}`}
              className="font-mono text-xs text-slate-500 hover:underline"
            >
              {task.customerId}
            </Link>
            <span className="font-semibold text-slate-900">{task.customerName}</span>
            <StatusBadge status={task.status} size="sm" />
          </div>
          <code className="text-sm text-slate-700">{task.taskKey}</code>
        </div>
        <div className="text-right text-xs text-slate-500">
          claimed by <code>{task.claimOwner}</code>
          {task.claimedAt && (
            <div>{new Date(task.claimedAt).toLocaleString()}</div>
          )}
        </div>
      </div>

      {/* body */}
      <div className="grid grid-cols-2 gap-4 px-4 py-3">
        {/* Customer info */}
        <div>
          <SubHeader>
            <MapPin className="h-3.5 w-3.5" />
            Customer Info（最小集合，供你参考）
          </SubHeader>
          <dl className="mt-2 space-y-1 text-sm">
            {Object.entries(task.customerMinData)
              .filter(([, v]) => v !== null && v !== "")
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="font-mono text-slate-800">{String(v)}</dd>
                </div>
              ))}
          </dl>
        </div>

        {/* Configuration guidance */}
        <div>
          <SubHeader>
            <Sparkles className="h-3.5 w-3.5" />
            建议配置项（指引）
          </SubHeader>
          {hasSuggestions ? (
            <ul className="mt-2 space-y-1 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
              {Object.entries(task.suggestedConfig!).map(([k, v]) => (
                <li key={k} className="flex items-baseline justify-between gap-3">
                  <span className="text-slate-700">{k}</span>
                  <code className="font-mono text-blue-900">
                    {v === null || v === "" ? "—" : String(v)}
                  </code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              此任务没有派生建议。请按 {domain.toUpperCase()} 团队的标准流程填写。
            </p>
          )}
        </div>
      </div>

      {/* "Go configure" hint */}
      <div className="mx-4 mb-3 flex items-start gap-2 rounded-md border border-dashed border-blue-300 bg-blue-50/40 px-3 py-2 text-xs text-blue-800">
        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          <div className="font-semibold">
            👉 请在你自己的 {domain.toUpperCase()} 系统里打开{" "}
            <code className="rounded bg-blue-100 px-1 py-0.5">
              {task.pageRef ?? "<page>"}
            </code>{" "}
            并按上方建议完成配置。
          </div>
          <div className="text-blue-700">
            完成后回到这里点 <b>Confirm Done</b>。Master-service 不会持有也不会校验你填的值，
            真相在你的系统里。
          </div>
        </div>
      </div>

      {/* actions */}
      <div className="flex gap-2 border-t border-slate-100 px-4 py-3">
        <button
          className="btn btn-primary flex-1 justify-center"
          onClick={() =>
            act(task.taskId, "done", {
              owner,
              note: "confirmed done via inbox",
            })
          }
        >
          <CheckCircle2 className="h-4 w-4" />
          Confirm Done
        </button>
        <button
          className="btn btn-danger justify-center"
          onClick={() =>
            act(task.taskId, "failed", {
              owner,
              reasonCode: "VALIDATION_FAILED",
              message: "marked failed from inbox",
            })
          }
        >
          <XCircle className="h-4 w-4" />
          Mark Failed
        </button>
        <button
          className="btn justify-center"
          onClick={() =>
            act(task.taskId, "skip", {
              owner,
              reason: "not applicable for this customer",
            })
          }
        >
          <SkipForward className="h-4 w-4" />
          Skip
        </button>
      </div>
    </article>
  );
}

function AvailableRow({
  task,
  owner,
  act,
}: {
  task: Task;
  owner: string;
  act: (id: number, path: string, body?: object) => Promise<void>;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-blue-200 bg-white px-3 py-2 transition hover:border-blue-400 hover:shadow-sm">
      <Link
        href={`/customers/${task.customerId}`}
        className="font-mono text-xs text-slate-500 hover:underline"
      >
        {task.customerId}
      </Link>
      <span className="text-sm font-medium text-slate-800">{task.customerName}</span>
      <span className="text-slate-300">·</span>
      <code className="text-sm text-slate-700">{task.taskKey}</code>
      {task.pageRef && (
        <span className="text-xs text-slate-400">→ {task.pageRef}</span>
      )}
      <StatusBadge status={task.status} size="sm" />
      <button
        className="btn btn-primary ml-auto"
        onClick={() => act(task.taskId, "claim", { owner, ttlMinutes: 30 })}
      >
        Claim
      </button>
    </div>
  );
}

function FailedRow({
  task,
  act,
}: {
  task: Task;
  act: (id: number, path: string, body?: object) => Promise<void>;
}) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50/40 p-3">
      <div className="flex items-center gap-2">
        <Link
          href={`/customers/${task.customerId}`}
          className="font-mono text-xs text-slate-500 hover:underline"
        >
          {task.customerId}
        </Link>
        <span className="text-sm font-medium text-slate-800">{task.customerName}</span>
        <span className="text-slate-300">·</span>
        <code className="text-sm text-slate-700">{task.taskKey}</code>
        <StatusBadge status={task.status} size="sm" />
        <span className="ml-auto text-xs text-red-600">retry: {task.retryCount}</span>
      </div>
      {task.lastErrorMsg && (
        <div className="mt-1 ml-1 text-xs text-red-700">
          <span className="font-semibold">{task.lastErrorCode}:</span> {task.lastErrorMsg}
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <button className="btn btn-primary" onClick={() => act(task.taskId, "retry")}>
          <RotateCcw className="h-4 w-4" /> Retry
        </button>
        <button
          className="btn"
          onClick={() =>
            act(task.taskId, "skip", { reason: "skipped after failure" })
          }
        >
          <SkipForward className="h-4 w-4" /> Skip
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  subtitle,
  count,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count: number;
}) {
  return (
    <div className="mb-2 flex items-end justify-between">
      <div className="flex items-center gap-2">
        {icon}
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            {title}{" "}
            <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-600">
              {count}
            </span>
          </h2>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

function SubHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/50 px-3 py-4 text-center text-xs text-slate-400">
      {children}
    </div>
  );
}

function Tag({
  color,
  label,
  value,
}: {
  color: "blue" | "amber" | "red" | "slate";
  label: string;
  value: number;
}) {
  const colorMap = {
    blue: "border-blue-200 bg-blue-50 text-blue-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-red-200 bg-red-50 text-red-800",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  };
  return (
    <div className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${colorMap[color]}`}>
      <span>{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
