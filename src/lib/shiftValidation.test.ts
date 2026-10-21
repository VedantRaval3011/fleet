import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeDeviceEvent, sanitizeLocation } from "./shiftValidation.ts";

const T = Date.UTC(2026, 9, 15, 9, 0);
const base = { id: "evt-0001-aaaa", shiftId: "shift-0001-aaaa", occurredAt: T };

function ok(raw: unknown) {
  const r = sanitizeDeviceEvent(raw);
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as Extract<typeof r, { ok: true }>).event;
}
function rejected(raw: unknown) {
  const r = sanitizeDeviceEvent(raw);
  assert.equal(r.ok, false);
  return (r as Extract<typeof r, { ok: false }>).reason;
}

test("a shift start needs a valid shift type and is attributed to the driver", () => {
  const e = ok({ ...base, type: "SHIFT_STARTED", payload: { shiftType: "MORNING" } });
  assert.equal(e.actor, "driver");
  assert.equal(e.payload.shiftType, "MORNING");
  assert.equal(rejected({ ...base, type: "SHIFT_STARTED", payload: { shiftType: "NIGHT" } }), "INVALID_SHIFT_TYPE");
});

test("server-only event types cannot be submitted by a phone", () => {
  for (const type of ["HEARTBEAT_MISSED", "SIGNAL_RESTORED", "LOG_VIEWED", "MADE_UP"]) {
    assert.equal(rejected({ ...base, type }), "EVENT_TYPE_NOT_ALLOWED_FROM_DEVICE");
  }
});

test("a phone cannot claim a system end reason; it defaults to the driver's own action", () => {
  const e = ok({ ...base, type: "SHIFT_ENDED", payload: { endReason: "TRACKING_LOST_TIMEOUT" } });
  assert.equal(e.payload.endReason, "DRIVER_ENDED");
  assert.equal(e.actor, "driver");
});

test("a device-enforced schedule close is attributed to the device, not the driver", () => {
  const e = ok({ ...base, type: "SHIFT_ENDED", payload: { endReason: "SCHEDULE_ELAPSED" } });
  assert.equal(e.payload.endReason, "SCHEDULE_ELAPSED");
  assert.equal(e.actor, "device");
});

test("a phone cannot assign the server-only NO_SIGNAL cause, nor an invented one", () => {
  assert.equal(
    ok({ ...base, type: "TRACKING_INTERRUPTED", payload: { cause: "NO_SIGNAL_FROM_DEVICE" } }).payload.cause,
    undefined
  );
  assert.equal(ok({ ...base, type: "TRACKING_INTERRUPTED", payload: { cause: "AGENT_SMITH" } }).payload.cause, undefined);
  assert.equal(
    ok({ ...base, type: "TRACKING_INTERRUPTED", payload: { cause: "GPS_PERMISSION_DENIED" } }).payload.cause,
    "GPS_PERMISSION_DENIED"
  );
});

test("TRACKING_STOPPED is unintentional unless the device says explicitly otherwise", () => {
  assert.equal(ok({ ...base, type: "TRACKING_STOPPED", payload: {} }).payload.intentional, false);
  assert.equal(ok({ ...base, type: "TRACKING_STOPPED", payload: { intentional: "yes" } }).payload.intentional, false);
  assert.equal(ok({ ...base, type: "TRACKING_STOPPED", payload: { intentional: true } }).payload.intentional, true);
});

test("DEVICE_BOOTED keeps lastAliveAt only if it is plausible and not after the boot", () => {
  assert.equal(ok({ ...base, type: "DEVICE_BOOTED", payload: { lastAliveAt: T - 60_000 } }).payload.lastAliveAt, T - 60_000);
  assert.equal(ok({ ...base, type: "DEVICE_BOOTED", payload: { lastAliveAt: T + 60_000 } }).payload.lastAliveAt, undefined);
  assert.equal(ok({ ...base, type: "DEVICE_BOOTED", payload: { lastAliveAt: 5 } }).payload.lastAliveAt, undefined);
});

test("unknown payload fields are dropped and free text is bounded", () => {
  const e = ok({
    ...base,
    type: "TRACKING_RESUMED",
    payload: { reason: "x".repeat(1000), effectiveAt: 1, endReason: "TRACKING_LOST_TIMEOUT", silentSince: 3, junk: { a: 1 } },
  });
  assert.equal(e.payload.reason?.length, 300);
  assert.deepEqual(Object.keys(e.payload), ["reason"]);
});

test("malformed ids, timestamps and ids are rejected, not coerced", () => {
  assert.equal(rejected({ ...base, id: "short", type: "TRACKING_RESUMED" }), "INVALID_EVENT_ID");
  assert.equal(rejected({ ...base, shiftId: "bad id!", type: "TRACKING_RESUMED" }), "INVALID_SHIFT_ID");
  assert.equal(rejected({ ...base, occurredAt: "yesterday", type: "TRACKING_RESUMED" }), "INVALID_TIMESTAMP");
  assert.equal(rejected({ ...base, occurredAt: 12, type: "TRACKING_RESUMED" }), "INVALID_TIMESTAMP");
  assert.equal(rejected(null), "INVALID_EVENT_ID");
});

test("locations: bounds are enforced and either field naming is accepted", () => {
  assert.deepEqual(sanitizeLocation({ latitude: 23.02, longitude: 72.57, accuracyMeters: 8 }), {
    lat: 23.02,
    lng: 72.57,
    accuracy: 8,
  });
  assert.equal(sanitizeLocation({ lat: 91, lng: 0 }), undefined);
  assert.equal(sanitizeLocation({ lat: 0, lng: 181 }), undefined);
  assert.equal(sanitizeLocation({ lat: "1", lng: 2 }), undefined);
  assert.equal(sanitizeLocation(null), undefined);
});
