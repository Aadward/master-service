import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import yaml from "js-yaml";

/**
 * GET /api/templates                  列出活跃模板
 * GET /api/templates?templateId=...    取指定 customerType 的活跃模板
 * POST /api/templates                  upsert 一个模板版本
 *   body: { yaml: "<yaml string>" }  或  { definition: { customer_type, version, modules, ... } }
 *   行为：解析 → 结构校验 → upsert (templateId, version) → 把同 templateId 其他版本 deactivate → 当前激活
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
      isActive: row.isActive,
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
      isActive: r.isActive,
      definition: JSON.parse(r.definition),
    })),
  });
}

interface TaskDef {
  task_key?: unknown;
  depends_on?: unknown;
  suggestions?: unknown;
}
interface ModuleDef {
  tasks?: unknown;
}

function validateDefinition(def: unknown): string | null {
  if (!def || typeof def !== "object") return "definition must be an object";
  const d = def as Record<string, unknown>;
  if (typeof d.customer_type !== "string" || !d.customer_type) {
    return "customer_type required (string)";
  }
  if (typeof d.version !== "number" || !Number.isInteger(d.version) || d.version <= 0) {
    return "version required (positive integer)";
  }
  if (!d.modules || typeof d.modules !== "object") {
    return "modules required (object)";
  }
  const modules = d.modules as Record<string, ModuleDef>;
  const seenKeys = new Set<string>();
  for (const [m, mod] of Object.entries(modules)) {
    if (!mod || typeof mod !== "object") return `modules.${m} must be an object`;
    if (!Array.isArray(mod.tasks)) return `modules.${m}.tasks must be an array`;
    for (const t of mod.tasks as TaskDef[]) {
      if (!t || typeof t !== "object") return `task in modules.${m} not an object`;
      if (typeof t.task_key !== "string" || !t.task_key) {
        return `task in modules.${m} missing task_key`;
      }
      if (seenKeys.has(t.task_key)) {
        return `duplicate task_key: ${t.task_key}`;
      }
      seenKeys.add(t.task_key);
      if (t.depends_on !== undefined && !Array.isArray(t.depends_on)) {
        return `task ${t.task_key}: depends_on must be array`;
      }
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "INVALID_JSON" }, { status: 400 });
  }

  // 接受 yaml 或已解析的 definition
  let def: unknown;
  if (typeof body?.yaml === "string") {
    try {
      def = yaml.load(body.yaml);
    } catch (e: any) {
      return NextResponse.json(
        { code: "INVALID_YAML", message: e?.message ?? String(e) },
        { status: 400 }
      );
    }
  } else if (body?.definition) {
    def = body.definition;
  } else {
    return NextResponse.json(
      { code: "INVALID_INPUT", message: "body must contain `yaml` (string) or `definition` (object)" },
      { status: 400 }
    );
  }

  const err = validateDefinition(def);
  if (err) {
    return NextResponse.json({ code: "INVALID_TEMPLATE", message: err }, { status: 400 });
  }
  const validated = def as { customer_type: string; version: number; modules: Record<string, unknown> };

  const templateId = validated.customer_type; // 当前约定：templateId = customer_type
  const version = validated.version;

  await db.$transaction(async (tx) => {
    // 同 templateId 的其他版本 → deactivate
    await tx.configTemplate.updateMany({
      where: { templateId, version: { not: version } },
      data: { isActive: false },
    });
    await tx.configTemplate.upsert({
      where: { templateId_version: { templateId, version } },
      update: {
        definition: JSON.stringify(validated),
        isActive: true,
        customerType: validated.customer_type,
      },
      create: {
        templateId,
        version,
        customerType: validated.customer_type,
        definition: JSON.stringify(validated),
        isActive: true,
      },
    });
  });

  return NextResponse.json({
    templateId,
    version,
    customerType: validated.customer_type,
    isActive: true,
    tasksCount: Object.values(validated.modules).reduce(
      (acc, m: any) => acc + (Array.isArray(m?.tasks) ? m.tasks.length : 0),
      0
    ),
  });
}
