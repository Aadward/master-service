import { db } from "./db";
import type { LookupBag } from "./expression-evaluator";

/**
 * 加载所有字典到一个对象里，供 expression-evaluator 引用
 */
export async function loadAllLookups(): Promise<LookupBag> {
  const rows = await db.lookupTable.findMany();
  const bag: LookupBag = {};
  for (const r of rows) {
    try {
      bag[r.name] = JSON.parse(r.entries);
    } catch {
      bag[r.name] = {};
    }
  }
  return bag;
}
