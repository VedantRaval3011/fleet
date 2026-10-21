/**
 * Validation and sanitising of events submitted by a phone.
 *
 * The device is trusted to report what it observed (a permission was revoked, the
 * network dropped) but not to decide what the record says: it cannot submit
 * server-only event types, cannot claim a system end reason, and every free-text or
 * unknown field is bounded or dropped. Pure, relative imports only.
 */

import { isShiftType } from "./shiftConfig.ts";
import { DEVICE_EVENT_TYPES, TRACKING_CAUSES, type ShiftActor, type ShiftEventType } from "./shiftVocabulary.ts";
import type { EventPayload, GeoFix } from "./shiftEngine.ts";

export const MAX_EVENTS_PER_REQUEST = 200;
const MIN_PLAUSIBLE_TIME = Date.UTC(2020, 0, 1);

const EVENT_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const SHIFT_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** The server alone decides a silence is "no signal"; a phone cannot claim it. */
const DEVICE_CAUSES: readonly string[] = TRACKING_CAUSES.filter((c) => c !== "NO_SIGNAL_FROM_DEVICE");

/** End reasons a phone may report. The system-only reasons are never accepted from it. */
const DEVICE_END_REASONS = ["DRIVER_ENDED", "SCHEDULE_ELAPSED"] as const;

export interface CleanDeviceEvent {
  key: string;
  shiftId: string;
  type: ShiftEventType;
  occurredAt: number;
  actor: ShiftActor;
  payload: EventPayload;
}

export type SanitizeResult =
  | { ok: true; event: CleanDeviceEvent }
  | { ok: false; key: string; reason: string };

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

function finite(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function sanitizeLocation(raw: unknown): GeoFix | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const lat = finite(o.lat ?? o.latitude);
  const lng = finite(o.lng ?? o.longitude);
  if (lat === undefined || lng === undefined) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  const accuracy = finite(o.accuracy ?? o.accuracyMeters);
  const recordedAt = finite(o.recordedAt);
  return {
    lat,
    lng,
    ...(accuracy !== undefined && accuracy >= 0 ? { accuracy } : {}),
    ...(recordedAt !== undefined && recordedAt > MIN_PLAUSIBLE_TIME ? { recordedAt } : {}),
  };
}

export function sanitizeDeviceEvent(raw: unknown): SanitizeResult {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const key = typeof o.id === "string" ? o.id : typeof o.clientEventId === "string" ? o.clientEventId : "";
  const bad = (reason: string): SanitizeResult => ({ ok: false, key: key || "(missing id)", reason });

  if (!EVENT_ID.test(key)) return bad("INVALID_EVENT_ID");
  if (typeof o.shiftId !== "string" || !SHIFT_ID.test(o.shiftId)) return bad("INVALID_SHIFT_ID");
  const type = o.type as ShiftEventType;
  if (!DEVICE_EVENT_TYPES.includes(type)) return bad("EVENT_TYPE_NOT_ALLOWED_FROM_DEVICE");
  const occurredAt = finite(o.occurredAt);
  if (occurredAt === undefined || occurredAt < MIN_PLAUSIBLE_TIME) return bad("INVALID_TIMESTAMP");

  const p = (o.payload && typeof o.payload === "object" ? o.payload : {}) as Record<string, unknown>;
  const payload: EventPayload = {};
  const reason = text(p.reason, 300);
  const evidence = text(p.evidence, 500);
  if (reason) payload.reason = reason;
  if (evidence) payload.evidence = evidence;
  const location = sanitizeLocation(p.location);
  if (location) payload.location = location;

  let actor: ShiftActor = "device";

  switch (type) {
    case "SHIFT_STARTED":
      if (!isShiftType(p.shiftType)) return bad("INVALID_SHIFT_TYPE");
      payload.shiftType = p.shiftType;
      actor = "driver";
      break;

    case "SHIFT_ENDED": {
      const endReason = DEVICE_END_REASONS.find((r) => r === p.endReason) ?? "DRIVER_ENDED";
      payload.endReason = endReason;
      // Only an explicit driver action is attributed to the driver. A device-enforced
      // schedule close is the app acting, and is recorded as such.
      actor = endReason === "DRIVER_ENDED" ? "driver" : "device";
      break;
    }

    case "TRACKING_STOPPED":
      payload.intentional = p.intentional === true;
      if (typeof p.cause === "string" && DEVICE_CAUSES.includes(p.cause)) payload.cause = p.cause;
      break;

    case "TRACKING_INTERRUPTED":
      if (typeof p.cause === "string" && DEVICE_CAUSES.includes(p.cause)) payload.cause = p.cause;
      break;

    case "DEVICE_BOOTED": {
      const alive = finite(p.lastAliveAt);
      if (alive !== undefined && alive > MIN_PLAUSIBLE_TIME && alive <= occurredAt) payload.lastAliveAt = alive;
      break;
    }

    default:
      break;
  }

  return { ok: true, event: { key, shiftId: o.shiftId, type, occurredAt, actor, payload } };
}
