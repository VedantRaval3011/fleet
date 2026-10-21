import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyShiftEvent, isAlertOngoing } from "./trackingAlerts.ts";

test("location switched off and permission revoked are distinct critical alerts", () => {
  const off = classifyShiftEvent("TRACKING_INTERRUPTED", { cause: "LOCATION_SERVICES_OFF" });
  const perm = classifyShiftEvent("TRACKING_INTERRUPTED", { cause: "GPS_PERMISSION_DENIED" });
  assert.equal(off?.title, "Location Services Disabled");
  assert.equal(perm?.title, "Location Permission Revoked");
  assert.equal(off?.severity, "critical");
  assert.equal(perm?.severity, "critical");
});

test("a lost GPS fix and a stopped service are interruptions, not 'GPS disabled'", () => {
  const noFix = classifyShiftEvent("TRACKING_INTERRUPTED", { cause: "NO_LOCATION_FIX" });
  const svc = classifyShiftEvent("TRACKING_INTERRUPTED", { cause: "TRACKING_SERVICE_STOPPED" });
  assert.equal(noFix?.title, "Location Updates Interrupted");
  assert.equal(noFix?.severity, "warning");
  assert.equal(svc?.kind, "TRACKING_SERVICE_STOPPED");
  assert.equal(svc?.severity, "warning");
});

test("network loss is informational and server silence never claims a cause", () => {
  assert.equal(classifyShiftEvent("CONNECTIVITY_LOST")?.severity, "info");
  const silent = classifyShiftEvent("HEARTBEAT_MISSED");
  assert.equal(silent?.title, "Device Not Reporting");
  assert.match(silent!.explanation, /look the same/);
});

test("ending a shift is not an alert, unless the system closed it for an unresolved failure", () => {
  assert.equal(classifyShiftEvent("TRACKING_STOPPED", { intentional: true }), null);
  assert.equal(classifyShiftEvent("SHIFT_ENDED", { endReason: "DRIVER_ENDED" }), null);
  assert.equal(classifyShiftEvent("SHIFT_ENDED", { endReason: "SCHEDULE_ELAPSED" }), null);
  assert.equal(classifyShiftEvent("SHIFT_ENDED", { endReason: "TRACKING_LOST_TIMEOUT" })?.severity, "critical");
  assert.equal(classifyShiftEvent("TRACKING_STOPPED", {})?.kind, "TRACKING_SERVICE_STOPPED");
  assert.equal(classifyShiftEvent("SHIFT_STARTED"), null);
  assert.equal(classifyShiftEvent("LOG_VIEWED"), null);
});

test("recoveries are classified as recovery", () => {
  for (const t of ["TRACKING_RESUMED", "SIGNAL_RESTORED", "CONNECTIVITY_RESTORED"] as const) {
    assert.equal(classifyShiftEvent(t)?.severity, "recovery", t);
  }
});

test("isAlertOngoing follows the shift's current state", () => {
  const off = classifyShiftEvent("TRACKING_INTERRUPTED", { cause: "LOCATION_SERVICES_OFF" })!;
  const at = 1_000;
  assert.equal(isAlertOngoing(off, at, { status: "INTERRUPTED", currentCause: "LOCATION_SERVICES_OFF", currentInterruptionStart: at }), true);
  assert.equal(isAlertOngoing(off, at, { status: "ACTIVE" }), false, "resolved once tracking resumed");
  assert.equal(isAlertOngoing(off, at, { status: "INTERRUPTED", currentCause: "GPS_PERMISSION_DENIED" }), false);
  assert.equal(isAlertOngoing(off, at, { status: "ENDED", currentCause: "LOCATION_SERVICES_OFF" }), false);

  const net = classifyShiftEvent("CONNECTIVITY_LOST")!;
  assert.equal(isAlertOngoing(net, at, { status: "ACTIVE", connectivityLost: true }), true);
  assert.equal(isAlertOngoing(net, at, { status: "ACTIVE", connectivityLost: false }), false);

  const silent = classifyShiftEvent("HEARTBEAT_MISSED")!;
  assert.equal(isAlertOngoing(silent, at, { status: "INTERRUPTED", openSilenceSince: 500 }), true);
});
