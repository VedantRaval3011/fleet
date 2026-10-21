import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Expense from "@/models/Expense";
import mongoose from "mongoose";
import { reviewExpense } from "@/lib/expenseLedger";
import { readJson, withStaff } from "@/lib/incomeExpenseApi";

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

/**
 * PUT /api/expenses  { expenseId, status: "approved" | "rejected", reason?, confirmExcess? }
 *
 * Legacy entry point used by the Expenses page. It now delegates to the same
 * ledger service as POST /api/income-expense/expenses/:id/review, which:
 *  - moves the balance exactly once per expense: expenses deducted on submit are
 *    refunded on rejection and unchanged by approval; legacy ones are deducted
 *    on approval,
 *  - requires a reason to reject,
 *  - requires confirmExcess to approve a legacy expense beyond the available balance,
 *  - enforces the caller's company.
 */
export async function PUT(req: Request) {
  return withStaff(async (actor) => {
    const body = await readJson(req);
    const decision = body.status === "approved" ? "approve" : body.status === "rejected" ? "reject" : undefined;
    const result = await reviewExpense({
      expenseId: body.expenseId,
      decision,
      reason: body.reason,
      confirmExcess: body.confirmExcess,
      actor,
    });
    return NextResponse.json({ success: true, ...result });
  });
}
