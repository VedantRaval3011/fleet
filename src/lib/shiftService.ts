/**
 * Database side of shift management: ingesting what phones report, sweeping for
 * missed heartbeats and schedule ends, and the read models the admin board and the
 * driver portal use. All state decisions are delegated to the pure engine; this
 * file only moves data in and out and keeps it idempotent.
 */
import mongoose from "mongoose";
import ShiftSession from "@/models/ShiftSession";
import ShiftEvent from "@/models/ShiftEvent";
import DeviceEnrollment from "@/models/DeviceEnrollment";
import EnrollmentCode from "@/models/EnrollmentCode";
import Driver from "@/models/Driver";
import User from "@/models/User";
import DeviceLocationState from "@/models/DeviceLocationState";
import LocationPoint from "@/models/LocationPoint";
import { companyIdIn } from "@/lib/companyIdQuery";
import {
  SHIFT_RULES,
  eligibleShiftsAt,
  getShiftDefinition,
  getShiftTimezone,
  isShiftType,
  publicShiftConfig,
  windowForStart,
  type ShiftType,
} from "@/lib/shiftConfig";
import {
  clampOccurredAt,
  computeMetrics,
  planSignalRestored,
  planSweep,
  reduceShift,
  type EngineEvent,
  type EventPayload,
  type GeoFix,
  type Interruption,
  type PlannedEvent,
} from "@/lib/shiftEngine";
import {
  CAUSE_LABELS,
  END_REASON_LABELS,
  EVENT_LABELS,
  type ShiftActor,
  type ShiftEventType,
} from "@/lib/shiftVocabulary";
import { MAX_EVENTS_PER_REQUEST, sanitizeDeviceEvent, sanitizeLocation } from "@/lib/shiftValidation";

export class ShiftError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ShiftError";
  }
}

const OPEN_STATUSES = ["ACTIVE", "INTERRUPTED"];

// --- low-level helpers ----------------------------------------------------------------------

interface SessionDoc {
  shiftId: string;
  companyId?: unknown;
  driverId?: mongoose.Types.ObjectId;
  userId?: string;
  employeeId?: string;
  driverName: string;
  deviceId: string;
  vehicle?: string;
  shiftType: ShiftType;
  scheduledStart: Date;
  scheduledEnd: Date;
  outsideSchedule?: boolean;
  status: "ACTIVE" | "INTERRUPTED" | "ENDED";
  actualStart?: Date;
  actualEnd?: Date;
  endedBy?: string;
  endReason?: string;
  endEvidence?: string;
  trackingStartedAt?: Date;
  trackingStoppedAt?: Date;
  currentCause?: string;
  currentInterruptionStart?: Date;
  connectivityLost?: boolean;
  openSilenceSince?: Date;
  interruptions?: {
    id: string;
    kind: "TRACKING" | "CONNECTIVITY";
    cause: string;
    source: string;
    startedAt: Date;
    endedAt?: Date | null;
    reason?: string;
    evidence?: string;
    closedBy?: string;
  }[];
  ignoredEventCount?: number;
  lastContactAt?: Date;
  lastLocation?: { lat: number; lng: number; accuracy?: number; recordedAt?: Date };
  lastLocationAt?: Date;
  eventCount?: number;
}

interface EventDoc {
  shiftId: string;
  eventKey: string;
  type: ShiftEventType;
  occurredAt: Date;
  reportedOccurredAt?: Date;
  receivedAt: Date;
  clockAdjusted?: boolean;
  actor: { kind: ShiftActor; userId?: string; name?: string };
  source: string;
  payload?: EventPayload;
  seq: number;
}

let seqCounter = 0;
function nextSeq(now: number): number {
  seqCounter = (seqCounter + 1) % 1000;
  return now * 1000 + seqCounter;
}

function toEngine(e: EventDoc): EngineEvent {
  return {
    key: e.eventKey,
    type: e.type,
    occurredAt: new Date(e.occurredAt).getTime(),
    seq: e.seq,
    actor: e.actor.kind,
    payload: e.payload ?? {},
  };
}

async function loadEvents(shiftId: string): Promise<EventDoc[]> {
  return (await ShiftEvent.find({ shiftId }).sort({ occurredAt: 1, seq: 1 }).lean()) as unknown as EventDoc[];
}

interface NewEvent {
  key: string;
  type: ShiftEventType;
  occurredAt: number;
  reportedOccurredAt?: number;
  clockAdjusted?: boolean;
  actor: { kind: ShiftActor; userId?: string; name?: string };
  source: "android" | "web" | "system";
  payload: EventPayload;
}

