/**
 * The shift state machine, as pure functions over an append-only event log.
 *
 * Why it is shaped this way
 * -------------------------
 * A phone queues events while it is offline and delivers them late and possibly out
 * of order; the server also writes events (missed heartbeats, schedule end). If
 * state were mutated per event, the result would depend on arrival order. Instead
 * the shift's state is ALWAYS recomputed from the full, time-sorted event log by
 * `reduceShift`, so status, tracking status and timestamps cannot drift apart: they
 * are one function of one log. Replaying the log reproduces the state exactly,
 * which is also what makes it auditable.
 *
 * Three separate facts are kept apart, never merged:
 *   - TRACKING interruptions the device reported, with a cause (permission denied,
 *     location off, shutdown, service stopped). Evidence-based.
 *   - CONNECTIVITY gaps the device reported. Tracking continues locally during
 *     these - they are not a tracking failure.
 *   - SILENCE the server inferred from missing reports. The cause is unknown and is
 *     labelled NO_SIGNAL_FROM_DEVICE; it is explained away only where a device
 *     report later covers it.
 *
 * Relative `.ts` imports only so `node --test` can run this directly.
 */

import { SHIFT_RULES } from "./shiftConfig.ts";
import {
  CONNECTIVITY_CAUSE,
  isSoftTrackingCause,
  isTrackingCause,
  type ShiftActor,
  type ShiftEventType,
  type ShiftStatus,
} from "./shiftVocabulary.ts";

export interface GeoFix {
  lat: number;
  lng: number;
  accuracy?: number;
  /** When the device recorded the fix (ms). */
  recordedAt?: number;
}

export interface EventPayload {
  shiftType?: string;
  cause?: string;
  reason?: string;
  evidence?: string;
  intentional?: boolean;
  /** DEVICE_BOOTED: last time the device is known to have been running. */
  lastAliveAt?: number;
  /** HEARTBEAT_MISSED: when we last heard from the device. */
  silentSince?: number;
  /** SHIFT_ENDED: the instant the shift is deemed to have ended (defaults to occurredAt). */
  effectiveAt?: number;
  /** SHIFT_ENDED / TRACKING_LOST_TIMEOUT: which interruption justified closing. */
  interruptionStartedAt?: number;
  endReason?: string;
  location?: GeoFix;
}

export interface EngineEvent {
  /** Unique within the shift; the idempotency key. */
  key: string;
  type: ShiftEventType;
  /** When it happened (ms). Device events: the device's clock, clamped. */
  occurredAt: number;
  /** Receive order, to break ties deterministically. */
  seq: number;
  actor: ShiftActor;
  payload: EventPayload;
}

export interface Interruption {
  id: string;
  kind: "TRACKING" | "CONNECTIVITY";
  cause: string;
  /** device = reported by the phone; device_inferred = phone-reported evidence we drew a conclusion from; system = server inference. */
  source: "device" | "device_inferred" | "system";
  startedAt: number;
  /** null while still open. */
  endedAt: number | null;
  reason?: string;
  evidence?: string;
  closedBy?: "resumed" | "tracking_started" | "superseded" | "signal_restored" | "shift_end";
}

export interface ShiftState {
  started: boolean;
  shiftType: string | null;
  actualStart: number | null;
  actualEnd: number | null;
  endedBy: "driver" | "admin" | "system" | null;
  endReason: string | null;
  endEvidence: string | null;
  trackingStartedAt: number | null;
  /** Last time tracking stopped and had not been restarted. null while running. */
  trackingStoppedAt: number | null;
  status: ShiftStatus;
  /** Cause of the interruption in progress (null unless INTERRUPTED). */
  currentCause: string | null;
  currentInterruptionStart: number | null;
  /** The device has reported a connectivity loss that has not yet been restored. */
  connectivityLost: boolean;
  /** Start of server-inferred silence that has not yet ended (drives SIGNAL_RESTORED). */
  openSilenceSince: number | null;
  /** The open device-reported tracking failure, if any (drives the auto-end rule). */
  openDeviceInterruption: { cause: string; startedAt: number } | null;
  interruptions: Interruption[];
  lastLocation: (GeoFix & { at: number }) | null;
  /** Events kept in the log but not applied, with the reason. Never silently dropped. */
  ignored: { key: string; type: string; reason: string }[];
}

// --- interval arithmetic (end may be Infinity for "still open") -----------------------

interface Iv {
  start: number;
  end: number;
}

function normalise(ivs: Iv[]): Iv[] {
  const sorted = ivs.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Iv[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ ...iv });
  }
  return out;
}

