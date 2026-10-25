import { AlertTriangle, Info } from "lucide-react";
import type { DataNotice } from "@shared/finance";

// Warnings first, so missing or excluded data is the first thing people read.
export default function FinanceNotices({ notices, hide = [] }: { notices: DataNotice[]; hide?: string[] }) {
  const visible = notices
    .filter((n) => !hide.includes(n.code))
    .sort((a, b) => (a.level === b.level ? 0 : a.level === "warning" ? -1 : 1));
  if (visible.length === 0) return null;
  return (
    <ul className="space-y-2" data-testid="finance-notices">
      {visible.map((notice) => (
        <li
          key={notice.code + notice.message}
          className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
            notice.level === "warning" ? "bg-amber-50 text-amber-900 border border-amber-200" : "bg-slate-100 text-slate-700"
          }`}
        >
          {notice.level === "warning"
            ? <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            : <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />}
          <span>{notice.message}</span>
        </li>
      ))}
    </ul>
  );
}
