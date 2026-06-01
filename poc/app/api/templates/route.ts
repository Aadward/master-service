import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/templates                 列出活跃模板
 * GET /api/templates?templateId=...   取指定模板
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tid = url.searchParams.get("templateId");
  if (tid) {
    const row = await db.configTemplate.findFirst({
      where: { templateId: tid, isActive: true },
      orderBy: { version: "desc" },
    });
    if (!row) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json({
      templateId: row.templateId,
      version: row.version,
      customerType: row.customerType,
      definition: JSON.parse(row.definition),
    });
  }
  const rows = await db.configTemplate.findMany({
    where: { isActive: true },
    orderBy: { customerType: "asc" },
  });
  return NextResponse.json({
    items: rows.map((r) => ({
      templateId: r.templateId,
      version: r.version,
      customerType: r.customerType,
      definition: JSON.parse(r.definition),
    })),
  });
}