/** Idempotent insert. Returns the keys that were new and those already present. */
async function appendEvents(
  shiftId: string,
  events: NewEvent[],
  ctx: { deviceId?: string; companyId?: unknown; receivedAt: number }
): Promise<{ inserted: string[]; duplicates: string[] }> {
  const inserted: string[] = [];
  const duplicates: string[] = [];
  for (const e of events) {
    const doc = {
      shiftId,
      eventKey: e.key,
      type: e.type,
      occurredAt: new Date(e.occurredAt),
      ...(e.reportedOccurredAt !== undefined ? { reportedOccurredAt: new Date(e.reportedOccurredAt) } : {}),
      receivedAt: new Date(ctx.receivedAt),
      clockAdjusted: !!e.clockAdjusted,
      actor: e.actor,
      source: e.source,
      deviceId: ctx.deviceId,
      companyId: ctx.companyId,
      payload: e.payload,
      seq: nextSeq(ctx.receivedAt),
    };
    try {
      const res = await ShiftEvent.updateOne({ shiftId, eventKey: e.key }, { $setOnInsert: doc }, { upsert: true });
      if (res.upsertedCount === 1) inserted.push(e.key);
      else duplicates.push(e.key);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) duplicates.push(e.key);
      else throw err;
    }
  }
  return { inserted, duplicates };
}

function fromPlanned(p: PlannedEvent): NewEvent {
  return {
    key: p.key,
    type: p.type,
    occurredAt: p.occurredAt,
    actor: { kind: "system", name: "Fleet system" },
    source: "system",
    payload: p.payload,
  };
}

/**
 * Rebuild a shift's stored projection from its full event log. Safe to run any
 * number of times; the guard stops a slower, older computation from overwriting a
 * newer one when two requests race.
 */
export async function recomputeProjection(shiftId: string, now = Date.now()): Promise<SessionDoc | null> {
  const [session, events] = await Promise.all([
    ShiftSession.findOne({ shiftId }).lean() as unknown as Promise<SessionDoc | null>,
    loadEvents(shiftId),
  ]);
  if (!session) return null;

  const state = reduceShift(events.map(toEngine));
  if (!state.started || state.actualStart == null) return session;

  const metrics = computeMetrics(
    state,
    { start: new Date(session.scheduledStart).getTime(), end: new Date(session.scheduledEnd).getTime() },
    now
  );

  // Heartbeats carry fixes too; keep whichever is newest.
  let lastLocation = session.lastLocation;
  let lastLocationAt = session.lastLocationAt;
  const evLoc = state.lastLocation;
  if (evLoc && (!lastLocationAt || evLoc.at >= new Date(lastLocationAt).getTime())) {
    lastLocation = {
      lat: evLoc.lat,
      lng: evLoc.lng,
      accuracy: evLoc.accuracy,
      recordedAt: evLoc.recordedAt ? new Date(evLoc.recordedAt) : undefined,
    };
    lastLocationAt = new Date(evLoc.at);
  }

  const d = (ms: number | null) => (ms == null ? undefined : new Date(ms));
  const set: Record<string, unknown> = {
    status: state.status === "NOT_STARTED" ? "ACTIVE" : state.status,
    actualStart: d(state.actualStart),
    connectivityLost: state.connectivityLost,
    interruptionCount: state.interruptions.filter((i) => i.kind === "TRACKING").length,
    interruptions: state.interruptions.map(toStoredInterruption),
    trackingInterruptedMs: metrics.trackingInterruptedMs,
    connectivityMs: metrics.connectivityMs,
    ignoredEventCount: state.ignored.length,
    eventCount: events.length,
    projectedAt: new Date(now),
  };
  const unset: Record<string, ""> = {};
  const opt = (field: string, value: unknown) => {
    if (value === undefined || value === null) unset[field] = "";
    else set[field] = value;
  };
  opt("actualEnd", d(state.actualEnd));
  opt("endedBy", state.endedBy);
  opt("endReason", state.endReason);
  opt("endEvidence", state.endEvidence);
  opt("trackingStartedAt", d(state.trackingStartedAt));
  opt("trackingStoppedAt", d(state.trackingStoppedAt));
  opt("currentCause", state.currentCause);
  opt("currentInterruptionStart", d(state.currentInterruptionStart));
  opt("openSilenceSince", d(state.openSilenceSince));
  if (lastLocation) {
    set.lastLocation = lastLocation;
    set.lastLocationAt = lastLocationAt;
  }

  await ShiftSession.updateOne(
    { shiftId, $or: [{ eventCount: { $lte: events.length } }, { eventCount: { $exists: false } }] },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }
  );
  return (await ShiftSession.findOne({ shiftId }).lean()) as unknown as SessionDoc | null;
}

