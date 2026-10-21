import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampOccurredAt,
  computeMetrics,
  planSignalRestored,
  planSweep,
  reduceShift,
  type EngineEvent,
  type EventPayload,
  type PlannedEvent,
} from "./shiftEngine.ts";
import { SHIFT_RULES } from "./shiftConfig.ts";
import type { ShiftActor, ShiftEventType } from "./shiftVocabulary.ts";

const BASE = Date.UTC(2026, 9, 15, 8, 30); // 14:00 IST
const min = (n: number) => BASE + n * 60_000;
const MIN = 60_000;

let seq = 0;
function ev(
  type: ShiftEventType,
  at: number,
  payload: EventPayload = {},
  actor: ShiftActor = "device",
  key?: string
): EngineEvent {
  seq += 1;
  return { key: key ?? `${type}:${at}:${seq}`, type, occurredAt: at, seq, actor, payload };
}
const start = (at = min(0)) => ev("SHIFT_STARTED", at, { shiftType: "EVENING" }, "driver");
const sched = { start: min(0), end: min(8 * 60) };

test("normal shift: driver ends it manually", () => {
  const s = reduceShift([
    start(),
    ev("TRACKING_STARTED", min(0)),
    ev("TRACKING_STOPPED", min(120), { intentional: true }),
    ev("SHIFT_ENDED", min(120), { endReason: "DRIVER_ENDED" }, "driver"),
  ]);
  assert.equal(s.status, "ENDED");
  assert.equal(s.endedBy, "driver");
  assert.equal(s.endReason, "DRIVER_ENDED");
  assert.equal(s.actualEnd, min(120));
  assert.equal(s.trackingStartedAt, min(0));
  assert.equal(s.trackingStoppedAt, min(120));
  assert.deepEqual(s.interruptions, []);
  const m = computeMetrics(s, sched, min(200));
  assert.equal(m.actualMs, 120 * MIN);
  assert.equal(m.trackedMs, 120 * MIN);
  assert.equal(m.varianceMs, 120 * MIN - 8 * 60 * MIN);
});

test("GPS permission denied: interrupted with that cause, then resumed", () => {
  const events = [
    start(),
    ev("TRACKING_STARTED", min(0)),
    ev("TRACKING_INTERRUPTED", min(30), { cause: "GPS_PERMISSION_DENIED", evidence: "permission revoked" }),
  ];
  let s = reduceShift(events);
  assert.equal(s.status, "INTERRUPTED");
  assert.equal(s.currentCause, "GPS_PERMISSION_DENIED");
  assert.equal(s.endedBy, null, "an interruption is never recorded as the driver ending the shift");

  s = reduceShift([...events, ev("TRACKING_RESUMED", min(45))]);
  assert.equal(s.status, "ACTIVE");
  assert.equal(s.interruptions.length, 1);
  assert.equal(s.interruptions[0].endedAt, min(45));
  assert.equal(s.interruptions[0].closedBy, "resumed");
  assert.equal(s.interruptions[0].evidence, "permission revoked");
  const m = computeMetrics(s, sched, min(60));
  assert.equal(m.trackingInterruptedMs, 15 * MIN);
  assert.equal(m.trackedMs, 45 * MIN);
});

test("an unexpected tracking stop is an interruption, not an intentional end", () => {
  const s = reduceShift([
    start(),
    ev("TRACKING_STARTED", min(0)),
    ev("TRACKING_STOPPED", min(20), { intentional: false }),
  ]);
  assert.equal(s.status, "INTERRUPTED");
  assert.equal(s.currentCause, "TRACKING_SERVICE_STOPPED");
  assert.equal(s.endedBy, null);
  assert.equal(s.trackingStoppedAt, min(20));
});

test("an unknown cause string is not trusted; it becomes UNKNOWN", () => {
  const s = reduceShift([start(), ev("TRACKING_INTERRUPTED", min(5), { cause: "BECAUSE_I_SAID_SO" })]);
  assert.equal(s.currentCause, "UNKNOWN");
});

test("repeat reports of the same condition do not stack", () => {
  const s = reduceShift([
    start(),
    ev("TRACKING_INTERRUPTED", min(5), { cause: "LOCATION_SERVICES_OFF" }),
    ev("TRACKING_INTERRUPTED", min(6), { cause: "LOCATION_SERVICES_OFF" }),
  ]);
  assert.equal(s.interruptions.length, 1);
  assert.equal(s.interruptions[0].startedAt, min(5));
});

