import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { walletFromRequest } from "@/lib/deviceSession";

export const dynamic = "force-dynamic";

/**
 * GET /api/driver/device-wallet
 * Authorization: Bearer <deviceToken>
 *
 * Balance the Android home screen shows. This is the ledger balance for the
 * Driver linked to the handset, which is the same figure Allocate advance writes.
 */
export async function GET(req: Request) {
  try {
    await connectToDatabase();
    const wallet = await walletFromRequest(req);
    if (!wallet) {
      return NextResponse.json({ error: "Unknown device" }, { status: 401 });
    }
    return NextResponse.json({
      walletBalance: wallet.balance,
      name: wallet.name,
      driverId: wallet.driverId,
    });
  } catch (error) {
    console.error("GET /api/driver/device-wallet error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