function toStoredInterruption(i: Interruption) {
  return {
    id: i.id,
    kind: i.kind,
    cause: i.cause,
    source: i.source,
    startedAt: new Date(i.startedAt),
    endedAt: i.endedAt == null ? null : new Date(i.endedAt),
    reason: i.reason,
    evidence: i.evidence,
    closedBy: i.closedBy,
  };
}

// --- identity -----------------------------------------------------------------------------

export interface DeviceIdentity {
  deviceId: string;
  companyId?: unknown;
  driverId?: mongoose.Types.ObjectId;
  userId?: string;
  employeeId?: string;
  driverName: string;
  vehicle?: string;
}

/**
 * Who is behind a device, decided by the server from the enrolment. A phone's own
 * claim about who it belongs to is never used - and an unknown or revoked device
 * gets no shift records at all.
 */
export async function resolveDeviceIdentity(deviceId: string): Promise<DeviceIdentity | null> {
  const enrollment = (await DeviceEnrollment.findOne({ deviceId, revoked: { $ne: true } })
    .sort({ createdAt: -1 })
    .lean()) as {
    employeeId?: string;
    employeeName?: string;
    companyId?: unknown;
    vehicle?: { registration?: string; id?: string };
  } | null;
  if (!enrollment) return null;

  let driverId: mongoose.Types.ObjectId | undefined;
  let userId: string | undefined;
  let name = enrollment.employeeName || "Unknown";

  if (enrollment.employeeId) {
    const code = (await EnrollmentCode.findOne({ employeeId: enrollment.employeeId, driverId: { $exists: true } })
      .sort({ updatedAt: -1 })
      .lean()) as { driverId?: mongoose.Types.ObjectId } | null;
    if (code?.driverId) {
      const driver = (await Driver.findById(code.driverId).lean()) as { _id: mongoose.Types.ObjectId; userId: mongoose.Types.ObjectId } | null;
      if (driver) {
        driverId = driver._id;
        userId = String(driver.userId);
        const user = (await User.findById(driver.userId).select("name").lean()) as { name?: string } | null;
        if (user?.name) name = user.name;
      }
    }
  }

  return {
    deviceId,
    companyId: enrollment.companyId,
    driverId,
    userId,
    employeeId: enrollment.employeeId,
    driverName: name,
    vehicle: enrollment.vehicle?.registration || enrollment.vehicle?.id,
  };
}

// --- sweep ------------------------------------------------------------------------------------

/**
 * Apply any due server-side events to one shift: a missed heartbeat, the end of the
 * schedule, an unresolved tracking failure. Deterministic keys make this safe to
 * call from the cron, from every admin page load, and from every device upload.
 */
export async function sweepSession(
  session: SessionDoc,
  now: number,
  independentContactAt?: number
): Promise<boolean> {
  if (session.status === "ENDED") return false;
  const events = await loadEvents(session.shiftId);
  const state = reduceShift(events.map(toEngine));
  if (state.actualStart == null) return false;

  // Contact can also be proven by the location uploader (which writes the device's
  // state independently of this feature); count that so a phone that is clearly
  // uploading is not flagged merely because its shift report is delayed.
  const own = session.lastContactAt ? new Date(session.lastContactAt).getTime() : state.actualStart;
  const extra = independentContactAt && independentContactAt >= state.actualStart ? independentContactAt : 0;
  const lastContactAt = Math.max(own, extra, state.actualStart);

  const planned = planSweep(state, { scheduledEnd: new Date(session.scheduledEnd).getTime(), lastContactAt, now });
  // A silence the server flagged earlier has demonstrably ended if the device has
  // been heard from since.
  if (
    !planned.some((p) => p.type === "SHIFT_ENDED") &&
    state.openSilenceSince != null &&
    lastContactAt > state.openSilenceSince &&
    now - lastContactAt < SHIFT_RULES.staleAfterMs
  ) {
    planned.push(...planSignalRestored(state, lastContactAt));
  }
  if (!planned.length) return false;

  const { inserted } = await appendEvents(session.shiftId, planned.map(fromPlanned), {
    deviceId: session.deviceId,
    companyId: session.companyId,
    receivedAt: now,
  });
  if (inserted.length) await recomputeProjection(session.shiftId, now);
  return inserted.length > 0;
}

/** Sweep every open shift (optionally one company's). */
export async function sweepOpenShifts(now = Date.now()): Promise<{ checked: number; changed: number }> {
  const open = (await ShiftSession.find({ status: { $in: OPEN_STATUSES } }).limit(1000).lean()) as unknown as SessionDoc[];
  if (!open.length) return { checked: 0, changed: 0 };

  const states = (await DeviceLocationState.find({ deviceId: { $in: open.map((s) => s.deviceId) } })
    .select("deviceId lastReceivedAt")
    .lean()) as unknown as { deviceId: string; lastReceivedAt?: Date }[];
  const received = new Map(states.map((s) => [s.deviceId, s.lastReceivedAt ? new Date(s.lastReceivedAt).getTime() : 0]));

  let changed = 0;
  for (const s of open) {
    try {
      if (await sweepSession(s, now, received.get(s.deviceId))) changed++;
    } catch (err) {
      console.error(`[shifts] sweep failed for ${s.shiftId}:`, err);
    }
  }
  return { checked: open.length, changed };
}

