/**
 * Expression Evaluator
 * 支持 docs/04-suggested-config.md §3 列出的 ${...} 语法：
 *   ${customer.country}                         - 字段引用
 *   ${lookup.X[customer.Y]}                     - 字典查找
 *   ${customer.X == 'Y' ? A : B}                - 三元
 *   "${customer.X}_${customer.Y}"               - 字符串拼接
 *   字面量                                       - 直接是字符串/数字
 *
 * 设计原则：纯函数。输入 (rules, customer, lookups) → 输出 object。
 * 不做任何外部调用，不依赖时间，确定性 ≡ 可缓存。
 */

import type { CustomerMinData } from "./types";

export type LookupBag = Record<string, Record<string, unknown>>;

/**
 * 评估单个表达式字符串。
 * - 若整个字符串就是一个 ${...}（且内部无嵌套 ${），返回其求值结果（可能是非字符串类型）
 * - 否则把字符串内所有 ${...} 替换为各自结果并拼接为字符串
 * - 没有 ${...} 的字面量原样返回
 */
export function evalExpression(
  expr: unknown,
  customer: CustomerMinData,
  lookups: LookupBag
): unknown {
  if (typeof expr !== "string") return expr;

  // 整串恰好是一个 ${...} 且内部无嵌套时，保留原类型（数字、null、布尔等）
  if (expr.startsWith("${") && expr.endsWith("}")) {
    const inner = expr.slice(2, -1);
    if (!inner.includes("${")) {
      return evalInner(inner.trim(), customer, lookups);
    }
  }

  // 字符串内嵌入：把每个 ${...} 替换为其文本表示
  if (expr.includes("${")) {
    return expr.replace(/\$\{([^}]+)\}/g, (_, inner) => {
      const v = evalInner(inner.trim(), customer, lookups);
      return v === null || v === undefined ? "" : String(v);
    });
  }
  return expr;
}

/**
 * 对一组 suggestions 规则求值
 */
export function evaluateSuggestions(
  rules: Record<string, unknown> | undefined,
  customer: CustomerMinData,
  lookups: LookupBag
): Record<string, unknown> {
  if (!rules) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rules)) {
    out[k] = evalExpression(v, customer, lookups);
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// 内部：表达式核心
// ────────────────────────────────────────────────────────────

/** 三元表达式形如：A == 'B' ? X : Y  /  A != 'B' ? X : Y */
function tryTernary(
  src: string,
  customer: CustomerMinData,
  lookups: LookupBag
): { matched: true; value: unknown } | { matched: false } {
  // 简单：找到 "?" 和最外层 ":"（POC 不支持嵌套三元）
  const qIdx = src.indexOf("?");
  if (qIdx < 0) return { matched: false };
  const colonIdx = src.indexOf(":", qIdx);
  if (colonIdx < 0) return { matched: false };

  const condStr = src.slice(0, qIdx).trim();
  const trueStr = src.slice(qIdx + 1, colonIdx).trim();
  const falseStr = src.slice(colonIdx + 1).trim();

  const cond = evalCondition(condStr, customer, lookups);
  const branch = cond ? trueStr : falseStr;
  return { matched: true, value: parseLiteralOrRef(branch, customer, lookups) };
}

/** 条件：A == 'B' / A != 'B' / A == B */
function evalCondition(
  src: string,
  customer: CustomerMinData,
  lookups: LookupBag
): boolean {
  for (const op of ["==", "!="]) {
    const idx = src.indexOf(op);
    if (idx >= 0) {
      const lhs = parseLiteralOrRef(src.slice(0, idx).trim(), customer, lookups);
      const rhs = parseLiteralOrRef(src.slice(idx + op.length).trim(), customer, lookups);
      return op === "==" ? lhs === rhs : lhs !== rhs;
    }
  }
  // 没有操作符，直接当布尔
  const v = parseLiteralOrRef(src, customer, lookups);
  return Boolean(v);
}

/** 解析"路径引用"或"字面量" */
function parseLiteralOrRef(
  src: string,
  customer: CustomerMinData,
  lookups: LookupBag
): unknown {
  const s = src.trim();
  // 字符串字面量
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1);
  }
  // 数字
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  // 布尔/空值
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  // 路径引用
  return evalReference(s, customer, lookups);
}

/** 处理 customer.X 与 lookup.X[customer.Y] */
function evalReference(
  ref: string,
  customer: CustomerMinData,
  lookups: LookupBag
): unknown {
  // lookup.<name>[<key-expr>]
  const lookupMatch = ref.match(/^lookup\.([a-zA-Z_][\w]*)\[(.+)\]$/);
  if (lookupMatch) {
    const tableName = lookupMatch[1];
    const keyExpr = lookupMatch[2].trim();
    const key = parseLiteralOrRef(keyExpr, customer, lookups);
    const table = lookups[tableName] ?? {};
    if (key === undefined || key === null) return undefined;
    return table[String(key)];
  }

  // customer.<path>
  if (ref.startsWith("customer.")) {
    const path = ref.slice("customer.".length).split(".");
    let cur: any = customer;
    for (const p of path) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  // 未知引用 → 原样返回（便于人眼识别）
  return ref;
}

/** 内部表达式入口（来自外层 ${...}） */
function evalInner(
  src: string,
  customer: CustomerMinData,
  lookups: LookupBag
): unknown {
  // 优先尝试三元
  if (src.includes("?") && src.includes(":")) {
    const r = tryTernary(src, customer, lookups);
    if (r.matched) return r.value;
  }
  // 否则当作字面量或引用
  return parseLiteralOrRef(src, customer, lookups);
}
