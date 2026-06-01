import type { CustomerMinData } from "./types";

/**
 * 把 Prisma 取出来的 customer + locations 拼成 API/模板用的扁平 minData
 *
 *  locations 数组 → 扁平为 ${domain}_loc_no 字段
 *    [{domain:'mfg', locNo:'L-1'}, {domain:'sales', locNo:'L-2'}]
 *    → { mfg_loc_no:'L-1', sales_loc_no:'L-2' }
 *
 * 这样模板里就能直接写 ${customer.sales_loc_no}，不需要嵌套对象访问语法
 */
export function buildCustomerMinData(
  customer: {
    customerId: string;
    custNo: string;
    custName: string;
    globalCustNo: string | null;
    globalCustName: string | null;
    globalCustCode: string | null;
    regionNo: string | null;
    companyNo: string | null;
    isMaster: boolean;
    isInterCompany: boolean;
    customerType: string;
  },
  locations: Array<{ domain: string; locNo: string }> = []
): CustomerMinData {
  const base: CustomerMinData = {
    customerId: customer.customerId,
    custNo: customer.custNo,
    custName: customer.custName,
    globalCustNo: customer.globalCustNo,
    globalCustName: customer.globalCustName,
    globalCustCode: customer.globalCustCode,
    regionNo: customer.regionNo,
    companyNo: customer.companyNo,
    isMaster: customer.isMaster,
    isInterCompany: customer.isInterCompany,
    customerType: customer.customerType,
  };
  for (const loc of locations) {
    base[`${loc.domain}_loc_no`] = loc.locNo;
  }
  return base;
}

/**
 * 把扁平 minData 中的 location 字段抽出来（前端展示用）
 * 返回 { core: {...非 location 字段}, locations: {mfg:'L-1', sales:'L-2'} }
 */
export function splitMinData(minData: Record<string, unknown>): {
  core: Record<string, unknown>;
  locations: Record<string, string>;
} {
  const core: Record<string, unknown> = {};
  const locations: Record<string, string> = {};
  for (const [k, v] of Object.entries(minData)) {
    const m = k.match(/^(.+)_loc_no$/);
    if (m && typeof v === "string" && v.length > 0) {
      locations[m[1]] = v;
    } else if (!m) {
      core[k] = v;
    }
  }
  return { core, locations };
}