test("a changed cause closes the old interruption and opens a new one (both counted)", () => {
  const s = reduceShift([
    start(),
    ev("TRACKING_INTERRUPTED", min(5), { cause: "LOCATION_SERVICES_OFF" }),
    ev("TRACKING_INTERRUPTED", min(15), { cause: "GPS_PERMISSION_DENIED" }),
    ev("TRACKING_RESUMED", min(25)),
  ]);
  assert.equal(s.interruptions.length, 2);
  assert.equal(s.interruptions[0].closedBy, "superseded");
  assert.equal(computeMetrics(s, sched, min(30)).trackingInterruptedMs, 20 * MIN);
});

test("server-detected silence: shown as interrupted/not reporting, cause not guessed", () => {
  const events = [
    start(),
    ev("TRACKING_STARTED", min(0)),
    ev("HEARTBEAT_MISSED", min(25), { silentSince: min(15) }, "system", "sys:missed:1"),
  ];
  let s = reduceShift(events);
  assert.equal(s.status, "INTERRUPTED");
  assert.equal(s.currentCause, "NO_SIGNAL_FROM_DEVICE");
  assert.equal(s.currentInterruptionStart, min(15));
  assert.equal(s.interruptions[0].source, "system");

  s = reduceShift([...events, ev("SIGNAL_RESTORED", min(50), {}, "system", "sys:restored:1")]);
  assert.equal(s.status, "ACTIVE");
  assert.equal(s.interruptions.length, 1);
  assert.equal(s.interruptions[0].cause, "NO_SIGNAL_FROM_DEVICE");
  assert.equal(s.interruptions[0].endedAt, min(50));
  assert.equal(computeMetrics(s, sched, min(60)).trackingInterruptedMs, 35 * MIN);
});

test("internet loss is NOT a tracking failure: silence explained by a device connectivity report", () => {
  const s = reduceShift([
    start(),
    ev("TRACKING_STARTED", min(0)),
    ev("HEARTBEAT_MISSED", min(25), { silentSince: min(15) }, "system", "sys:missed:1"),
    // The phone reports after the fact that it was offline but kept tracking.
    ev("CONNECTIVITY_LOST", min(17)),
    ev("CONNECTIVITY_RESTORED", min(50)),
    ev("SIGNAL_RESTORED", min(50), {}, "system", "sys:restored:1"),
  ]);
  assert.equal(s.status, "ACTIVE");
  assert.deepEqual(
    s.interruptions.map((i) => i.kind),
    ["CONNECTIVITY"]
  );
  const m = computeMetrics(s, sched, min(60));
  assert.equal(m.trackingInterruptedMs, 0, "tracking never stopped");
  assert.equal(m.connectivityMs, 33 * MIN);
  assert.equal(m.trackedMs, m.actualMs);
});

test("a short connectivity blip does not excuse a long silence", () => {
  const s = reduceShift([
    start(),
    ev("HEARTBEAT_MISSED", min(25), { silentSince: min(15) }, "system", "sys:missed:1"),
    ev("CONNECTIVITY_LOST", min(16)),
    ev("CONNECTIVITY_RESTORED", min(18)),
    ev("SIGNAL_RESTORED", min(75), {}, "system", "sys:restored:1"),
  ]);
  const unexplained = s.interruptions.filter((i) => i.cause === "NO_SIGNAL_FROM_DEVICE");
  assert.equal(unexplained.length, 1);
  assert.ok(unexplained[0].startedAt >= min(18) + SHIFT_RULES.attributionToleranceMs - MIN);
  assert.equal(unexplained[0].endedAt, min(75));
});

test("a connectivity report does not absorb the tail of an earlier silence that already ended in contact", () => {
  const s = reduceShift([
    start(),
    ev("HEARTBEAT_MISSED", min(25), { silentSince: min(15) }, "system", "sys:missed:1"),
    ev("SIGNAL_RESTORED", min(60), {}, "system", "sys:restored:1"), // real contact at +60
    ev("CONNECTIVITY_LOST", min(62)),
    ev("CONNECTIVITY_RESTORED", min(100)),
  ]);
  const unexplained = s.interruptions.filter((i) => i.cause === "NO_SIGNAL_FROM_DEVICE");
  assert.equal(unexplained.length, 1);
  assert.equal(unexplained[0].startedAt, min(15));
  assert.equal(unexplained[0].endedAt, min(60), "the whole silence up to the contact stays unexplained");
});

