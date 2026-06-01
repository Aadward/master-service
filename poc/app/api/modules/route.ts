import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/modules
 * 从当前所有 active 模板中提取出"模块名集合"，按字母序返回
 * 客户端用此结果生成 Inbox 顶部的 domain tabs
 */
export async function GET() {
  const rows = await db.configTemplate.findMany({ where: { isActive: true } });
  const set = new Set<string>();
  for (const r of rows) {
    try {
      const def = JSON.parse(r.definition) as { modules?: Record<string, unknown> };
      for (const m of Object.keys(def.modules ?? {})) set.add(m);
    } catch {
      // ignore malformed
    }
  }
  const items = Array.from(set).sort();
  return NextResponse.json({ items });
}
