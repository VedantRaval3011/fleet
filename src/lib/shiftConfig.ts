/**
 * The two predefined shifts and the business-rule thresholds around them.
 *
 * Pure (no DB, no Next imports, relative imports only) so the schedule maths can be
 * unit-tested with `node --test` and mirrored exactly by the Android client.
 *
 * Shift hours are wall-clock times in SHIFT_TIMEZONE (default Asia/Kolkata). They
 * can be changed without a code edit via env:
 *   SHIFT_MORNING_HOURS="06:00-14:00"
 *   SHIFT_EVENING_HOURS="14:00-22:00"
 *   SHIFT_TIMEZONE="Asia/Kolkata"
 * The server publishes the effective values to devices (GET /api/shifts/config and
 * every device-ingest response), so a phone follows the server rather than its own
 * copy of the schedule.
 */

export const SHIFT_TYPES = ["MORNING", "EVENING"] as const;
export type ShiftType = (typeof SHIFT_TYPES)[number];

export function isShiftType(v: unknown): v is ShiftType {
  return typeof v === "string" && (SHIFT_TYPES as readonly string[]).includes(v);
}

export interface ShiftDefinition {
  type: ShiftType;
  label: string;
  /** Minutes after local midnight. */
  startMinute: number;
  /** Minutes after local midnight. If <= startMinute the shift ends the next day. */
  endMinute: number;
}

const MINUTE = 60_000;

/**
 * Business rules. Every number here is a policy decision, collected in one place so
 * it can be reviewed and tuned rather than hunted for.
 */
export const SHIFT_RULES = {
  /** A driver may switch a shift on this long before its scheduled start. */
  earlyStartMs: 30 * MINUTE,
  /**
   * After the scheduled end the shift is closed by the system. Tracking is only
   * legitimate for the shift, so a driver who forgets to switch off must not be
   * tracked indefinitely.
   */
  endGraceMs: 15 * MINUTE,
  /** The device is expected to report at least this often while on shift. */
  heartbeatIntervalMs: 5 * MINUTE,
  /**
   * No word from the device for this long and the driver stops being shown as
   * actively on shift: the shift is marked interrupted ("not reporting").
   * The cause is NOT guessed - internet loss, a dead battery and a killed app
   * look identical from the server.
   */
  staleAfterMs: 10 * MINUTE,
  /**
   * A tracking failure the device itself reported (permission revoked, location
   * switched off, ...) that is still unresolved after this long ends the shift:
   * the driver has not been tracked for an hour and is not "on shift". Silence
   * alone never triggers this, because a phone that is merely offline is still
   * recording locally and will upload on reconnect.
   */
  autoEndAfterInterruptionMs: 60 * MINUTE,
  /**
   * When explaining a silent period with a device-reported cause, boundaries may
   * differ by this much (the last heartbeat precedes the outage it describes).
   */
  attributionToleranceMs: 6 * MINUTE,
  /** Device-supplied timestamps this far in the future are clamped to receive time. */
  clockSkewToleranceMs: 2 * MINUTE,
} as const;

function parseHours(raw: string | undefined, fallback: [number, number]): [number, number] {
  if (!raw) return fallback;
  const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(raw);
  if (!m) return fallback;
  const [sh, sm, eh, em] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (sh > 23 || eh > 24 || sm > 59 || em > 59) return fallback;
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start === end) return fallback;
  return [start, end];
}

export function getShiftTimezone(): string {
  return process.env.SHIFT_TIMEZONE?.trim() || "Asia/Kolkata";
}

export function getShiftDefinitions(): ShiftDefinition[] {
  const [mStart, mEnd] = parseHours(process.env.SHIFT_MORNING_HOURS, [6 * 60, 14 * 60]);
  const [eStart, eEnd] = parseHours(process.env.SHIFT_EVENING_HOURS, [14 * 60, 22 * 60]);
  return [
    { type: "MORNING", label: "Morning shift", startMinute: mStart, endMinute: mEnd },
    { type: "EVENING", label: "Evening shift", startMinute: eStart, endMinute: eEnd },
  ];
}

