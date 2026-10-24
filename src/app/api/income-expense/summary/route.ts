import { NextResponse } from "next/server";
import { getAccountSummaries } from "@/lib/expenseLedger";
import { ensureEnrollmentDriverAccounts } from "@/lib/enrollmentDrivers";
import { withStaff } from "@/lib/incomeExpenseApi";

export const dynamic = "force-dynamic";

/** GET /api/income-expense/summary - dashboard totals and one account per driver. */
export async function GET() {
  return withStaff(async (_actor, scope) => {
    // Drivers who only exist as a Device Enrollment code get a wallet here,
    // so Allocate advance can list them and credit the phone they enrolled.
    await ensureEnrollmentDriverAccounts(scope);
    const result = await getAccountSummaries({ companyId: scope });
    return NextResponse.json(result);
  });
}
