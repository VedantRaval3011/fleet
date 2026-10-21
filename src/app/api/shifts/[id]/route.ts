import { NextResponse } from "next/server";
import { withShiftStaff } from "@/lib/shiftApi";
import { getShiftDetail } from "@/lib/shiftService";

export const dynamic = "force-dynamic";

/**
 * GET /api/shifts/:id   (HR / admin)
 * The shift, its tracking interruptions and the complete timestamped event log.
 * Opening it is recorded in the log (who, when) - see getShiftDetail.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withShiftStaff(async (actor, scope) => {
    const { id } = await params;
    const detail = await getShiftDetail(id, scope, { id: actor.id, name: actor.name, role: actor.role });
    return NextResponse.json(detail);
  });
}
