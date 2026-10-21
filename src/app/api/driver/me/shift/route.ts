import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import { shiftErrorResponse } from "@/lib/shiftApi";
import { getDriverShiftSummary, maybeSweepOpenShifts } from "@/lib/shiftService";

export const dynamic = "force-dynamic";

/**
 * GET /api/driver/me/shift
 * The signed-in driver's current (or last) shift, status, duration and their own
 * event log. A driver can only ever read their own record.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "driver") {
      return NextResponse.json({ error: "Forbidden. Driver access only." }, { status: 403 });
    }
    await connectToDatabase();
    await maybeSweepOpenShifts();
    return NextResponse.json(await getDriverShiftSummary(session.user.id));
  } catch (e) {
    return shiftErrorResponse(e);
  }
}
