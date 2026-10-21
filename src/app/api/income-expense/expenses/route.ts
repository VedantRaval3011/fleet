import { NextResponse } from "next/server";
import { listExpenses } from "@/lib/expenseLedger";
import {
  intParam,
  optionalExpenseStatus,
  optionalObjectId,
  withStaff,
} from "@/lib/incomeExpenseApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/income-expense/expenses?status=pending|approved|rejected|all&driverId=&page=&limit=
 * Receipt images are NOT inlined; each item carries a `receiptUrl` to fetch on demand.
 */
export async function GET(req: Request) {
  return withStaff(async (_actor, scope) => {
    const sp = new URL(req.url).searchParams;
    const result = await listExpenses({
      companyId: scope,
      driverId: optionalObjectId(sp.get("driverId"), "driver"),
      status: optionalExpenseStatus(sp.get("status")),
      page: intParam(sp.get("page"), 1),
      limit: intParam(sp.get("limit"), 25),
    });
    return NextResponse.json(result);
  });
}
