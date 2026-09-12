import { cn } from "@/lib/utils";

/**
 * Shared streaming placeholders for dashboard `loading.tsx` boundaries.
 * Server components only — no state, so Next can inline them in the
 * prefetch payload for sidebar links.
 */

function Shimmer({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-slate-800/70", className)} />;
}

export function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3"
        >
          <Shimmer className="h-4 w-24" />
          <Shimmer className="h-7 w-20" />
          <Shimmer className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-4",
        className
      )}
    >
      <Shimmer className="h-4 w-32" />
      <div className="flex h-48 items-end gap-2">
        {[45, 70, 35, 85, 55, 65, 40, 75].map((height, i) => (
          <div
            key={i}
            className="flex-1 animate-pulse rounded-t bg-slate-800/70"
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
      <div className="border-b border-slate-800 p-4">
        <Shimmer className="h-4 w-40" />
      </div>
      <div className="divide-y divide-slate-800/50">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Shimmer className="h-9 w-9 shrink-0 rounded-full" />
            <Shimmer className="h-4 flex-1" />
            <Shimmer className="hidden h-4 w-24 sm:block" />
            <Shimmer className="hidden h-4 w-16 md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Shimmer className="h-8 w-48" />
        <Shimmer className="h-4 w-72" />
      </div>
      <CardGridSkeleton />
      <TableSkeleton />
    </div>
  );
}
