import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Driver from "@/models/Driver";
import WalletTransaction from "@/models/WalletTransaction";
import mongoose from "mongoose";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || (session.user.role !== "admin" && session.user.role !== "super_admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { driverId, amount, note } = await req.json();

    if (!driverId || !amount || typeof amount !== "number" || amount <= 0) {
      return NextResponse.json({ error: "Invalid request. Provide a valid driverId and positive amount." }, { status: 400 });
    }

    await connectToDatabase();

    const mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    try {
      const driver = await Driver.findById(driverId).session(mongoSession);
      if (!driver) throw new Error("Driver not found");

      driver.walletBalance += amount;
      await driver.save({ session: mongoSession });

      await WalletTransaction.create([{
        driverId: driver._id,
        companyId: driver.companyId,
        amount,
        type: "addition",
        note: note || "Admin top-up",
      }], { session: mongoSession });

      await mongoSession.commitTransaction();
      mongoSession.endSession();

      return NextResponse.json({ success: true, newBalance: driver.walletBalance });
    } catch (err: any) {
      await mongoSession.abortTransaction();
      mongoSession.endSession();
      throw err;
    }
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
