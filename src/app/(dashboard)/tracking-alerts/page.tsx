import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canViewShifts } from "@/lib/shiftApi";
import TrackingAlertsClient from "./TrackingAlertsClient";

export const dynamic = "force-dynamic";

export default async function TrackingAlertsPage() {
  const session = await getServerSession(authOptions);

  // The API enforces this too; checking here just avoids showing a broken page.
  if (!canViewShifts(session?.user?.role)) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        You do not have permission to view tracking alerts.
      </div>
    );
  }

  return <TrackingAlertsClient />;
}
