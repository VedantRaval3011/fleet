import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDeviceKey, shiftErrorResponse } from "@/lib/shiftApi";
import { publicShiftConfig } from "@/lib/shiftConfig";

export const dynamic = "force-dynamic";

/** GET /api/shifts/config - the two shifts and the rules around them. Device key or a signed-in user. */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) assertDeviceKey(req);
    return NextResponse.json({ ...publicShiftConfig(), serverTime: Date.now() });
  } catch (e) {
    return shiftErrorResponse(e);
  }
}
