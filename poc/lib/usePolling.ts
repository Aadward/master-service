"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 客户端轮询 hook
 * - 立即拉一次，之后每 intervalMs 拉一次
 * - 卸载时停止
 * - 暴露 refresh() 强制刷新
 * - 优化：若新数据 JSON-equal 旧数据，则跳过 setData，避免下游无谓 re-render
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs = 1500
): { data: T | null; loading: boolean; error: unknown; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // 用 ref 保留最新 fetcher 避免 effect 重启
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // 用 ref 保留上次的"内容签名"做浅比较
  const lastSerRef = useRef<string | null>(null);

  const run = useRef(async () => {
    try {
      const v = await fetcherRef.current();
      const next = JSON.stringify(v);
      if (next !== lastSerRef.current) {
        lastSerRef.current = next;
        setData(v);
      }
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    run.current();
    const id = setInterval(() => run.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return { data, loading, error, refresh: () => run.current() };
}