let lastSweepAt = 0;
/** Throttled sweep for read paths, so correctness never depends on the cron firing. */
export async function maybeSweepOpenShifts(now = Date.now()): Promise<void> {
  if (now - lastSweepAt < 60_000) return;
  lastSweepAt = now;
  try {
    await sweepOpenShifts(now);
  } catch (err) {
    console.error("[shifts] throttled sweep failed:", err);
  }
}

// --- device ingest ----------------------------------------------------------------------------

export interface DeviceBatch {
  deviceId: string;
  events?: unknown[];
  heartbeat?: { shiftId?: unknown; location?: unknown };
}

export interface ShiftDeviceView {
  shiftId: string;
  status: "ACTIVE" | "INTERRUPTED" | "ENDED";
  ended: boolean;
  endedBy?: string;
  endReason?: string;
  actualEnd?: number;
  currentCause?: string;
}

export interface IngestResult {
  accepted: string[];
  duplicates: string[];
  rejected: { key: string; reason: string }[];
  shifts: ShiftDeviceView[];
  serverTime: number;
  config: ReturnType<typeof publicShiftConfig>;
}

function deviceView(s: SessionDoc): ShiftDeviceView {
  return {
    shiftId: s.shiftId,
    status: s.status,
    ended: s.status === "ENDED",
    ...(s.endedBy ? { endedBy: s.endedBy } : {}),
    ...(s.endReason ? { endReason: s.endReason } : {}),
    ...(s.actualEnd ? { actualEnd: new Date(s.actualEnd).getTime() } : {}),
    ...(s.currentCause ? { currentCause: s.currentCause } : {}),
  };
}

async function supersedeOpenShifts(identity: DeviceIdentity, exceptShiftId: string, startedAt: number, now: number) {
  const others = (await ShiftSession.find({
    deviceId: identity.deviceId,
    status: { $in: OPEN_STATUSES },
    shiftId: { $ne: exceptShiftId },
  }).lean()) as unknown as SessionDoc[];
  for (const old of others) {
    const { inserted } = await appendEvents(
      old.shiftId,
      [
        {
          key: `sys:end:superseded:${exceptShiftId}`,
          type: "SHIFT_ENDED",
          occurredAt: startedAt,
          actor: { kind: "system", name: "Fleet system" },
          source: "system",
          payload: {
            endReason: "SUPERSEDED_BY_NEW_SHIFT",
            effectiveAt: startedAt,
            evidence: `A new shift (${exceptShiftId}) was started on the same device while this one was still open.`,
          },
        },
      ],
      { deviceId: identity.deviceId, companyId: old.companyId, receivedAt: now }
    );
    if (inserted.length) await recomputeProjection(old.shiftId, now);
  }
}

/**
 * Accept a batch of timestamped events (and an optional heartbeat) from a phone.
 *
 * Idempotent on the device's event ids, tolerant of late and out-of-order delivery
 * (state is rebuilt from the whole log), and conservative about what it believes:
 * identity comes from the enrolment, causes and end reasons are whitelisted, and a
 * timestamp from the future is clamped and flagged rather than trusted.
 */
