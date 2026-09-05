import { PageSkeleton } from "@/components/layout/PageSkeleton";

/**
 * Default streaming boundary for every dashboard route that does not ship its
 * own. Next includes this in the prefetch payload for sidebar links, so a
 * navigation paints instantly instead of waiting on the segment's data.
 */
export default function DashboardLoading() {
  return <PageSkeleton />;
}