test("device shutdown is attributed only when the device reports when it was last alive", () => {
  const withEvidence = reduceShift([
    start(),
    ev("HEARTBEAT_MISSED", min(25), { silentSince: min(15) }, "system", "sys:missed:1"),
    ev("DEVICE_BOOTED", min(60), { lastAliveAt: min(16) }),
    ev("SIGNAL_RESTORED", min(60), {}, "system", "sys:restored:1"),
  ]);
  assert.equal(withEvidence.status, "ACTIVE");
  const shutdown = withEvidence.interruptions.filter((i) => i.cause === "DEVICE_SHUTDOWN");
  assert.equal(shutdown.length, 1);
  assert.equal(shutdown[0].source, "device_inferred");
  assert.equal(shutdown[0].startedAt, min(16));
  assert.equal(shutdown[0].endedAt, min(60));
  assert.equal(
    withEvidence.interruptions.filter((i) => i.cause === "NO_SIGNAL_FROM_DEVICE").length,
    0,
    "the silence is explained by the reported shutdown"
  );

  const noEvidence = reduceShift([start(), ev("DEVICE_BOOTED", min(60), {})]);
  assert.equal(noEvidence.interruptions.length, 0, "no lastAliveAt, so no shutdown is invented");
});

test("event arrival order does not change the outcome", () => {
  const events = [
    start(),
    ev("TRACKING_STARTED", min(0)),
    ev("CONNECTIVITY_LOST", min(17)),
    ev("TRACKING_INTERRUPTED", min(30), { cause: "LOCATION_SERVICES_OFF" }),
    ev("TRACKING_RESUMED", min(40)),
    ev("CONNECTIVITY_RESTORED", min(50)),
    ev("SHIFT_ENDED", min(90), { endReason: "DRIVER_ENDED" }, "driver"),
  ];
  const reference = JSON.stringify(reduceShift(events));
  for (let i = 0; i < 20; i++) {
    const shuffled = [...events].sort(() => Math.random() - 0.5);
    assert.equal(JSON.stringify(reduceShift(shuffled)), reference);
  }
});

test("events outside the shift are kept in the log's ignored list, not applied", () => {
  const s = reduceShift([
    ev("TRACKING_INTERRUPTED", min(-5), { cause: "LOCATION_SERVICES_OFF" }),
    start(),
    start(min(1)),
    ev("SHIFT_ENDED", min(60), { endReason: "DRIVER_ENDED" }, "driver"),
    ev("TRACKING_INTERRUPTED", min(70), { cause: "GPS_PERMISSION_DENIED" }),
  ]);
  assert.equal(s.status, "ENDED");
  assert.equal(s.actualStart, min(0));
  assert.deepEqual(
    s.ignored.map((i) => i.reason).sort(),
    ["AFTER_SHIFT_END", "BEFORE_SHIFT_START", "DUPLICATE_START"]
  );
  assert.equal(s.interruptions.length, 0);
});

test("LOG_VIEWED never affects state", () => {
  const a = reduceShift([start()]);
  const b = reduceShift([start(), ev("LOG_VIEWED", min(5), {}, "admin")]);
  assert.deepEqual(a, b);
});

test("last location is the most recent recorded fix reported in any event", () => {
  const s = reduceShift([
    start(min(0)),
    ev("TRACKING_STARTED", min(1), { location: { lat: 23.0, lng: 72.5, recordedAt: min(1) } }),
    ev("TRACKING_INTERRUPTED", min(30), {
      cause: "LOCATION_SERVICES_OFF",
      location: { lat: 23.1, lng: 72.6, recordedAt: min(29) },
    }),
  ]);
  assert.deepEqual(s.lastLocation, { lat: 23.1, lng: 72.6, recordedAt: min(29), at: min(29) });
});

// --- sweep planner ------------------------------------------------------------------------

function applyPlanned(events: EngineEvent[], planned: PlannedEvent[]): EngineEvent[] {
  return [
    ...events,
    ...planned.map((p) => ev(p.type, p.occurredAt, p.payload, "system", p.key)),
  ];
}

test("sweep: no contact for the stale threshold marks the shift not reporting, once", () => {
  let events = [start(), ev("TRACKING_STARTED", min(0))];
  const lastContactAt = min(10);
  const now = min(10) + SHIFT_RULES.staleAfterMs + MIN;

  const planned = planSweep(reduceShift(events), { scheduledEnd: sched.end, lastContactAt, now });
  assert.equal(planned.length, 1);
  assert.equal(planned[0].type, "HEARTBEAT_MISSED");
  assert.equal(planned[0].occurredAt, lastContactAt + SHIFT_RULES.staleAfterMs);
  assert.equal(planned[0].payload.silentSince, lastContactAt);

  events = applyPlanned(events, planned);
  assert.equal(reduceShift(events).status, "INTERRUPTED");
  assert.deepEqual(planSweep(reduceShift(events), { scheduledEnd: sched.end, lastContactAt, now }), []);
});