export async function ingestDeviceBatch(batch: DeviceBatch, now = Date.now()): Promise<IngestResult> {
  const identity = await resolveDeviceIdentity(batch.deviceId);
  if (!identity) throw new ShiftError(403, "DEVICE_NOT_ENROLLED", "This device is not enrolled or has been revoked.");

  const rawEvents = Array.isArray(batch.events) ? batch.events : [];
  if (rawEvents.length > MAX_EVENTS_PER_REQUEST) {
    throw new ShiftError(413, "TOO_MANY_EVENTS", `At most ${MAX_EVENTS_PER_REQUEST} events per request.`);
  }

  const result: IngestResult = {
    accepted: [],
    duplicates: [],
    rejected: [],
    shifts: [],
    serverTime: now,
    config: publicShiftConfig(),
  };

  // Group clean events by shift, preserving the device's order for ties.
  const byShift = new Map<string, ReturnType<typeof clean>[]>();
  function clean(e: Extract<ReturnType<typeof sanitizeDeviceEvent>, { ok: true }>["event"]) {
    const clamped = clampOccurredAt(e.occurredAt, now);
    return { ...e, effectiveAt: clamped.at, clockAdjusted: clamped.adjusted };
  }
  for (const raw of rawEvents) {
    const r = sanitizeDeviceEvent(raw);
    if (!r.ok) {
      result.rejected.push({ key: r.key, reason: r.reason });
      continue;
    }
    const list = byShift.get(r.event.shiftId) ?? [];
    list.push(clean(r.event));
    byShift.set(r.event.shiftId, list);
  }

  const hb = batch.heartbeat;
  const hbShiftId = typeof hb?.shiftId === "string" ? hb.shiftId : undefined;
  if (hbShiftId && !byShift.has(hbShiftId)) byShift.set(hbShiftId, []);
  const hbLocation = sanitizeLocation(hb?.location);

  const touched: string[] = [];

  for (const [shiftId, events] of byShift) {
    events.sort((a, b) => a.effectiveAt - b.effectiveAt);

    let session = (await ShiftSession.findOne({ shiftId }).lean()) as unknown as SessionDoc | null;
    if (session && session.deviceId !== identity.deviceId) {
      for (const e of events) result.rejected.push({ key: e.key, reason: "SHIFT_BELONGS_TO_ANOTHER_DEVICE" });
      continue;
    }

    if (!session) {
      const first = events.find((e) => e.type === "SHIFT_STARTED");
      if (!first) {
        for (const e of events) result.rejected.push({ key: e.key, reason: "UNKNOWN_SHIFT" });
        continue;
      }
      const type = first.payload.shiftType;
      if (!isShiftType(type)) {
        for (const e of events) result.rejected.push({ key: e.key, reason: "INVALID_SHIFT_TYPE" });
        continue;
      }
      const { window, withinSchedule } = windowForStart(type, first.effectiveAt);
      try {
        await ShiftSession.create({
          shiftId,
          companyId: identity.companyId,
          driverId: identity.driverId,
          userId: identity.userId,
          employeeId: identity.employeeId,
          driverName: identity.driverName,
          deviceId: identity.deviceId,
          vehicle: identity.vehicle,
          shiftType: type,
          scheduledStart: new Date(window.start),
          scheduledEnd: new Date(window.end),
          outsideSchedule: !withinSchedule,
          status: "ACTIVE",
          actualStart: new Date(first.effectiveAt),
          lastContactAt: new Date(now),
          eventCount: 0,
        });
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err; // a concurrent request created it
      }
      await supersedeOpenShifts(identity, shiftId, first.effectiveAt, now);
      session = (await ShiftSession.findOne({ shiftId }).lean()) as unknown as SessionDoc | null;
      if (!session) continue;
    } else {
      // Settle anything due as of now using the previous contact time, so a silence
      // that really happened is on the record before this report explains it.
      await sweepSession(session, now);
    }

    const { inserted, duplicates } = await appendEvents(
      shiftId,
      events.map((e) => ({
        key: e.key,
        type: e.type,
        occurredAt: e.effectiveAt,
        reportedOccurredAt: e.occurredAt,
        clockAdjusted: e.clockAdjusted,
        actor: { kind: e.actor, ...(e.actor === "driver" ? { userId: identity.userId, name: identity.driverName } : {}) },
        source: "android" as const,
        payload: e.payload,
      })),
      { deviceId: identity.deviceId, companyId: identity.companyId, receivedAt: now }
    );
    result.accepted.push(...inserted);
    result.duplicates.push(...duplicates);

    // This is contact: record it, then close any silence the server had flagged.
    await ShiftSession.updateOne({ shiftId }, { $max: { lastContactAt: new Date(now) } });
    if (hbLocation && shiftId === hbShiftId) {
      const when = hbLocation.recordedAt ?? now;
      await ShiftSession.updateOne(
        { shiftId, $or: [{ lastLocationAt: { $exists: false } }, { lastLocationAt: { $lte: new Date(when) } }] },
        {
          $set: {
            lastLocation: {
              lat: hbLocation.lat,
              lng: hbLocation.lng,
              accuracy: hbLocation.accuracy,
              recordedAt: hbLocation.recordedAt ? new Date(hbLocation.recordedAt) : undefined,
            },
            lastLocationAt: new Date(when),
          },
        }
      );
    }

    const stateNow = reduceShift((await loadEvents(shiftId)).map(toEngine));
    const restored = planSignalRestored(stateNow, now);
    if (restored.length) {
      await appendEvents(shiftId, restored.map(fromPlanned), {
        deviceId: identity.deviceId,
        companyId: identity.companyId,
        receivedAt: now,
      });
    }

    const updated = await recomputeProjection(shiftId, now);
    if (updated) {
      result.shifts.push(deviceView(updated));
      touched.push(shiftId);
    }
  }

  return result;
}

// --- read models ------------------------------------------------------------------------------

