import { NextResponse } from "next/server";
import { withShiftStaff } from "@/lib/shiftApi";
import { ShiftError } from "@/lib/shiftService";
import { listTrackingAlerts } from "@/lib/trackingAlertService";

export const dynamic = "force-dynamic";

/**
 * GET /api/tracking-alerts   (HR / admin, own company only)
 *   since=<iso>   only alerts the server received after this instant (for polling)
 *   limit=1..200  default 50
 *   info=0        leave out informational alerts (network lost)
 *
 * Location-tracking problems and recoveries during shifts, plus everyone on shift
 * now with their tracking status. Polled by the dashboard bell.
 */
export async function GET(req: Request) {
  return withShiftStaff(async (_actor, scope) => {
    const sp = new URL(req.url).searchParams;
    let since: Date | undefined;
    const rawSince = sp.get("since");
    if (rawSince) {
      since = new Date(rawSince);
      if (Number.isNaN(since.getTime())) throw new ShiftError(400, "INVALID_DATE", "Invalid 'since'.");
    }
    const result = await listTrackingAlerts(scope, {
      since,
      limit: Number(sp.get("limit")) || 50,
      includeInfo: sp.get("info") !== "0",
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  });
}
