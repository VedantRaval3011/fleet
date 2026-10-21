import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eligibleShiftsAt,
  getShiftDefinitions,
  localToUtc,
  windowForStart,
  windowOnDay,
  type ShiftDefinition,
} from "./shiftConfig.ts";

const TZ = "Asia/Kolkata"; // UTC+05:30, no DST
const defs = getShiftDefinitions();

/** Build a UTC instant from an IST wall-clock time. */
function ist(y: number, m: number, d: number, hh: number, mm = 0): number {
  return Date.UTC(y, m - 1, d, hh, mm) - (5 * 60 + 30) * 60_000;
}

test("default shifts are 06:00-14:00 and 14:00-22:00 local", () => {
  assert.deepEqual(
    defs.map((d) => [d.type, d.startMinute, d.endMinute]),
    [
      ["MORNING", 360, 840],
      ["EVENING", 840, 1320],
    ]
  );
});

test("localToUtc converts IST wall clock to UTC", () => {
  assert.equal(localToUtc(2026, 10, 15, 6 * 60, TZ), ist(2026, 10, 15, 6));
  assert.equal(new Date(localToUtc(2026, 10, 15, 6 * 60, TZ)).toISOString(), "2026-10-15T00:30:00.000Z");
});

test("windowOnDay gives the scheduled interval", () => {
  const w = windowOnDay(defs[0], 2026, 10, 15, TZ);
  assert.equal(w.start, ist(2026, 10, 15, 6));
  assert.equal(w.end, ist(2026, 10, 15, 14));
});

test("an overnight shift ends the next day", () => {
  const night: ShiftDefinition = { type: "EVENING", label: "Night", startMinute: 22 * 60, endMinute: 6 * 60 };
  const w = windowOnDay(night, 2026, 10, 15, TZ);
  assert.equal(w.start, ist(2026, 10, 15, 22));
  assert.equal(w.end, ist(2026, 10, 16, 6));
});

test("mid-morning: only the morning shift is eligible", () => {
  const e = eligibleShiftsAt(ist(2026, 10, 15, 9), TZ, defs);
  assert.deepEqual(e.map((w) => w.type), ["MORNING"]);
});

test("early start is allowed 30 minutes before, not 31", () => {
  assert.deepEqual(eligibleShiftsAt(ist(2026, 10, 15, 5, 30), TZ, defs).map((w) => w.type), ["MORNING"]);
  assert.deepEqual(eligibleShiftsAt(ist(2026, 10, 15, 5, 29), TZ, defs), []);
});

test("handover window: both shifts are eligible", () => {
  const e = eligibleShiftsAt(ist(2026, 10, 15, 13, 45), TZ, defs);
  assert.deepEqual(e.map((w) => w.type), ["MORNING", "EVENING"]);
});

test("at the scheduled end the shift is no longer startable", () => {
  const e = eligibleShiftsAt(ist(2026, 10, 15, 22), TZ, defs);
  assert.deepEqual(e, []);
});

test("overnight shift is eligible after midnight, via yesterday's occurrence", () => {
  const night: ShiftDefinition[] = [{ type: "EVENING", label: "Night", startMinute: 22 * 60, endMinute: 6 * 60 }, defs[0]];
  const e = eligibleShiftsAt(ist(2026, 10, 16, 1), TZ, night);
  assert.equal(e.length, 1);
  assert.equal(e[0].start, ist(2026, 10, 15, 22));
});

test("windowForStart attaches an in-window start to its scheduled occurrence", () => {
  const r = windowForStart("EVENING", ist(2026, 10, 15, 14, 5), TZ, defs);
  assert.equal(r.withinSchedule, true);
  assert.equal(r.window.start, ist(2026, 10, 15, 14));
  assert.equal(r.window.end, ist(2026, 10, 15, 22));
});

test("windowForStart flags, but does not drop, an out-of-window start", () => {
  const r = windowForStart("MORNING", ist(2026, 10, 15, 16), TZ, defs);
  assert.equal(r.withinSchedule, false);
  assert.equal(r.window.type, "MORNING");
  assert.equal(r.window.start, ist(2026, 10, 15, 6));
});
