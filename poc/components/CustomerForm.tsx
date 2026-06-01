"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./ToastProvider";
import { MapPin, Plus, X } from "lucide-react";

const REGION_OPTIONS = ["10001", "10002", "10006", "10007"];
const DIGITS_RE = /^\d+$/;

interface LocRow {
  domain: string;
  locNo: string;
}

export default function CustomerForm() {
  const router = useRouter();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 标量字段
  const [form, setForm] = useState({
    custNo: "",
    custName: "",
    globalCustNo: "",
    globalCustName: "",
    globalCustCode: "",
    regionNo: "10001",
    companyNo: "",
    isMaster: false,
    isInterCompany: false,
  });

  // 从后端动态拉取可用模块，作为 location domain 候选
  const [domains, setDomains] = useState<string[]>(["sales", "mrp", "crm", "finance", "plm"]);
  useEffect(() => {
    fetch("/api/modules")
      .then((r) => r.json())
      .then((j: { items: string[] }) => {
        if (Array.isArray(j.items) && j.items.length > 0) setDomains(j.items);
      })
      .catch(() => {});
  }, []);

  // 一对多 locations
  const [locations, setLocations] = useState<LocRow[]>([{ domain: "sales", locNo: "" }]);

  function update<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }
  /** 只接受数字字符串（允许空） */
  function updateDigits<K extends keyof typeof form>(k: K, raw: string) {
    if (raw === "" || /^\d+$/.test(raw)) {
      update(k, raw as any);
    }
  }
  function setLoc(i: number, patch: Partial<LocRow>) {
    setLocations((p) =>
      p.map((l, idx) => {
        if (idx !== i) return l;
        // 若 patch 里包含 locNo，强制为数字（空允许）
        if (patch.locNo !== undefined && patch.locNo !== "" && !/^\d+$/.test(patch.locNo)) {
          return l; // 拒绝非数字输入
        }
        return { ...l, ...patch };
      })
    );
  }
  function addLoc() {
    const used = new Set(locations.map((l) => l.domain));
    const next = domains.find((d) => !used.has(d)) ?? domains[0] ?? "sales";
    setLocations((p) => [...p, { domain: next, locNo: "" }]);
  }
  function removeLoc(i: number) {
    setLocations((p) => p.filter((_, idx) => idx !== i));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    // 数字字段校验
    if (!DIGITS_RE.test(form.custNo)) {
      const msg = "cust_no must be digits only";
      setError(msg); toast.push({ kind: "error", message: msg }); setSubmitting(false); return;
    }
    if (form.globalCustNo && !DIGITS_RE.test(form.globalCustNo)) {
      const msg = "global_cust_no must be digits only";
      setError(msg); toast.push({ kind: "error", message: msg }); setSubmitting(false); return;
    }
    if (!DIGITS_RE.test(form.companyNo)) {
      const msg = "company_no must be digits only";
      setError(msg); toast.push({ kind: "error", message: msg }); setSubmitting(false); return;
    }
    if (!REGION_OPTIONS.includes(form.regionNo)) {
      const msg = `region_no must be one of ${REGION_OPTIONS.join(", ")}`;
      setError(msg); toast.push({ kind: "error", message: msg }); setSubmitting(false); return;
    }

    // locations 去重 + 忽略空 locNo + locNo 必须为数字
    const filledLocs = locations.filter((l) => l.locNo.trim() !== "");
    const dups = new Set<string>();
    for (const l of filledLocs) {
      if (!DIGITS_RE.test(l.locNo)) {
        const msg = `loc_no must be digits only (got '${l.locNo}' for ${l.domain})`;
        setError(msg); toast.push({ kind: "error", title: "Validation", message: msg });
        setSubmitting(false); return;
      }
      if (dups.has(l.domain)) {
        const msg = `Duplicate location domain: ${l.domain}`;
        setError(msg); toast.push({ kind: "error", title: "Validation", message: msg });
        setSubmitting(false); return;
      }
      dups.add(l.domain);
    }

    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, locations: filledLocs }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.message ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      toast.push({
        kind: "success",
        title: `${data.custNo} created`,
        message: `${data.tasksTotal} tasks · ${data.tasksReady} READY · ${data.locationsCount} loc(s)`,
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
    <form onSubmit={onSubmit} className="space-y-5">
      {/* === 身份字段 === */}
      <fieldset className="space-y-3">
        <legend className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Customer Identification
        </legend>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">cust_no *</label>
            <input
              className="input"
              required
              inputMode="numeric"
              pattern="\d+"
              value={form.custNo}
              onChange={(e) => updateDigits("custNo", e.target.value)}
              placeholder="digits only, e.g. 100001"
            />
          </div>
          <div>
            <label className="label">cust_name *</label>
            <input
              className="input"
              required
              value={form.custName}
              onChange={(e) => update("custName", e.target.value)}
              placeholder="e.g. WOODY"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">global_cust_no</label>
            <input
              className="input"
              inputMode="numeric"
              pattern="\d*"
              value={form.globalCustNo}
              onChange={(e) => updateDigits("globalCustNo", e.target.value)}
              placeholder="digits only, e.g. 900001"
            />
          </div>
          <div>
            <label className="label">global_cust_name</label>
            <input
              className="input"
              value={form.globalCustName}
              onChange={(e) => update("globalCustName", e.target.value)}
              placeholder="e.g. WOODY"
            />
          </div>
        </div>
        <div>
          <label className="label">global_cust_code</label>
          <input
            className="input"
            value={form.globalCustCode}
            onChange={(e) => update("globalCustCode", e.target.value)}
            placeholder="e.g. ACME"
          />
        </div>
      </fieldset>

      {/* === 组织属性 === */}
      <fieldset className="space-y-3 border-t border-slate-200 pt-4">
        <legend className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Organization
        </legend>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">region_no *</label>
            <select
              className="input"
              value={form.regionNo}
              onChange={(e) => update("regionNo", e.target.value)}
            >
              {REGION_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">company_no *</label>
            <input
              className="input"
              required
              inputMode="numeric"
              pattern="\d+"
              value={form.companyNo}
              onChange={(e) => updateDigits("companyNo", e.target.value)}
              placeholder="digits only, e.g. 1001"
            />
          </div>
        </div>
        <div className="flex gap-6 pt-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={form.isMaster}
              onChange={(e) => update("isMaster", e.target.checked)}
            />
            is_master
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={form.isInterCompany}
              onChange={(e) => update("isInterCompany", e.target.checked)}
            />
            is_inter_company
          </label>
        </div>
      </fieldset>

      {/* === Locations (一对多) === */}
      <fieldset className="space-y-3 border-t border-slate-200 pt-4">
        <legend className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            Locations per domain (optional)
          </span>
          <button
            type="button"
            onClick={addLoc}
            className="btn btn-ghost !py-0.5 !px-1.5 !text-[10px]"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </legend>
        {locations.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-400">
            No locations. Click + Add to define one per domain.
          </div>
        ) : (
          <div className="space-y-2">
            {locations.map((loc, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  className="input !w-40 !py-1.5 !text-sm"
                  value={loc.domain}
                  onChange={(e) => setLoc(i, { domain: e.target.value })}
                >
                  {domains.map((d) => (
                    <option key={d} value={d}>{d}_loc_no</option>
                  ))}
                </select>
                <input
                  className="input flex-1 !py-1.5 !text-sm"
                  inputMode="numeric"
                  pattern="\d*"
                  value={loc.locNo}
                  onChange={(e) => setLoc(i, { locNo: e.target.value })}
                  placeholder="digits only, e.g. 1234"
                />
                <button
                  type="button"
                  onClick={() => removeLoc(i)}
                  className="btn btn-ghost p-1.5 text-slate-400 hover:text-red-600"
                  title="remove"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-slate-500">
          ⓘ 每个 domain 至多一条；空 loc_no 提交时会被忽略。模板中可用
          <code className="mx-1 rounded bg-slate-100 px-1 text-[10px]">{"${customer.sales_loc_no}"}</code>
          这种语法引用。
        </p>
      </fieldset>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-200 pt-4">
        <div className="text-xs text-slate-500">
          ⓘ 提交后会按 <code>standard_b2b</code> 模板物化 12 个任务，入度=0 的进入 READY
        </div>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Creating..." : "Create Customer →"}
        </button>
      </div>
    </form>
  );
}
