import { NextResponse } from "next/server";
import { reviewExpense } from "@/lib/expenseLedger";
import { readJson, withStaff } from "@/lib/incomeExpenseApi";

export const dynamic = "force-dynamic";

/**
 * POST /api/income-expense/expenses/:id/review
 *   { decision: "approve" | "reject", reason?, confirmExcess? }
 *
 * - reject requires `reason`.
 * - approve of an expense larger than the driver's available balance answers
 *   409 EXCESS_CONFIRMATION_REQUIRED (with the amounts in `details`) until the
 *   caller re-sends with confirmExcess: true.
 * - an expense that is no longer pending answers 409 ALREADY_REVIEWED.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withStaff(async (actor) => {
    const { id } = await params;
    const body = await readJson(req);
    const result = await reviewExpense({
      expenseId: id,
      decision: body.decision,
      reason: body.reason,
      confirmExcess: body.confirmExcess,
      actor,
    });
    return NextResponse.json({ success: true, ...result });
  });
}
