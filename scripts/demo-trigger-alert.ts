/**
 * Demo helper: makes a driver's phone "report" a tracking problem right now, as the
 * Android app would, so the HR bell / desktop notification can be seen live.
 *
 *   npm run demo:alert -- ravi revoke     (revoke | gps-off | no-fix | resume)
 *
 * Local demo database only.
 */
import mongoose from "mongoose";

const uri = new URL(process.env.MONGODB_URI ?? "mongodb://invalid");
if (!["127.0.0.1", "localhost"].includes(uri.hostname) || !/demo/i.test(uri.pathname)) {
  throw new Error("demo:alert only runs against the local demo database.");
}

const [who = "ravi", what = "revoke"] = process.argv.slice(2);
const EVENTS: Record<string, { type: string; payload: Record<string, unknown> }> = {
  revoke: { type: "TRACKING_INTERRUPTED", payload: { cause: "GPS_PERMISSION_DENIED", reason: "Location permission for the Fleet app was turned off." } },
  "gps-off": { type: "TRACKING_INTERRUPTED", payload: { cause: "LOCATION_SERVICES_OFF", reason: "The phone's Location (GPS) was switched off." } },
  "no-fix": { type: "TRACKING_INTERRUPTED", payload: { cause: "NO_LOCATION_FIX", reason: "Location is on and allowed, but the phone is not getting a GPS fix." } },
  resume: { type: "TRACKING_RESUMED", payload: { reason: "A location fix was received again." } },
};
const ev = EVENTS[what];
if (!ev) throw new Error(`Unknown event "${what}". Use one of: ${Object.keys(EVENTS).join(", ")}`);

const { default: connectToDatabase } = await import("@/lib/db");
const { default: ShiftSession } = await import("@/models/ShiftSession");
const { ingestDeviceBatch } = await import("@/lib/shiftService");
await connectToDatabase();

const deviceId = `demo-device-${who}`;
const shift = (await ShiftSession.findOne({ deviceId, status: { $in: ["ACTIVE", "INTERRUPTED"] } }).lean()) as { shiftId: string } | null;
if (!shift) throw new Error(`${who} has no open shift; run npm run demo:seed first.`);

const now = Date.now();
const location = { lat: 12.9716, lng: 77.5946, accuracy: 12, recordedAt: now - 30_000 };
const r = await ingestDeviceBatch({
  deviceId,
  events: [{ id: `${deviceId}:live:${now}`, shiftId: shift.shiftId, type: ev.type, occurredAt: now, payload: { location, ...ev.payload } }],
  heartbeat: { shiftId: shift.shiftId, location },
});
console.log(`[demo:alert] ${who}: ${ev.type} ${String(ev.payload.cause ?? "")} -> accepted ${r.accepted.length}, status ${r.shifts[0]?.status}`);
await mongoose.disconnect();
