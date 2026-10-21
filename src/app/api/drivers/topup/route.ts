import { NextResponse } from "next/server";
import { allocateAdvance } from "@/lib/expenseLedger";
import { readJson, withStaff } from "@/lib/incomeExpenseApi";

export const dynamic = "force-dynamic";

/**
 * POST /api/drivers/topup  { driverId, amount, note?, idempotencyKey? }
 *
 * Kept for the Drivers and Users pages. A top-up IS an advance allocation, so
 * it goes through the same ledger-writing service as
 * POST /api/income-expense/advances (previously it edited the balance directly,
 * leaving no audit trail of who added the money).
 */
export async function POST(req: Request) {
  return withStaff(async (actor) => {
    const body = await readJson(req);
    const result = await allocateAdvance({
      driverId: body.driverId,
      amount: body.amount,
      note: body.note || "Admin top-up",
      idempotencyKey: body.idempotencyKey,
      actor,
    });
    return NextResponse.json({ success: true, newBalance: result.balance, entry: result.entry });
  });
}