export interface ShiftRow {
  shiftId: string;
  driverName: string;
  driverId?: string;
  employeeId?: string;
  deviceId: string;
  vehicle?: string;
  shiftType: ShiftType;
  shiftLabel: string;
  scheduledStart: string;
  scheduledEnd: string;
  scheduledMs: number;
  actualStart: string | null;
  actualEnd: string | null;
  /** To now while the shift is open. */
  actualMs: number;
  trackedMs: number;
  trackingInterruptedMs: number;
  connectivityMs: number;
  /** actual - scheduled. Meaningful once ended; while open it is "so far". */
  varianceMs: number;
  status: "ACTIVE" | "INTERRUPTED" | "ENDED";
  currentCause: string | null;
  currentCauseLabel: string | null;
  currentInterruptionStart: string | null;
  connectivityLost: boolean;
  interruptionCount: number;
  connectivityGapCount: number;
  trackingStartedAt: string | null;
  trackingStoppedAt: string | null;
  lastContactAt: string | null;
  /** Server has flagged the device as silent since this instant and it has not reported since. */
  silentSince: string | null;
  lastLocation: { lat: number; lng: number; accuracy?: number; recordedAt?: string } | null;
  endedBy: string | null;
  endReason: string | null;
  endReasonLabel: string | null;
  endEvidence: string | null;
  outsideSchedule: boolean;
}

const iso = (d?: Date | null) => (d ? new Date(d).toISOString() : null);

export function toShiftRow(s: SessionDoc, now: number): ShiftRow {
  const interruptions: Interruption[] = (s.interruptions ?? []).map((i) => ({
    id: i.id,
    kind: i.kind,
    cause: i.cause,
    source: i.source as Interruption["source"],
    startedAt: new Date(i.startedAt).getTime(),
    endedAt: i.endedAt ? new Date(i.endedAt).getTime() : null,
  }));
  const m = computeMetrics(
    {
      actualStart: s.actualStart ? new Date(s.actualStart).getTime() : null,
      actualEnd: s.actualEnd ? new Date(s.actualEnd).getTime() : null,
      interruptions,
    },
    { start: new Date(s.scheduledStart).getTime(), end: new Date(s.scheduledEnd).getTime() },
    now
  );
  return {
    shiftId: s.shiftId,
    driverName: s.driverName,
    driverId: s.driverId ? String(s.driverId) : undefined,
    employeeId: s.employeeId,
    deviceId: s.deviceId,
    vehicle: s.vehicle,
    shiftType: s.shiftType,
    shiftLabel: getShiftDefinition(s.shiftType).label,
    scheduledStart: new Date(s.scheduledStart).toISOString(),
    scheduledEnd: new Date(s.scheduledEnd).toISOString(),
    scheduledMs: m.scheduledMs,
    actualStart: iso(s.actualStart),
    actualEnd: iso(s.actualEnd),
    actualMs: m.actualMs,
    trackedMs: m.trackedMs,
    trackingInterruptedMs: m.trackingInterruptedMs,
    connectivityMs: m.connectivityMs,
    varianceMs: m.varianceMs,
    status: s.status,
    currentCause: s.currentCause ?? null,
    currentCauseLabel: s.currentCause ? (CAUSE_LABELS[s.currentCause] ?? s.currentCause) : null,
    currentInterruptionStart: iso(s.currentInterruptionStart),
    connectivityLost: !!s.connectivityLost,
    interruptionCount: interruptions.filter((i) => i.kind === "TRACKING").length,
    connectivityGapCount: interruptions.filter((i) => i.kind === "CONNECTIVITY").length,
    trackingStartedAt: iso(s.trackingStartedAt),
    trackingStoppedAt: iso(s.trackingStoppedAt),
    lastContactAt: iso(s.lastContactAt),
    silentSince: s.status === "ENDED" ? null : iso(s.openSilenceSince),
    lastLocation: s.lastLocation
      ? {
          lat: s.lastLocation.lat,
          lng: s.lastLocation.lng,
          accuracy: s.lastLocation.accuracy,
          recordedAt: s.lastLocation.recordedAt ? new Date(s.lastLocation.recordedAt).toISOString() : undefined,
        }
      : null,
    endedBy: s.endedBy ?? null,
    endReason: s.endReason ?? null,
    endReasonLabel: s.endReason ? (END_REASON_LABELS[s.endReason] ?? s.endReason) : null,
    endEvidence: s.endEvidence ?? null,
    outsideSchedule: !!s.outsideSchedule,
  };
}

export interface ShiftEventRow {
  key: string;
  type: ShiftEventType;
  label: string;
  occurredAt: string;
  receivedAt: string;
  /** Received well after it happened: the device was offline and reported late. */
  delayedMs: number;
  clockAdjusted: boolean;
  actor: { kind: string; name?: string };
  source: string;
  detail: string | null;
  cause: string | null;
  causeLabel: string | null;
  location: GeoFix | null;
  /** Kept in the log but not applied to the shift's state (e.g. arrived after the shift ended). */
  ignoredReason: string | null;
}

