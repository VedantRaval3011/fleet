/** Shared plumbing for the shift API routes. */
import crypto from "crypto";
import { NextResponse } from "next/server";
import { LedgerError, companyScopeFor, type Actor } from "@/lib/expenseLedger";
import { getSessionActor } from "@/lib/incomeExpenseApi";
import connectToDatabase from "@/lib/db";
import { ShiftError } from "@/lib/shiftService";

/** HR and administrators. Drivers see only their own shifts, through /api/driver/me/shift. */
export const SHIFT_VIEW_ROLES = ["super_admin", "admin", "hr"] as const;

export function canViewShifts(role?: string | null): boolean {
  return !!role && (SHIFT_VIEW_ROLES as readonly string[]).includes(role);
}

export function shiftErrorResponse(e: unknown): NextResponse {
  if (e instanceof ShiftError || e instanceof LedgerError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }
  // Never leak internals to a device or browser; the detail goes to the server log.
  console.error("[shifts]", e);
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}

/** Run a handler for HR/admin users only, scoped to their company. */
export async function withShiftStaff(
  handler: (actor: Actor, scope: string | null) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const actor = await getSessionActor();
    if (!canViewShifts(actor.role)) {
      throw new ShiftError(403, "FORBIDDEN", "You do not have permission to view driver shifts.");
    }
    const scope = companyScopeFor(actor);
    await connectToDatabase();
    return await handler(actor, scope);
  } catch (e) {
    return shiftErrorResponse(e);
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Device authentication for the shift endpoints: the shared X-API-Key the phones are
 * enrolled with. Unlike the older /api/status route this FAILS CLOSED - with no key
 * configured on the server nobody is let in, because these endpoints write the
 * driver's audit trail.
 */
export function assertDeviceKey(req: Request): void {
  const accepted = [process.env.API_KEY, process.env.BACKEND_API_KEY].filter(
    (k): k is string => typeof k === "string" && k.length > 0
  );
  if (accepted.length === 0) {
    throw new ShiftError(503, "DEVICE_AUTH_NOT_CONFIGURED", "The server has no device API key configured (API_KEY).");
  }
  const provided = req.headers.get("x-api-key") ?? "";
  if (!accepted.some((k) => safeEqual(provided, k))) {
    throw new ShiftError(401, "UNAUTHORIZED", "Invalid API key.");
  }
}
