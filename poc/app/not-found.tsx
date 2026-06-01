import Link from "next/link";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <SearchX className="mx-auto h-10 w-10 text-slate-400" />
      <h1 className="mt-4 text-xl font-bold">Page not found</h1>
      <p className="mt-2 text-sm text-slate-600">
        你访问的页面不存在，或这个客户/任务已被删除。
      </p>
      <div className="mt-6">
        <Link href="/" className="btn btn-primary">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