test("sweep: a fresh device is left alone", () => {
  const events = [start()];
  const planned = planSweep(reduceShift(events), { scheduledEnd: sched.end, lastContactAt: min(10), now: min(12) });
  assert.deepEqual(planned, []);
});

test("sweep: shift is closed at scheduled end plus grace, evidence says it was the system", () => {
  const events = [start(), ev("TRACKING_STARTED", min(0))];
  const now = sched.end + SHIFT_RULES.endGraceMs + 5 * MIN;
  const planned = planSweep(reduceShift(events), { scheduledEnd: sched.end, lastContactAt: now - MIN, now });
  assert.equal(planned.length, 1);
  assert.equal(planned[0].payload.endReason, "SCHEDULE_ELAPSED");

  const s = reduceShift(applyPlanned(events, planned));
  assert.equal(s.status, "ENDED");
  assert.equal(s.endedBy, "system");
  assert.equal(s.endReason, "SCHEDULE_ELAPSED");
  assert.equal(s.actualEnd, sched.end + SHIFT_RULES.endGraceMs);
});

test("sweep: silence that began before the schedule end is recorded before the close", () => {
  const events = [start()];
  const lastContactAt = sched.end - 30 * MIN;
  const now = sched.end + 3 * 60 * MIN;
  const planned = planSweep(reduceShift(events), { scheduledEnd: sched.end, lastContactAt, now });
  assert.deepEqual(planned.map((p) => p.type), ["HEARTBEAT_MISSED", "SHIFT_ENDED"]);

  const s = reduceShift(applyPlanned(events, planned));
  assert.equal(s.status, "ENDED");
  assert.equal(s.interruptions.length, 1);
  assert.equal(s.interruptions[0].cause, "NO_SIGNAL_FROM_DEVICE");
  assert.equal(s.interruptions[0].closedBy, "shift_end");
});

test("sweep: a shift started after its window had closed is closed immediately, not left tracking", () => {
  const late = start(sched.end + 2 * 60 * MIN);
  const now = sched.end + 2 * 60 * MIN + MIN;
  const planned = planSweep(reduceShift([late]), { scheduledEnd: sched.end, lastContactAt: now - MIN, now });
  const s = reduceShift(applyPlanned([late], planned));
  assert.equal(s.status, "ENDED");
  assert.equal(s.endReason, "SCHEDULE_ELAPSED");
});

test("sweep: a device-reported failure unresolved for an hour ends the shift at the failure time", () => {
  const events = [
    start(),
    ev("TRACKING_STARTED", min(0)),
    ev("TRACKING_INTERRUPTED", min(30), { cause: "GPS_PERMISSION_DENIED" }),
  ];
  const now = min(30) + SHIFT_RULES.autoEndAfterInterruptionMs + MIN;
  const planned = planSweep(reduceShift(events), { scheduledEnd: sched.end, lastContactAt: min(31), now });
  assert.equal(planned.length, 1);
  assert.equal(planned[0].payload.endReason, "TRACKING_LOST_TIMEOUT");

  const s = reduceShift(applyPlanned(events, planned));
  assert.equal(s.status, "ENDED");
  assert.equal(s.endedBy, "system");
  assert.equal(s.endReason, "TRACKING_LOST_TIMEOUT");
  assert.equal(s.actualEnd, min(30), "the shift effectively ended when tracking was last known good");
  // The log still shows how long the failure ran.
  assert.equal(s.interruptions[0].endedAt, min(30) + SHIFT_RULES.autoEndAfterInterruptionMs);
});

test("no GPS fix: shown as interrupted with its own cause, but never auto-ends the shift", () => {
  const events = [
    start(),
    ev("TRACKING_STARTED", min(0)),
    ev("TRACKING_INTERRUPTED", min(30), { cause: "NO_LOCATION_FIX" }),
  ];
  const s = reduceShift(events);
  assert.equal(s.status, "INTERRUPTED");
  assert.equal(s.currentCause, "NO_LOCATION_FIX");

  const now = min(30) + 3 * SHIFT_RULES.autoEndAfterInterruptionMs;
  const planned = planSweep(s, { scheduledEnd: sched.end, lastContactAt: now - MIN, now });
  assert.deepEqual(planned, [], "a tunnel or basement must not close the shift");
});

test("no GPS fix does not hide a phone that then goes silent", () => {
  const events = [
    start(),
    ev("TRACKING_STARTED", min(0)),
    ev("TRACKING_INTERRUPTED", min(30), { cause: "NO_LOCATION_FIX" }),
  ];
  const now = min(31) + SHIFT_RULES.staleAfterMs + MIN;
  const planned = planSweep(reduceShift(events), { scheduledEnd: sched.end, lastContactAt: min(31), now });
  assert.deepEqual(planned.map((p) => p.type), ["HEARTBEAT_MISSED"]);
});

