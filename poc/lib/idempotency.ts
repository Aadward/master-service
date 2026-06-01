import { NextRequest, NextResponse } from "next/server";

/**
 * In-memory idempotency cache · POC 级别
 * 真实生产应该用 Redis；此处用 Map 演示行为正确即可。
 *
 * 客户端在 POST 请求带 `Idempotency-Key: <uuid>` header；
 * 同 (method, path, key) 24h 内重发 → 直接回放原响应（status + body），
 * 并附加 X-Idempotent-Replay: true 让调用方知道这次没真正执行。
 */

interface CacheEntry {
  status: number;
  body: unknown;
  expiresAt: number;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 1000;
const store = new Map<string, CacheEntry>();

function compositeKey(req: NextRequest, key: string) {
  const url = new URL(req.url);
  return `${req.method}:${url.pathname}:${key}`;
}

function gcIfNeeded() {
  if (store.size <= MAX_ENTRIES) return;
  // 简单淘汰：按 expiresAt 升序删一半
  const entries = Array.from(store.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const half = Math.floor(entries.length / 2);
  for (let i = 0; i < half; i++) store.delete(entries[i][0]);
}

/** 如果命中缓存，返回回放响应；否则返回 null */
export function maybeReplay(req: NextRequest): NextResponse | null {
  const key = req.headers.get("Idempotency-Key");
  if (!key) return null;
  const fullKey = compositeKey(req, key);
  const entry = store.get(fullKey);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(fullKey);
    return null;
  }
  return NextResponse.json(entry.body, {
    status: entry.status,
    headers: { "X-Idempotent-Replay": "true", "X-Idempotency-Key": key },
  });
}

/** 在响应即将返回前调用，把 (status, body) 持久化到缓存里 */
export function recordResponse(req: NextRequest, status: number, body: unknown) {
  const key = req.headers.get("Idempotency-Key");
  if (!key) return;
  const fullKey = compositeKey(req, key);
  store.set(fullKey, {
    status,
    body,
    expiresAt: Date.now() + TTL_MS,
  });
  gcIfNeeded();
}