export interface InterruptionRow {
  id: string;
  kind: "TRACKING" | "CONNECTIVITY";
  cause: string;
  causeLabel: string;
  source: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  reason?: string;
  evidence?: string;
  closedBy?: string;
}

function eventRow(e: EventDoc, ignored: Map<string, string>): ShiftEventRow {
  const p = e.payload ?? {};
  const occurred = new Date(e.occurredAt).getTime();
  const received = new Date(e.receivedAt).getTime();
  const cause = p.cause ?? (e.type === "HEARTBEAT_MISSED" || e.type === "SIGNAL_RESTORED" ? "NO_SIGNAL_FROM_DEVICE" : null);
  const endReason = p.endReason;
  const detail =
    [endReason ? (END_REASON_LABELS[endReason] ?? endReason) : null, p.reason, p.evidence, p.shiftType ? `${p.shiftType} shift` : null]
      .filter(Boolean)
      .join(" - ") || null;
  return {
    key: e.eventKey,
    type: e.type,
    label: EVENT_LABELS[e.type] ?? e.type,
    occurredAt: new Date(e.occurredAt).toISOString(),
    receivedAt: new Date(e.receivedAt).toISOString(),
    delayedMs: Math.max(0, received - occurred),
    clockAdjusted: !!e.clockAdjusted,
    actor: { kind: e.actor.kind, name: e.actor.name },
    source: e.source,
    detail,
    cause,
    causeLabel: cause ? (CAUSE_LABELS[cause] ?? cause) : null,
    location: p.location ?? null,
    ignoredReason: ignored.get(e.eventKey) ?? null,
  };
}

function interruptionRows(s: SessionDoc, now: number): InterruptionRow[] {
  return (s.interruptions ?? []).map((i) => {
    const start = new Date(i.startedAt).getTime();
    const end = i.endedAt ? new Date(i.endedAt).getTime() : now;
    return {
      id: i.id,
      kind: i.kind,
      cause: i.cause,
      causeLabel: CAUSE_LABELS[i.cause] ?? i.cause,
      source: i.source,
      startedAt: new Date(i.startedAt).toISOString(),
      endedAt: i.endedAt ? new Date(i.endedAt).toISOString() : null,
      durationMs: Math.max(0, end - start),
      reason: i.reason,
      evidence: i.evidence,
      closedBy: i.closedBy,
    };
  });
}

