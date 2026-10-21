import { NextResponse } from "next/server";
import { withShiftStaff } from "@/lib/shiftApi";
import { listShifts, ShiftError } from "@/lib/shiftService";
import { isShiftType } from "@/lib/shiftConfig";

export const dynamic = "force-dynamic";

function dateParam(value: string | null, what: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ShiftError(400, "INVALID_DATE", `Invalid ${what}.`);
  return d;
}

/**
 * GET /api/shifts   (HR / admin)
 *   view=live|history   live = drivers on shift or interrupted right now
 *   status=ACTIVE|INTERRUPTED|ENDED, shiftType=MORNING|EVENING, search=<name>,
 *   from=<iso>, to=<iso>, interrupted=1, page, limit
 */
export async function GET(req: Request) {
  return withShiftStaff(async (_actor, scope) => {
    const sp = new URL(req.url).searchParams;
    const status = sp.get("status");
    if (status && !["ACTIVE", "INTERRUPTED", "ENDED"].includes(status)) {
      throw new ShiftError(400, "INVALID_STATUS", "Unknown shift status.");
    }
    const shiftType = sp.get("shiftType");
    if (shiftType && !isShiftType(shiftType)) throw new ShiftError(400, "INVALID_SHIFT_TYPE", "Unknown shift type.");

    const result = await listShifts(scope, {
      view: sp.get("view") === "history" ? "history" : "live",
      status: (status as "ACTIVE" | "INTERRUPTED" | "ENDED" | null) ?? undefined,
      shiftType: shiftType && isShiftType(shiftType) ? shiftType : undefined,
      search: sp.get("search")?.slice(0, 80) || undefined,
      from: dateParam(sp.get("from"), "from date"),
      to: dateParam(sp.get("to"), "to date"),
      withInterruptions: sp.get("interrupted") === "1",
      page: Number(sp.get("page")) || 1,
      limit: Number(sp.get("limit")) || 25,
    });
    return NextResponse.json(result);
  });
}
