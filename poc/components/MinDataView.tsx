"use client";

import { MapPin } from "lucide-react";
import { splitMinData } from "@/lib/customer-shape";

/**
 * 把 customerMinData 分两段显示：
 *  - core：身份 + 组织属性
 *  - locations：按 domain 的 loc_no
 */
export default function MinDataView({
  minData,
}: {
  minData: Record<string, unknown>;
}) {
  const { core, locations } = splitMinData(minData);

  const FIELD_ORDER = [
    "custNo",
    "custName",
    "globalCustNo",
    "globalCustName",
    "globalCustCode",
    "regionNo",
    "companyNo",
    "isMaster",
    "isInterCompany",
    "customerType",
    "customerId",
  ];
  const FIELD_LABEL: Record<string, string> = {
    custNo: "cust_no",
    custName: "cust_name",
    globalCustNo: "global_cust_no",
    globalCustName: "global_cust_name",
    globalCustCode: "global_cust_code",
    regionNo: "region_no",
    companyNo: "company_no",
    isMaster: "is_master",
    isInterCompany: "is_inter_company",
    customerType: "customer_type",
    customerId: "(internal id)",
  };

  const ordered = FIELD_ORDER.filter((k) => k in core);
  for (const k of Object.keys(core)) if (!ordered.includes(k)) ordered.push(k);

  return (
    <div className="space-y-3">
      <dl className="space-y-0.5 text-sm">
        {ordered.map((k) => {
          const v = core[k];
          return (
            <div key={k} className="flex items-baseline justify-between gap-2">
              <dt className="text-xs text-slate-500">{FIELD_LABEL[k] ?? k}</dt>
              <dd className="font-mono text-xs text-slate-800">{fmt(v)}</dd>
            </div>
          );
        })}
      </dl>

      {Object.keys(locations).length > 0 && (
        <div className="border-t border-slate-100 pt-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            <MapPin className="h-3 w-3" />
            Locations
          </div>
          <dl className="space-y-0.5 text-sm">
            {Object.entries(locations).map(([dom, locNo]) => (
              <div key={dom} className="flex items-baseline justify-between gap-2">
                <dt className="text-xs text-slate-500">{dom}_loc_no</dt>
                <dd className="font-mono text-xs text-slate-800">{locNo}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function fmt(v: unknown) {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}
