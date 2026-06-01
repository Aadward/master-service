"use client";

import { useEffect, useMemo, useState } from "react";
import yaml from "js-yaml";
import { useToast } from "./ToastProvider";
import { CheckCircle2, AlertTriangle, X, Save } from "lucide-react";

const SKELETON = `customer_type: my_new_type
version: 1
description: "Describe this template"
modules:
  sales:
    tasks:
      - task_key: sales.example_task
        page_ref: Sales-Page-01
        required: true
        depends_on: []
        suggestions:
          example_field: "static value"
          another_field: "\${customer.regionNo}"
`;

interface ParseState {
  ok: boolean;
  message?: string;
  preview?: { customerType: string; version: number; taskCount: number; modules: string[] };
}

export default function TemplateEditor({
  initialYaml,
  title,
  onClose,
  onSaved,
}: {
  initialYaml?: string;
  title: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState<string>(initialYaml ?? SKELETON);
  const [submitting, setSubmitting] = useState(false);

  // 客户端 YAML 解析 + 结构预览
  const parseState: ParseState = useMemo(() => {
    try {
      const v = yaml.load(text) as any;
      if (!v || typeof v !== "object") return { ok: false, message: "not an object" };
      if (typeof v.customer_type !== "string") return { ok: false, message: "customer_type required" };
      if (typeof v.version !== "number") return { ok: false, message: "version required (integer)" };
      if (!v.modules || typeof v.modules !== "object") return { ok: false, message: "modules required" };

      const modules = Object.keys(v.modules);
      let taskCount = 0;
      const seen = new Set<string>();
      for (const m of modules) {
        const mod = v.modules[m];
        if (!Array.isArray(mod?.tasks)) return { ok: false, message: `modules.${m}.tasks must be array` };
        for (const t of mod.tasks) {
          if (typeof t?.task_key !== "string") return { ok: false, message: `task in ${m} missing task_key` };
          if (seen.has(t.task_key)) return { ok: false, message: `duplicate task_key: ${t.task_key}` };
          seen.add(t.task_key);
          taskCount++;
        }
      }
      return {
        ok: true,
        preview: {
          customerType: v.customer_type,
          version: v.version,
          taskCount,
          modules,
        },
      };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? "yaml parse error" };
    }
  }, [text]);

  async function save() {
    if (!parseState.ok) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml: text }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.message ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      toast.push({
        kind: "success",
        title: `Saved ${j.templateId} v${j.version}`,
        message: `${j.tasksCount} tasks · activated`,
      });
      onSaved();
      onClose();
    } catch (e) {
      toast.push({ kind: "error", title: "Save failed", message: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card space-y-3 border-blue-300 ring-2 ring-blue-100">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <button onClick={onClose} className="btn btn-ghost p-1.5">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* YAML 编辑区 */}
      <textarea
        spellCheck={false}
        className="block h-96 w-full resize-y rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {/* 解析状态 */}
      {parseState.ok ? (
        <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">
          <span className="flex items-center gap-1.5 text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            YAML 解析通过
          </span>
          <span className="text-emerald-700">
            <code className="font-mono">{parseState.preview!.customerType}</code> v{parseState.preview!.version} ·{" "}
            {parseState.preview!.taskCount} tasks ·{" "}
            {parseState.preview!.modules.length} modules（{parseState.preview!.modules.join(", ")}）
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4" />
          <span className="font-mono">{parseState.message}</span>
        </div>
      )}

      {/* 操作 */}
      <div className="flex items-center justify-between border-t border-slate-100 pt-3">
        <p className="text-[11px] text-slate-500">
          ⓘ 保存后会激活该 (customer_type, version)，并自动 deactivate 同 customer_type 的其他版本
        </p>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!parseState.ok || submitting}
            className="btn btn-primary"
          >
            <Save className="h-4 w-4" />
            {submitting ? "Saving..." : "Save & Activate"}
          </button>
        </div>
      </div>
    </div>
  );
}