export interface ListParams {
  view: "live" | "history";
  status?: "ACTIVE" | "INTERRUPTED" | "ENDED";
  shiftType?: ShiftType;
  search?: string;
  from?: Date;
  to?: Date;
  withInterruptions?: boolean;
  page: number;
  limit: number;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listShifts(scope: string | null, p: ListParams, now = Date.now()) {
  await maybeSweepOpenShifts(now);

  const base: Record<string, unknown> = {};
  if (scope) base.companyId = companyIdIn(scope);

  const query: Record<string, unknown> = { ...base };
  if (p.view === "live") query.status = { $in: OPEN_STATUSES };
  if (p.status) query.status = p.status;
  if (p.shiftType) query.shiftType = p.shiftType;
  if (p.search) query.driverName = { $regex: escapeRegex(p.search.trim()), $options: "i" };
  if (p.withInterruptions) query.interruptionCount = { $gt: 0 };
  if (p.from || p.to) {
    const range: Record<string, Date> = {};
    if (p.from) range.$gte = p.from;
    if (p.to) range.$lte = p.to;
    query.actualStart = range;
  }

  const limit = Math.min(Math.max(1, p.limit), 100);
  const page = Math.max(1, p.page);
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

  const [rows, total, grouped, endedRecently] = await Promise.all([
    ShiftSession.find(query)
      .sort(p.view === "live" ? { status: -1, actualStart: -1 } : { actualStart: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean() as unknown as Promise<SessionDoc[]>,
    ShiftSession.countDocuments(query),
    ShiftSession.aggregate([{ $match: { ...base, status: { $in: OPEN_STATUSES } } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    ShiftSession.countDocuments({ ...base, status: "ENDED", actualEnd: { $gte: dayAgo } }),
  ]);

  const count = (st: string) => (grouped as { _id: string; n: number }[]).find((g) => g._id === st)?.n ?? 0;
  return {
    items: rows.map((r) => toShiftRow(r, now)),
    total,
    page,
    limit,
    summary: { onShift: count("ACTIVE"), interrupted: count("INTERRUPTED"), endedLast24h: endedRecently },
    serverTime: now,
    config: publicShiftConfig(),
  };
}

export interface Viewer {
  id: string;
  name: string;
  role: string;
}

/**
 * One shift with its full timeline. Opening it is itself written to the log (once
 * per viewer per 10 minutes) so who looked at a driver's shift and location is
 * auditable - and visible to the driver in their own timeline.
 */
export async function getShiftDetail(shiftId: string, scope: string | null, viewer: Viewer | null, now = Date.now()) {
  const filter: Record<string, unknown> = { shiftId };
  if (scope) filter.companyId = companyIdIn(scope);
  let session = (await ShiftSession.findOne(filter).lean()) as unknown as SessionDoc | null;
  if (!session) throw new ShiftError(404, "NOT_FOUND", "Shift not found.");

  if (session.status !== "ENDED") {
    if (await sweepSession(session, now)) {
      session = (await ShiftSession.findOne(filter).lean()) as unknown as SessionDoc | null;
      if (!session) throw new ShiftError(404, "NOT_FOUND", "Shift not found.");
    }
  }

  if (viewer) {
    await appendEvents(
      shiftId,
      [
        {
          key: `view:${viewer.id}:${Math.floor(now / (10 * 60 * 1000))}`,
          type: "LOG_VIEWED",
          occurredAt: now,
          actor: { kind: "admin", userId: viewer.id, name: viewer.name },
          source: "web",
          payload: { reason: `Viewed by ${viewer.name} (${viewer.role})` },
        },
      ],
      { deviceId: session.deviceId, companyId: session.companyId, receivedAt: now }
    );
  }

  const events = await loadEvents(shiftId);
  const state = reduceShift(events.filter((e) => e.type !== "LOG_VIEWED").map(toEngine));
  const ignored = new Map(state.ignored.map((i) => [i.key, i.reason]));

  // The newest fix the uploader has actually stored for this shift, which can be
  // newer than anything the shift events carried.
  const start = session.actualStart ? new Date(session.actualStart) : new Date(session.scheduledStart);
  const end = session.actualEnd ? new Date(session.actualEnd) : new Date(now);
  const point = (await LocationPoint.findOne({ deviceId: session.deviceId, recordedAt: { $gte: start, $lte: end } })
    .sort({ recordedAt: -1 })
    .select("latitude longitude accuracyMeters recordedAt")
    .lean()) as { latitude: number; longitude: number; accuracyMeters?: number; recordedAt: Date } | null;

  const row = toShiftRow(session, now);
  let lastLocation = row.lastLocation;
  let lastLocationSource: "shift_report" | "uploaded_track" | null = lastLocation ? "shift_report" : null;
  if (point) {
    const pointAt = new Date(point.recordedAt).getTime();
    const known = lastLocation?.recordedAt ? new Date(lastLocation.recordedAt).getTime() : 0;
    if (pointAt >= known) {
      lastLocation = {
        lat: point.latitude,
        lng: point.longitude,
        accuracy: point.accuracyMeters,
        recordedAt: new Date(point.recordedAt).toISOString(),
      };
      lastLocationSource = "uploaded_track";
    }
  }

  return {
    shift: { ...row, lastLocation },
    lastLocationSource,
    interruptions: interruptionRows(session, now),
    events: events.map((e) => eventRow(e, ignored)),
    serverTime: now,
  };
}

/** What the signed-in driver sees about their own shifts. */
export async function getDriverShiftSummary(userId: string, now = Date.now()) {
  const open = (await ShiftSession.findOne({ userId, status: { $in: OPEN_STATUSES } })
    .sort({ actualStart: -1 })
    .lean()) as unknown as SessionDoc | null;
  const last = (await ShiftSession.findOne({ userId, status: "ENDED" })
    .sort({ actualEnd: -1 })
    .lean()) as unknown as SessionDoc | null;

  const focus = open ?? last;
  let events: ShiftEventRow[] = [];
  let interruptions: InterruptionRow[] = [];
  if (focus) {
    const docs = await loadEvents(focus.shiftId);
    const state = reduceShift(docs.filter((e) => e.type !== "LOG_VIEWED").map(toEngine));
    const ignored = new Map(state.ignored.map((i) => [i.key, i.reason]));
    events = docs.slice(-100).map((e) => eventRow(e, ignored));
    interruptions = interruptionRows(focus, now);
  }

  const eligible = eligibleShiftsAt(now).map((w) => ({
    type: w.type,
    label: w.label,
    start: new Date(w.start).toISOString(),
    end: new Date(w.end).toISOString(),
  }));

  return {
    current: open ? toShiftRow(open, now) : null,
    last: last ? toShiftRow(last, now) : null,
    interruptions,
    events,
    eligible,
    timezone: getShiftTimezone(),
    config: publicShiftConfig(),
    serverTime: now,
  };
}