function totalMs(ivs: Iv[]): number {
  return normalise(ivs).reduce((n, i) => n + (i.end - i.start), 0);
}

/** `a` minus the union of `b`. */
function subtract(a: Iv[], b: Iv[]): Iv[] {
  const cuts = normalise(b);
  const out: Iv[] = [];
  for (const iv of normalise(a)) {
    let cursor = iv.start;
    for (const cut of cuts) {
      if (cut.end <= cursor || cut.start >= iv.end) continue;
      if (cut.start > cursor) out.push({ start: cursor, end: cut.start });
      cursor = Math.max(cursor, cut.end);
      if (cursor >= iv.end) break;
    }
    if (cursor < iv.end) out.push({ start: cursor, end: iv.end });
  }
  return out;
}

function clip(ivs: Iv[], from: number, to: number): Iv[] {
  return ivs
    .map((i) => ({ start: Math.max(i.start, from), end: Math.min(i.end, to) }))
    .filter((i) => i.end > i.start);
}

// --- reducer ----------------------------------------------------------------------------

interface Raw {
  cause: string;
  source: Interruption["source"];
  start: number;
  end: number; // Infinity = open
  reason?: string;
  evidence?: string;
  closedBy?: Interruption["closedBy"];
}

const MIN_RESIDUAL_SILENCE_MS = 60_000;

