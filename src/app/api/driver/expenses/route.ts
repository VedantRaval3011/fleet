import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Expense from "@/models/Expense";
import Driver from "@/models/Driver";
import WalletTransaction from "@/models/WalletTransaction";
import mongoose from "mongoose";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "driver") {
      return NextResponse.json({ error: "Unauthorized. Strict Driver Access." }, { status: 401 });
    }

    const body = await req.json();
    const { amount, category, note, photoBase64, latitude, longitude, accuracy } = body;

    if (!amount || !category || !photoBase64 || !latitude || !longitude) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await connectToDatabase();

    // Find the Driver profile linked to this User
    const driver = await Driver.findOne({ userId: session.user.id });
    if (!driver) {
      return NextResponse.json({ error: "Driver profile not found" }, { status: 404 });
    }

    // Wrap in a Mongoose Session Transaction for atomicity 
    // The driver uploads the expense, and the amount is IMMEDIATELY deducted from their wallet.
    // If Admin REJECTS the expense later, that money is refunded in the `PUT` approve/reject API.
    const dbSession = await mongoose.startSession();
    dbSession.startTransaction();

    let savedExpense;

    try {
      // 1. Calculate new balance
      const newBalance = driver.walletBalance - amount;

      // 2. Create Expense Record
      const newExpense = new Expense({
        driverId: driver._id,
        companyId: driver.companyId,
        amount,
        category,
        note,
        photoUrl: photoBase64, // Storing base64 directly for MVP
        location: {
          lat: latitude,
          lng: longitude,
        },
        locationAccuracy: accuracy,
        timestamp: new Date(),
        status: 'pending',
        walletBalanceAfter: newBalance // Record the snapshot of their wallet after THIS expense
      });

      savedExpense = await newExpense.save({ session: dbSession });

      // 3. Create Wallet Transaction Log
      const transaction = new WalletTransaction({
        driverId: driver._id,
        companyId: driver.companyId,
        amount: amount,
        type: 'deduction', // They spent money from their wallet
        relatedExpenseId: savedExpense._id,
        timestamp: new Date()
      });
      await transaction.save({ session: dbSession });

      // 4. Actually deduct from the Driver's real balance
      driver.walletBalance = newBalance;
      await driver.save({ session: dbSession });

      await dbSession.commitTransaction();
    } catch (txError) {
      await dbSession.abortTransaction();
      throw txError;
    } finally {
      dbSession.endSession();
    }

    return NextResponse.json(savedExpense, { status: 201 });
  } catch (error) {
    console.error("Failed to submit expense:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
