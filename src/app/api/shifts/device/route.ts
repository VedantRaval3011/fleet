import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { assertDeviceKey, shiftErrorResponse } from "@/lib/shiftApi";
import { ShiftError, ingestDeviceBatch } from "@/lib/shiftService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/shifts/device   (X-API-Key)
 *
 * The phone's channel for the shift audit trail:
 *   {
 *     deviceId,
 *     events:    [{ id, shiftId, type, occurredAt, payload }],   // oldest first, resendable
 *     heartbeat: { shiftId, location: { lat, lng, accuracy, recordedAt } }
 *   }
 * Events are idempotent on `id`, so a phone that is unsure whether an upload landed
 * simply sends it again. The response says which shifts the server now considers
 * ended, so a phone whose shift the server closed (schedule end, unresolved tracking
 * failure) can stop tracking and tell the driver.
 */
export async function POST(req: Request) {
  try {
    assertDeviceKey(req);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new ShiftError(400, "INVALID_BODY", "Request body must be JSON.");
    }
    if (typeof body.deviceId !== "string" || body.deviceId.length < 3 || body.deviceId.length > 128) {
      throw new ShiftError(400, "INVALID_DEVICE", "deviceId is required.");
    }

    await connectToDatabase();
    const result = await ingestDeviceBatch({
      deviceId: body.deviceId,
      events: Array.isArray(body.events) ? body.events : [],
      heartbeat: body.heartbeat && typeof body.heartbeat === "object" ? (body.heartbeat as { shiftId?: unknown; location?: unknown }) : undefined,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return shiftErrorResponse(e);
  }
}