export function reduceShift(events: EngineEvent[], rules = SHIFT_RULES): ShiftState {
  const sorted = [...events].sort(
    (a, b) => a.occurredAt - b.occurredAt || a.seq - b.seq || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );

  const st: ShiftState = {
    started: false,
    shiftType: null,
    actualStart: null,
    actualEnd: null,
    endedBy: null,
    endReason: null,
    endEvidence: null,
    trackingStartedAt: null,
    trackingStoppedAt: null,
    status: "NOT_STARTED",
    currentCause: null,
    currentInterruptionStart: null,
    connectivityLost: false,
    openSilenceSince: null,
    openDeviceInterruption: null,
    interruptions: [],
    lastLocation: null,
    ignored: [],
  };

  const tracking: Raw[] = [];
  const connectivity: Raw[] = [];
  const silence: Raw[] = [];
  let openT: Raw | null = null;
  let openC: Raw | null = null;
  let openS: Raw | null = null;
  let ended = false;

  const noteLocation = (loc: GeoFix | undefined, at: number) => {
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return;
    const when = loc.recordedAt ?? at;
    if (!st.lastLocation || when >= st.lastLocation.at) st.lastLocation = { ...loc, at: when };
  };

  const openInterruption = (
    cause: string,
    source: Raw["source"],
    at: number,
    p: EventPayload
  ) => {
    if (openT && openT.cause === cause) return; // duplicate report of the same condition
    if (openT) {
      openT.end = at;
      openT.closedBy = "superseded";
    }
    openT = { cause, source, start: at, end: Infinity, reason: p.reason, evidence: p.evidence };
    tracking.push(openT);
  };

  const closeTracking = (at: number, by: Interruption["closedBy"]) => {
    if (!openT) return;
    openT.end = at;
    openT.closedBy = by;
    openT = null;
  };

  for (const e of sorted) {
    const p = e.payload ?? {};
    if (e.type === "LOG_VIEWED") continue; // access audit only; never affects state

    if (!st.started && e.type !== "SHIFT_STARTED") {
      st.ignored.push({ key: e.key, type: e.type, reason: "BEFORE_SHIFT_START" });
      continue;
    }
    if (ended) {
      st.ignored.push({ key: e.key, type: e.type, reason: "AFTER_SHIFT_END" });
      continue;
    }

    switch (e.type) {
      case "SHIFT_STARTED":
        if (st.started) {
          st.ignored.push({ key: e.key, type: e.type, reason: "DUPLICATE_START" });
          break;
        }
        st.started = true;
        st.actualStart = e.occurredAt;
        st.shiftType = p.shiftType ?? null;
        noteLocation(p.location, e.occurredAt);
        break;

      case "SHIFT_ENDED": {
        // A system close because of an unresolved tracking failure is only valid if
        // that same failure is still unresolved at this point in the log. A late
        // "resumed" report from the device cancels it - the shift was never lost.
        if (p.endReason === "TRACKING_LOST_TIMEOUT") {
          const since = p.interruptionStartedAt;
          const dev = openT as Raw | null;
          if (!dev || dev.start !== since) {
            st.ignored.push({ key: e.key, type: e.type, reason: "SUPERSEDED_BY_LATER_REPORT" });
            break;
          }
        }
        const effective = Math.min(
          e.occurredAt,
          Math.max(st.actualStart ?? 0, typeof p.effectiveAt === "number" ? p.effectiveAt : e.occurredAt)
        );
        ended = true;
        st.actualEnd = effective;
        // Only an explicit driver action is the driver's doing. Anything the app or the
        // server did on its own ("device", "system") must not be passed off as one.
        st.endedBy = e.actor === "driver" ? "driver" : e.actor === "admin" ? "admin" : "system";
        st.endReason = p.endReason ?? (st.endedBy === "driver" ? "DRIVER_ENDED" : "UNSPECIFIED");
        st.endEvidence = p.evidence ?? p.reason ?? null;
        noteLocation(p.location, e.occurredAt);
        // Anything still open is closed when the shift is closed - the log shows how
        // long the failure ran even if the shift's own end time is earlier.
        for (const r of [openT, openC, openS] as (Raw | null)[]) {
          if (r) {
            r.end = e.occurredAt;
            r.closedBy = "shift_end";
          }
        }
        openT = openC = openS = null;
        break;
      }

      case "TRACKING_STARTED":
        if (st.trackingStartedAt == null) st.trackingStartedAt = e.occurredAt;
        st.trackingStoppedAt = null;
        closeTracking(e.occurredAt, "tracking_started");
        noteLocation(p.location, e.occurredAt);
        break;

      case "TRACKING_STOPPED":
        st.trackingStoppedAt = e.occurredAt;
        noteLocation(p.location, e.occurredAt);
        // An intentional stop accompanies the driver ending the shift. Anything else
        // is a tracking failure - never to be read as the driver's choice.
        if (p.intentional !== true) {
          openInterruption(
            isTrackingCause(p.cause) ? p.cause : "TRACKING_SERVICE_STOPPED",
            "device",
            e.occurredAt,
            p
          );
        }
        break;

      case "TRACKING_INTERRUPTED":
        noteLocation(p.location, e.occurredAt);
        openInterruption(isTrackingCause(p.cause) ? p.cause : "UNKNOWN", "device", e.occurredAt, p);
        break;

      case "TRACKING_RESUMED":
        st.trackingStoppedAt = null;
        closeTracking(e.occurredAt, "resumed");
        noteLocation(p.location, e.occurredAt);
        break;

      case "CONNECTIVITY_LOST":
        if (!openC) {
          openC = { cause: CONNECTIVITY_CAUSE, source: "device", start: e.occurredAt, end: Infinity, reason: p.reason };
          connectivity.push(openC);
        }
        break;

      case "CONNECTIVITY_RESTORED":
        if (openC) {
          openC.end = e.occurredAt;
          openC.closedBy = "resumed";
          openC = null;
        }
        noteLocation(p.location, e.occurredAt);
        break;

      case "DEVICE_BOOTED": {
        // A restart is evidence the device was off. The gap is only attributed to a
        // shutdown when the device told us when it was last running; without that
        // we would be guessing, so nothing is invented.
        const alive = p.lastAliveAt;
        const from = typeof alive === "number" ? Math.max(alive, st.actualStart ?? 0) : null;
        if (from != null && from < e.occurredAt && !openT) {
          tracking.push({
            cause: "DEVICE_SHUTDOWN",
            source: "device_inferred",
            start: from,
            end: e.occurredAt,
            reason: p.reason,
            evidence:
              p.evidence ?? "Device restarted; it reported its last activity before the restart.",
            closedBy: "resumed",
          });
        }
        break;
      }

      case "HEARTBEAT_MISSED":
        if (!openS) {
          const since = typeof p.silentSince === "number" ? p.silentSince : e.occurredAt;
          openS = { cause: "NO_SIGNAL_FROM_DEVICE", source: "system", start: Math.min(since, e.occurredAt), end: Infinity };
          silence.push(openS);
        }
        break;

      case "SIGNAL_RESTORED":
        if (openS) {
          openS.end = e.occurredAt;
          openS.closedBy = "signal_restored";
          openS = null;
        }
        break;

      default:
        st.ignored.push({ key: e.key, type: e.type, reason: "UNKNOWN_TYPE" });
    }
  }

  // Server-inferred silence is only "unexplained" where no device report covers it.
  // The tolerance exists because the last heartbeat precedes the outage it describes,
  // so a silence starts a little before the report that explains it. It is therefore
  // applied only to a report that actually overlaps that silence: a silence that
  // already ended in real contact must not have its tail absorbed by an unrelated
  // report that happens to begin shortly afterwards.
  const tol = rules.attributionToleranceMs;
  const explainers = [...tracking, ...connectivity];
  const residualSilence: Iv[] = [];
  for (const s of silence) {
    const covering: Iv[] = explainers
      .filter((r) => r.start < s.end && r.end > s.start)
      .map((r) => ({ start: r.start - tol, end: r.end === Infinity ? Infinity : r.end + tol }));
    residualSilence.push(...subtract([{ start: s.start, end: s.end }], covering));
  }
  residualSilence.sort((a, b) => a.start - b.start);
  for (let i = residualSilence.length - 1; i >= 0; i--) {
    const r = residualSilence[i];
    if (r.end !== Infinity && r.end - r.start < MIN_RESIDUAL_SILENCE_MS) residualSilence.splice(i, 1);
  }

  const list: Interruption[] = [];
  const push = (r: Raw, kind: Interruption["kind"]) =>
    list.push({
      id: `${kind === "TRACKING" ? "T" : "C"}-${r.start}`,
      kind,
      cause: r.cause,
      source: r.source,
      startedAt: r.start,
      endedAt: r.end === Infinity ? null : r.end,
      reason: r.reason,
      evidence: r.evidence,
      closedBy: r.closedBy,
    });
  tracking.forEach((r) => push(r, "TRACKING"));
  connectivity.forEach((r) => push(r, "CONNECTIVITY"));
  for (const iv of residualSilence) {
    push(
      {
        cause: "NO_SIGNAL_FROM_DEVICE",
        source: "system",
        start: iv.start,
        end: iv.end,
        evidence:
          "No report was received from the device. The cause is not known and has not been assumed.",
        closedBy: iv.end === Infinity ? undefined : ended ? "shift_end" : "signal_restored",
      },
      "TRACKING"
    );
  }
  list.sort((a, b) => a.startedAt - b.startedAt || a.kind.localeCompare(b.kind));
  st.interruptions = list;

  const stillOpenT = openT as Raw | null;
  const openResidual = residualSilence.find((i) => i.end === Infinity);
  st.connectivityLost = !!openC;
  st.openSilenceSince = (openS as Raw | null)?.start ?? null;
  st.openDeviceInterruption = stillOpenT ? { cause: stillOpenT.cause, startedAt: stillOpenT.start } : null;

  if (!st.started) st.status = "NOT_STARTED";
  else if (ended) st.status = "ENDED";
  else if (stillOpenT) {
    st.status = "INTERRUPTED";
    st.currentCause = stillOpenT.cause;
    st.currentInterruptionStart = stillOpenT.start;
  } else if (openResidual) {
    st.status = "INTERRUPTED";
    st.currentCause = "NO_SIGNAL_FROM_DEVICE";
    st.currentInterruptionStart = openResidual.start;
  } else st.status = "ACTIVE";

  return st;
}

