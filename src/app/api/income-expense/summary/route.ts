import { NextResponse } from "next/server";
import { getAccountSummaries } from "@/lib/expenseLedger";
import { withStaff } from "@/lib/incomeExpenseApi";

export const dynamic = "force-dynamic";

/** GET /api/income-expense/summary - dashboard totals and one account per driver. */
export async function GET() {
  return withStaff(async (_actor, scope) => {
    const result = await getAccountSummaries({ companyId: scope });
    return NextResponse.json(result);
  });
}