export function getShiftDefinition(type: ShiftType, defs = getShiftDefinitions()): ShiftDefinition {
  return defs.find((d) => d.type === type)!;
}

// --- time zone arithmetic (no dependency; works for DST and fixed-offset zones) --------

function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Calendar date of an instant in `tz`. */
export function localDate(utcMs: number, tz: string): { y: number; m: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

/** UTC instant of `minutes` after local midnight on y-m-d in `tz`. Day overflow is allowed. */
export function localToUtc(y: number, m: number, d: number, minutes: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const first = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(first, tz);
}

export interface ShiftWindow {
  type: ShiftType;
  label: string;
  /** UTC ms */
  start: number;
  /** UTC ms */
  end: number;
}

/** The occurrence of `def` that begins on the given local calendar day. */
export function windowOnDay(def: ShiftDefinition, y: number, m: number, d: number, tz: string): ShiftWindow {
  const start = localToUtc(y, m, d, def.startMinute, tz);
  const overnight = def.endMinute <= def.startMinute;
  const end = localToUtc(y, m, overnight ? d + 1 : d, def.endMinute, tz);
  return { type: def.type, label: def.label, start, end };
}

/** Occurrences of every shift that could be relevant to `at`: yesterday's, today's, tomorrow's. */
function candidateWindows(at: number, tz: string, defs: ShiftDefinition[]): ShiftWindow[] {
  const { y, m, d } = localDate(at, tz);
  const out: ShiftWindow[] = [];
  for (const offset of [-1, 0, 1]) {
    for (const def of defs) out.push(windowOnDay(def, y, m, d + offset, tz));
  }
  return out;
}

/**
 * Shifts a driver can switch on at `at`: from `earlyStartMs` before the scheduled
 * start until the scheduled end. Around a handover both shifts can be eligible.
 */
export function eligibleShiftsAt(
  at: number,
  tz = getShiftTimezone(),
  defs = getShiftDefinitions(),
  rules: Pick<typeof SHIFT_RULES, "earlyStartMs"> = SHIFT_RULES
): ShiftWindow[] {
  return candidateWindows(at, tz, defs)
    .filter((w) => at >= w.start - rules.earlyStartMs && at < w.end)
    .sort((a, b) => a.start - b.start);
}

/**
 * The scheduled window a shift of `type` started at `startedAt` belongs to, and
 * whether the start was inside the permitted window. A start outside it is still
 * recorded - it happened - but flagged, never silently reassigned or dropped.
 */
export function windowForStart(
  type: ShiftType,
  startedAt: number,
  tz = getShiftTimezone(),
  defs = getShiftDefinitions(),
  rules: Pick<typeof SHIFT_RULES, "earlyStartMs"> = SHIFT_RULES
): { window: ShiftWindow; withinSchedule: boolean } {
  const candidates = candidateWindows(startedAt, tz, defs).filter((w) => w.type === type);
  const inside = candidates.find((w) => startedAt >= w.start - rules.earlyStartMs && startedAt < w.end);
  if (inside) return { window: inside, withinSchedule: true };
  const nearest = candidates.reduce((best, w) =>
    Math.abs(w.start - startedAt) < Math.abs(best.start - startedAt) ? w : best
  );
  return { window: nearest, withinSchedule: false };
}

/** What devices and the driver UI are told about the schedule. */
export function publicShiftConfig() {
  const tz = getShiftTimezone();
  return {
    timezone: tz,
    shifts: getShiftDefinitions().map((d) => ({
      type: d.type,
      label: d.label,
      startMinute: d.startMinute,
      endMinute: d.endMinute,
    })),
    rules: {
      earlyStartMs: SHIFT_RULES.earlyStartMs,
      endGraceMs: SHIFT_RULES.endGraceMs,
      heartbeatIntervalMs: SHIFT_RULES.heartbeatIntervalMs,
      staleAfterMs: SHIFT_RULES.staleAfterMs,
      autoEndAfterInterruptionMs: SHIFT_RULES.autoEndAfterInterruptionMs,
    },
  };
}