// --- derived figures --------------------------------------------------------------------

export interface ShiftMetrics {
  scheduledMs: number;
  /** Start to end (or to `now` while open). */
  actualMs: number;
  /** Time inside the shift with tracking not working (device-reported failures + unexplained silence). */
  trackingInterruptedMs: number;
  /** Time the phone was offline but still tracking. Not a tracking failure. */
  connectivityMs: number;
  /** actualMs minus trackingInterruptedMs. */
  trackedMs: number;
  /** actualMs - scheduledMs. */
  varianceMs: number;
}

export function computeMetrics(
  state: Pick<ShiftState, "actualStart" | "actualEnd" | "interruptions">,
  schedule: { start: number; end: number },
  now: number
): ShiftMetrics {
  const scheduledMs = Math.max(0, schedule.end - schedule.start);
  if (state.actualStart == null) {
    return { scheduledMs, actualMs: 0, trackingInterruptedMs: 0, connectivityMs: 0, trackedMs: 0, varianceMs: -scheduledMs };
  }
  const from = state.actualStart;
  const to = state.actualEnd ?? now;
  const toIv = (i: Interruption): Iv => ({ start: i.startedAt, end: i.endedAt ?? Infinity });
  const trackingIvs = state.interruptions.filter((i) => i.kind === "TRACKING").map(toIv);
  const connIvs = state.interruptions.filter((i) => i.kind === "CONNECTIVITY").map(toIv);

  const interrupted = totalMs(clip(trackingIvs, from, to));
  const connectivity = totalMs(clip(subtract(connIvs, trackingIvs), from, to));
  const actualMs = Math.max(0, to - from);
  return {
    scheduledMs,
    actualMs,
    trackingInterruptedMs: interrupted,
    connectivityMs: connectivity,
    trackedMs: Math.max(0, actualMs - interrupted),
    varianceMs: actualMs - scheduledMs,
  };
}

