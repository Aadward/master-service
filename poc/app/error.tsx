"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // POC: 把错误抛到控制台便于排查
    // 真实环境可以接入 Sentry / Pino
    console.error("[error.tsx]", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <AlertTriangle className="mx-auto h-10 w-10 text-red-500" />
      <h1 className="mt-4 text-xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600">
        {error.message || "An unexpected error occurred."}
      </p>
      {error.digest && (
        <p className="mt-1 font-mono text-xs text-slate-400">digest: {error.digest}</p>
      )}
      <div className="mt-6 flex justify-center gap-2">
        <button className="btn btn-primary" onClick={reset}>
          Try again
        </button>
        <Link href="/" className="btn">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