test("no GPS fix escalating to Location switched off: the harder cause takes over and can auto-end", () => {
  const events = [
    start(),
    ev("TRACKING_STARTED", min(0)),
    ev("TRACKING_INTERRUPTED", min(30), { cause: "NO_LOCATION_FIX" }),
    ev("TRACKING_INTERRUPTED", min(40), { cause: "LOCATION_SERVICES_OFF" }),
  ];
  const s = reduceShift(events);
  assert.equal(s.currentCause, "LOCATION_SERVICES_OFF");
  assert.deepEqual(s.interruptions.map((i) => i.cause), ["NO_LOCATION_FIX", "LOCATION_SERVICES_OFF"]);
  const now = min(40) + SHIFT_RULES.autoEndAfterInterruptionMs + MIN;
  const planned = planSweep(s, { scheduledEnd: sched.end, lastContactAt: now - MIN, now });
  assert.equal(planned[0].payload.endReason, "TRACKING_LOST_TIMEOUT");
  assert.equal(planned[0].payload.interruptionStartedAt, min(40));
});

test("sweep: silence alone never ends the shift early", () => {
  const events = [
    start(),
    ev("HEARTBEAT_MISSED", min(25), { silentSince: min(15) }, "system", "sys:missed:1"),
  ];
  const now = min(15) + 5 * 60 * MIN; // five hours of silence, before the schedule end
  const planned = planSweep(reduceShift(events), { scheduledEnd: sched.end, lastContactAt: min(15), now });
  assert.deepEqual(planned, []);
});

test("a late 'resumed' report cancels an auto-close that was decided on stale information", () => {
  const events = [
    start(),
    ev("TRACKING_INTERRUPTED", min(30), { cause: "LOCATION_SERVICES_OFF" }),
  ];
  const now = min(30) + SHIFT_RULES.autoEndAfterInterruptionMs + MIN;
  const planned = planSweep(reduceShift(events), { scheduledEnd: sched.end, lastContactAt: min(31), now });
  const closed = applyPlanned(events, planned);
  assert.equal(reduceShift(closed).status, "ENDED");

  // The phone had actually resumed at +20 min, but was offline and reports it late.
  const reconciled = reduceShift([...closed, ev("TRACKING_RESUMED", min(50))]);
  assert.notEqual(reconciled.status, "ENDED");
  assert.equal(reconciled.interruptions[0].endedAt, min(50));
  assert.ok(reconciled.ignored.some((i) => i.reason === "SUPERSEDED_BY_LATER_REPORT"));
});

test("a driver's manual end that happened before a system close wins", () => {
  const events = [
    start(),
    ev("TRACKING_INTERRUPTED", min(30), { cause: "LOCATION_SERVICES_OFF" }),
  ];
  const now = min(30) + SHIFT_RULES.autoEndAfterInterruptionMs + MIN;
  const planned = planSweep(reduceShift(events), { scheduledEnd: sched.end, lastContactAt: min(31), now });
  // Driver ended it at +40 (offline), reported late.
  const s = reduceShift([
    ...applyPlanned(events, planned),
    ev("SHIFT_ENDED", min(40), { endReason: "DRIVER_ENDED" }, "driver"),
  ]);
  assert.equal(s.endedBy, "driver");
  assert.equal(s.endReason, "DRIVER_ENDED");
  assert.equal(s.actualEnd, min(40));
});

test("signal restored is planned only while a silence is open", () => {
  const quiet = reduceShift([start()]);
  assert.deepEqual(planSignalRestored(quiet, min(5)), []);
  const silent = reduceShift([
    start(),
    ev("HEARTBEAT_MISSED", min(25), { silentSince: min(15) }, "system", "sys:missed:1"),
  ]);
  const p = planSignalRestored(silent, min(50));
  assert.equal(p.length, 1);
  assert.equal(p[0].key, `sys:restored:${min(15)}`);
});

test("clampOccurredAt: past timestamps are trusted, future ones are clamped and flagged", () => {
  const received = min(100);
  assert.deepEqual(clampOccurredAt(min(10), received), { at: min(10), adjusted: false });
  assert.deepEqual(clampOccurredAt(received + MIN, received), { at: received + MIN, adjusted: false });
  assert.deepEqual(clampOccurredAt(received + 10 * MIN, received), { at: received, adjusted: true });
  assert.deepEqual(clampOccurredAt(Number.NaN, received), { at: received, adjusted: true });
});
