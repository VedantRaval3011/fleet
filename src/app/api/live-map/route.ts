import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Expense from "@/models/Expense";
import mongoose from "mongoose";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();
    
    // Build query
    const query: any = {
      "location.lat": { $exists: true },
      "location.lng": { $exists: true }
    };

    if (session.user.role !== "super_admin") {
      query.companyId = new mongoose.Types.ObjectId(session.user.companyId!);
    }

    // Get the most recent expenses to represent the "live" location of each driver
    const latestExpenses = await Expense.aggregate([
      { $match: query },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: "$driverId",
          latestExpense: { $first: "$$ROOT" }
        }
      },
      { $replaceRoot: { newRoot: "$latestExpense" } },
      {
        $lookup: {
          from: "drivers",
          localField: "driverId",
          foreignField: "_id",
          as: "driver"
        }
      },
      { $unwind: "$driver" },
      {
        $lookup: {
          from: "users",
          localField: "driver.userId",
          foreignField: "_id",
          as: "driverUser"
        }
      },
      { $unwind: "$driverUser" }
    ]);

    // Format the result to match what ExpenseMapCore expects
    const formattedData = latestExpenses.map(expense => ({
      _id: expense._id,
      amount: expense.amount,
      category: expense.category,
      timestamp: expense.timestamp,
      location: expense.location,
      locationAccuracy: expense.locationAccuracy,
      photoUrl: expense.photoUrl,
      walletBalanceAfter: expense.walletBalanceAfter,
      status: expense.status,
      driverId: {
        userId: {
          name: expense.driverUser.name,
          email: expense.driverUser.email
        }
      }
    }));

    return NextResponse.json(formattedData);
  } catch (error) {
    console.error("Failed to fetch live map locations:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