// --- planners: server-generated events ---------------------------------------------------

export interface PlannedEvent {
  key: string;
  type: ShiftEventType;
  occurredAt: number;
  actor: "system";
  payload: EventPayload;
}

/**
 * Which system events are due for this shift as of `now`. Pure and deterministic:
 * keys and timestamps derive from the shift's own data, never from `now`, so running
 * the sweep twice (cron + a page load) writes each event once.
 */
export function planSweep(
  state: ShiftState,
  input: { scheduledEnd: number; lastContactAt: number; now: number },
  rules = SHIFT_RULES
): PlannedEvent[] {
  if (state.status === "ENDED" || state.status === "NOT_STARTED" || state.actualStart == null) return [];
  const { now, lastContactAt, scheduledEnd } = input;

  const endCandidates: PlannedEvent[] = [];

  const hardEnd = Math.max(scheduledEnd + rules.endGraceMs, state.actualStart);
  if (now >= hardEnd) {
    endCandidates.push({
      key: "sys:end:schedule",
      type: "SHIFT_ENDED",
      occurredAt: hardEnd,
      actor: "system",
      payload: {
        endReason: "SCHEDULE_ELAPSED",
        effectiveAt: hardEnd,
        evidence: "The scheduled end plus grace period was reached while the shift was still open.",
      },
    });
  }

  const dev = state.openDeviceInterruption;
  // A lost GPS signal is not a failure anyone chose; it never closes the shift.
  const hardDev = dev && !isSoftTrackingCause(dev.cause) ? dev : null;
  if (hardDev && now - hardDev.startedAt >= rules.autoEndAfterInterruptionMs) {
    endCandidates.push({
      key: `sys:end:lost:${hardDev.startedAt}`,
      type: "SHIFT_ENDED",
      occurredAt: hardDev.startedAt + rules.autoEndAfterInterruptionMs,
      actor: "system",
      payload: {
        endReason: "TRACKING_LOST_TIMEOUT",
        // Tracking last worked when the failure began; that is when the shift
        // effectively stopped being tracked.
        effectiveAt: hardDev.startedAt,
        interruptionStartedAt: hardDev.startedAt,
        cause: hardDev.cause,
        evidence: `A device-reported tracking failure (${hardDev.cause}) was not resolved within ${Math.round(
          rules.autoEndAfterInterruptionMs / 60_000
        )} minutes.`,
      },
    });
  }
  endCandidates.sort((a, b) => a.occurredAt - b.occurredAt);
  const end = endCandidates[0];

  const out: PlannedEvent[] = [];
  const staleAt = lastContactAt + rules.staleAfterMs;
  // A no-fix report says the phone is alive but blind; it does not explain the phone going quiet.
  if (!hardDev && state.openSilenceSince == null && now >= staleAt && lastContactAt >= state.actualStart) {
    if (!end || staleAt < end.occurredAt) {
      out.push({
        key: `sys:missed:${lastContactAt}`,
        type: "HEARTBEAT_MISSED",
        occurredAt: staleAt,
        actor: "system",
        payload: { silentSince: lastContactAt },
      });
    }
  }
  if (end) out.push(end);
  return out;
}

/** When the device speaks again after a silence the server had flagged. */
export function planSignalRestored(state: ShiftState, now: number): PlannedEvent[] {
  if (state.status === "ENDED" || state.openSilenceSince == null) return [];
  return [
    {
      key: `sys:restored:${state.openSilenceSince}`,
      type: "SIGNAL_RESTORED",
      occurredAt: now,
      actor: "system",
      payload: { silentSince: state.openSilenceSince },
    },
  ];
}

/**
 * Device clocks drift and can be set wrong. A timestamp from the future cannot be
 * true, so it is clamped to the moment we received it and flagged; everything else
 * is trusted as reported (an offline device legitimately reports the past).
 */
export function clampOccurredAt(
  reported: number,
  receivedAt: number,
  tolerance = SHIFT_RULES.clockSkewToleranceMs
): { at: number; adjusted: boolean } {
  if (!Number.isFinite(reported)) return { at: receivedAt, adjusted: true };
  if (reported > receivedAt + tolerance) return { at: receivedAt, adjusted: true };
  return { at: reported, adjusted: false };
}
