import Link from "next/link";

/**
 * 顶部导航：所有页面共用
 */
export default function NavBar() {
  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
        <Link href="/" className="text-base font-bold text-slate-900">
          Master-Service <span className="text-blue-600">POC</span>
        </Link>
        <div className="flex items-center gap-1 text-sm">
          <Link href="/" className="px-2 py-1 text-slate-600 hover:text-slate-900">
            Dashboard
          </Link>
          <Link
            href="/inbox?domain=sales"
            className="px-2 py-1 text-slate-600 hover:text-slate-900"
          >
            Inbox
          </Link>
          <Link
            href="/templates"
            className="px-2 py-1 text-slate-600 hover:text-slate-900"
          >
            Templates
          </Link>
          <Link
            href="/audit"
            className="px-2 py-1 text-slate-600 hover:text-slate-900"
          >
            Audit Log
          </Link>
        </div>
        <div className="ml-auto text-xs text-slate-400">
          A "living design document" for the master-service
        </div>
      </div>
    </nav>
  );
}
