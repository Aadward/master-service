import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import CustomerForm from "@/components/CustomerForm";

export default function NewCustomerPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Create New Customer</h1>
        <p className="mt-1 text-sm text-slate-500">
          只需填写各模块共享的最小集合字段。下游域的自定义配置会在各自工作台完成。
        </p>
      </header>
      <div className="card">
        <CustomerForm />
      </div>
    </div>
  );
}
