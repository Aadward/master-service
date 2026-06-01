/**
 * Next.js instrumentation hook
 * 服务器进程启动时执行一次（每个 worker 进程一次）
 * 用来启动后台任务，比如 claim 超时回收 reaper
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureReaperStarted } = await import("./lib/claim-reaper");
    ensureReaperStarted(60_000);
  }
}
