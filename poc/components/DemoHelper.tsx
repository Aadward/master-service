"use client";

import { Play, FastForward, AlertTriangle, SkipForward, RotateCcw } from "lucide-react";
import { useState } from "react";

/**
 * Demo Helper：让一个人就能完整演示工作流而无需切到模块工作台
 */
export default function DemoHelper({
  customerId,
  onChange,
}: {
  customerId: string;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function call(mode: string) {
    setBusy(true);
    try {
      await fetch(`/api/customers/${customerId}/auto-step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function runAll() {
    setBusy(true);
    try {
      // 最多 50 步保护；每步间隔 300ms 看动画
      for (let i = 0; i < 50; i++) {
        const r = await fetch(`/api/customers/${customerId}/auto-step`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "step" }),
        });
        const j = await r.json();
        onChange();
        if (!j.stepped) break;
        await new Promise((res) => setTimeout(res, 300));
      }
    } finally {
      setBusy(false);
    }
  }

  const Btn = ({
    onClick, icon, label, danger, primary,
  }: {
    onClick: () => void; icon: React.ReactNode; label: string;
    danger?: boolean; primary?: boolean;
  }) => (
    <button
      disabled={busy}
      onClick={onClick}
      className={`btn w-full justify-center ${primary ? "btn-primary" : ""} ${danger ? "btn-danger" : ""}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="card space-y-2">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Demo Helper
      </div>
      <Btn icon={<Play className="h-4 w-4" />} label="▶ Step Once" onClick={() => call("step")} />
      <Btn primary icon={<FastForward className="h-4 w-4" />} label="⏩ Run All" onClick={runAll} />
      <Btn danger icon={<AlertTriangle className="h-4 w-4" />} label="💥 Fail Random" onClick={() => call("failRandom")} />
      <Btn icon={<SkipForward className="h-4 w-4" />} label="⏭ Skip Random" onClick={() => call("skipRandom")} />
      <Btn icon={<RotateCcw className="h-4 w-4" />} label="🔄 Retry All Failed" onClick={() => call("retryAllFailed")} />
      <div className="pt-1 text-[10px] text-slate-400">
        ⓘ Demo 按钮直接模拟下游回执，跳过 claim
      </div>
    </div>
  );
}
