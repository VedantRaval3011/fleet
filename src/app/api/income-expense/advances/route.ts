import { NextResponse } from "next/server";
import { allocateAdvance } from "@/lib/expenseLedger";
import { readJson, withStaff } from "@/lib/incomeExpenseApi";

export const dynamic = "force-dynamic";

/**
 * POST /api/income-expense/advances
 *   { driverId, amount, note?, idempotencyKey? }
 *
 * Allocates an advance to a driver. Each call is its own ledger entry, so a
 * second allocation never overwrites or merges with an earlier one. Send the
 * same idempotencyKey on a retry to make it safe.
 */
export async function POST(req: Request) {
  return withStaff(async (actor) => {
    const body = await readJson(req);
    const result = await allocateAdvance({
      driverId: body.driverId,
      amount: body.amount,
      note: body.note,
      idempotencyKey: body.idempotencyKey,
      actor,
    });
    return NextResponse.json({ success: true, ...result }, { status: result.duplicate ? 200 : 201 });
  });
}
