import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding master-service POC database...");

  // ── 1. 注入字典 ─────────────────────────────────────────
  const lookupDir = path.join(process.cwd(), "lookups");
  const lookupFiles = fs.readdirSync(lookupDir).filter((f) => f.endsWith(".json"));
  for (const file of lookupFiles) {
    const name = path.basename(file, ".json");
    const entries = fs.readFileSync(path.join(lookupDir, file), "utf-8");
    await prisma.lookupTable.upsert({
      where: { name },
      update: { entries, version: { increment: 1 } },
      create: {
        name,
        version: 1,
        entries,
        description: `Auto-seeded from ${file}`,
      },
    });
    console.log(`  ✓ lookup: ${name}`);
  }

  // ── 2. 注入模板 ─────────────────────────────────────────
  const tmplDir = path.join(process.cwd(), "templates");
  const tmplFiles = fs.readdirSync(tmplDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const file of tmplFiles) {
    const raw = fs.readFileSync(path.join(tmplDir, file), "utf-8");
    const parsed = yaml.load(raw) as {
      customer_type: string;
      version: number;
      [k: string]: unknown;
    };
    const templateId = parsed.customer_type;
    const version = parsed.version ?? 1;

    // 先把同 templateId 的其他版本 deactivate
    await prisma.configTemplate.updateMany({
      where: { templateId },
      data: { isActive: false },
    });

    await prisma.configTemplate.upsert({
      where: { templateId_version: { templateId, version } },
      update: {
        definition: JSON.stringify(parsed),
        isActive: true,
        customerType: parsed.customer_type,
      },
      create: {
        templateId,
        version,
        customerType: parsed.customer_type,
        definition: JSON.stringify(parsed),
        isActive: true,
      },
    });
    console.log(`  ✓ template: ${templateId} v${version}`);
  }

  console.log("✅ Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
