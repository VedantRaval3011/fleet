import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { issuePortalTicket, walletFromRequest } from "@/lib/deviceSession";

export const dynamic = "force-dynamic";

/**
 * POST /api/driver/portal-ticket
 * Authorization: Bearer <deviceToken>
 *
 * Returns a one-time ticket. The phone opens /api/driver/portal?ticket=... in
 * the browser so the expense page is signed in as this driver.
 */
export async function POST(req: Request) {
  try {
    await connectToDatabase();
    const wallet = await walletFromRequest(req);
    if (!wallet) {
      return NextResponse.json({ error: "Unknown device" }, { status: 401 });
    }
    const ticket = await issuePortalTicket(wallet.userId);
    return NextResponse.json({ ticket });
  } catch (error) {
    console.error("POST /api/driver/portal-ticket error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
