"use client";

import { useEffect, useState } from "react";

/** 把任意值的更新延迟 `delayMs`，避免高频触发下游 effect */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return v;
}
