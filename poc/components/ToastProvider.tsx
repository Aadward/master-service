"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

export type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  title?: string;
  message: string;
  expiresAt: number;
}

interface ToastCtx {
  push: (t: Omit<Toast, "id" | "expiresAt"> & { ttlMs?: number }) => void;
  dismiss: (id: number) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const idRef = useRef(1);

  const push = useCallback<ToastCtx["push"]>((t) => {
    const id = idRef.current++;
    const ttl = t.ttlMs ?? (t.kind === "error" ? 6000 : 3000);
    const toast: Toast = {
      id,
      kind: t.kind,
      title: t.title,
      message: t.message,
      expiresAt: Date.now() + ttl,
    };
    setItems((p) => [...p, toast]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((p) => p.filter((t) => t.id !== id));
  }, []);

  // 自动过期：每 200ms 扫一次，把过期的清掉
  useEffect(() => {
    if (!items.length) return;
    const id = setInterval(() => {
      const now = Date.now();
      setItems((p) => p.filter((t) => t.expiresAt > now));
    }, 200);
    return () => clearInterval(id);
  }, [items.length]);

  return (
    <Ctx.Provider value={{ push, dismiss }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {items.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const icon =
    toast.kind === "success" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> :
    toast.kind === "error"   ? <AlertCircle  className="h-4 w-4 text-red-600" /> :
                               <Info         className="h-4 w-4 text-blue-600" />;
  const border =
    toast.kind === "success" ? "border-emerald-200 bg-emerald-50" :
    toast.kind === "error"   ? "border-red-200 bg-red-50" :
                               "border-blue-200 bg-blue-50";
  return (
    <div
      className={`pointer-events-auto flex w-80 items-start gap-2 rounded-md border px-3 py-2 shadow-sm ${border}`}
      role="status"
    >
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1 text-sm">
        {toast.title && <div className="font-semibold">{toast.title}</div>}
        <div className="text-slate-700">{toast.message}</div>
      </div>
      <button className="text-slate-400 hover:text-slate-700" onClick={onDismiss} aria-label="dismiss">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
