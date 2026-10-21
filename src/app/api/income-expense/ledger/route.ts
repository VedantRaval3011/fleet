import { NextResponse } from "next/server";
import { listLedger } from "@/lib/expenseLedger";
import {
  intParam,
  optionalDate,
  optionalLedgerType,
  optionalObjectId,
  withStaff,
} from "@/lib/incomeExpenseApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/income-expense/ledger
 *   ?driverId=&type=&from=<ISO>&to=<ISO>&page=1&limit=25
 * Newest first. Every advance, submission, approval and rejection.
 */
export async function GET(req: Request) {
  return withStaff(async (_actor, scope) => {
    const sp = new URL(req.url).searchParams;
    const result = await listLedger({
      companyId: scope,
      driverId: optionalObjectId(sp.get("driverId"), "driver"),
      type: optionalLedgerType(sp.get("type")),
      from: optionalDate(sp.get("from"), "from date"),
      to: optionalDate(sp.get("to"), "to date"),
      page: intParam(sp.get("page"), 1),
      limit: intParam(sp.get("limit"), 25),
    });
    return NextResponse.json(result);
  });
}
