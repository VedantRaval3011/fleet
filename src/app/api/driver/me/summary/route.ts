import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Driver from "@/models/Driver";
import Expense from "@/models/Expense";

export const dynamic = "force-dynamic";

/**
 * GET /api/driver/me/summary
 * Used by Android Custom Tab companion and driver session context.
 * Returns wallet balance + recent expenses for the authenticated driver.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "driver") {
      return NextResponse.json({ error: "Forbidden. Driver access only." }, { status: 403 });
    }

    await connectToDatabase();

    const driver = await Driver.findOne({ userId: session.user.id }).lean();
    if (!driver) {
      return NextResponse.json({ error: "Driver profile not found" }, { status: 404 });
    }

    const recentExpenses = await Expense.find({ driverId: driver._id })
      .sort({ timestamp: -1 })
      .limit(10)
      .lean();

    return NextResponse.json({
      walletBalance: driver.walletBalance,
      driverId: driver._id,
      recentExpenses: recentExpenses.map((e) => ({
        _id: e._id,
        amount: e.amount,
        category: e.category,
        status: e.status,
        timestamp: e.timestamp,
        walletBalanceAfter: e.walletBalanceAfter,
      })),
    });
  } catch (error) {
    console.error("GET /api/driver/me/summary error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
