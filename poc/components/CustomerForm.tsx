"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./ToastProvider";

const COUNTRIES = ["JP", "US", "DE", "FR", "GB", "CN", "KR", "IN", "AU", "CA"];
const INDUSTRIES = ["Auto", "Electronics", "Retail", "Pharma", "Energy"];
const CUSTOMER_TYPES = ["standard_b2b"];

const CURRENCY_BY_COUNTRY: Record<string, string> = {
  JP: "JPY", US: "USD", DE: "EUR", FR: "EUR", GB: "GBP",
  CN: "CNY", KR: "KRW", IN: "INR", AU: "AUD", CA: "CAD",
};

export default function CustomerForm() {
  const router = useRouter();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    country: "JP",
    industry: "Auto",
    customerType: "standard_b2b",
    legalEntity: "",
    defaultCurrency: "JPY",
  });

  function update<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((p) => {
      const next = { ...p, [k]: v };
      if (k === "country") next.defaultCurrency = CURRENCY_BY_COUNTRY[v as string] ?? p.defaultCurrency;
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.message ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      toast.push({
        kind: "success",
        title: `${data.customerId} created`,
        message: `${data.tasksTotal} tasks materialized, ${data.tasksReady} READY`,
      });
      router.push(`/customers/${data.customerId}`);
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.push({ kind: "error", title: "Create failed", message: msg });
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label">Customer Name *</label>
        <input
          className="input"
          required
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="e.g. Acme Japan"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Country *</label>
          <select
            className="input"
            value={form.country}
            onChange={(e) => update("country", e.target.value)}
          >
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Industry</label>
          <select
            className="input"
            value={form.industry}
            onChange={(e) => update("industry", e.target.value)}
          >
            {INDUSTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Customer Type *</label>
          <select
            className="input"
            value={form.customerType}
            onChange={(e) => update("customerType", e.target.value)}
          >
            {CUSTOMER_TYPES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Default Currency (auto from country)</label>
          <input
            className="input"
            value={form.defaultCurrency}
            onChange={(e) => update("defaultCurrency", e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="label">Legal Entity</label>
        <input
          className="input"
          value={form.legalEntity}
          onChange={(e) => update("legalEntity", e.target.value)}
          placeholder="e.g. Acme Japan KK"
        />
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-200 pt-4">
        <div className="text-xs text-slate-500">
          ⓘ 提交后会按 standard_b2b 模板物化 12 个任务，入度=0 的会进入 READY
        </div>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Creating..." : "Create Customer →"}
        </button>
      </div>
    </form>
  );
}
