import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Expense from "@/models/Expense";
import Driver from "@/models/Driver";
import WalletTransaction from "@/models/WalletTransaction";
import mongoose from "mongoose";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();
    
    const query: any = {};
    if (session.user.role !== "super_admin") {
      query.companyId = new mongoose.Types.ObjectId(session.user.companyId!);
    }

    const expenses = await Expense.find(query)
      .populate({
        path: "driverId",
        populate: { path: "userId", select: "name email" }
      })
      .sort({ timestamp: -1 });
      
    return NextResponse.json(expenses);
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || (session.user.role !== "admin" && session.user.role !== "super_admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { expenseId, status } = await req.json();
    if (!expenseId || !["approved", "rejected"].includes(status)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    await connectToDatabase();
    const sessionMongoose = await mongoose.startSession();
    sessionMongoose.startTransaction();

    try {
      const expense = await Expense.findById(expenseId).session(sessionMongoose);
      
      if (!expense || expense.status !== "pending") {
        throw new Error("Expense not found or already processed");
      }

      expense.status = status;
      expense.adminApprovalBy = new mongoose.Types.ObjectId(session.user.id);
      await expense.save({ session: sessionMongoose });

      if (status === "approved") {
        const driver = await Driver.findById(expense.driverId).session(sessionMongoose);
        if (!driver) throw new Error("Driver not found");

        await WalletTransaction.create([{
          driverId: driver._id,
          companyId: driver.companyId,
          amount: expense.amount,
          type: "deduction",
          relatedExpenseId: expense._id
        }], { session: sessionMongoose });

        driver.walletBalance -= expense.amount;
        await driver.save({ session: sessionMongoose });
      }

      await sessionMongoose.commitTransaction();
      sessionMongoose.endSession();
      
      return NextResponse.json({ success: true, expense });
    } catch (err: any) {
      await sessionMongoose.abortTransaction();
      sessionMongoose.endSession();
      throw err;
    }
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
