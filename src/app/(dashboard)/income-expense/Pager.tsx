"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Pager({
  page,
  limit,
  total,
  onPage,
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3 text-xs text-slate-400">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 border-slate-700 bg-transparent text-slate-300"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span>
          Page {page} / {pages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-8 border-slate-700 bg-transparent text-slate-300"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
