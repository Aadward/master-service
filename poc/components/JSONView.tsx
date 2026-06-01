/**
 * 漂亮的 JSON 渲染（只读）
 */
export default function JSONView({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-slate-400">—</span>;
  }
  return (
    <pre className="overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-800">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
