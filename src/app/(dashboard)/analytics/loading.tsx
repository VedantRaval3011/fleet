import { CardGridSkeleton, ChartSkeleton } from "@/components/layout/PageSkeleton";

export default function AnalyticsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-8 w-40 animate-pulse rounded bg-slate-800/70" />
        <div className="h-4 w-72 animate-pulse rounded bg-slate-800/70" />
      </div>
      <CardGridSkeleton count={4} />
      <div className="grid gap-6 md:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
    </div>
  );
}
