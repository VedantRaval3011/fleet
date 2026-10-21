/**
 * Read model for tracking alerts: derived from the append-only ShiftEvent log,
 * so there is no second store to keep in sync and every alert links back to the
 * shift's audit trail. Callers must `await connectToDatabase()` first.
 */
import ShiftEvent from "@/models/ShiftEvent";
import ShiftSession from "@/models/ShiftSession";
import { companyIdIn } from "@/lib/companyIdQuery";
import { maybeSweepOpenShifts, toShiftRow, type ShiftRow } from "@/lib/shiftService";
import {
  ALERT_EVENT_TYPES,
  classifyShiftEvent,
  isAlertOngoing,
  type AlertKind,
  type AlertSeverity,
} from "@/lib/trackingAlerts";
import type { ShiftEventType } from "@/lib/shiftVocabulary";
import { getShiftTimezone } from "@/lib/shiftConfig";

export interface AlertLocation {
  lat: number;
  lng: number;
  accuracy?: number;
  recordedAt?: string;
}

export interface TrackingAlertDTO {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  explanation: string;
  reason: string | null;
  occurredAt: string;
  receivedAt: string;
  /** How long after it happened the phone's report arrived (0 for server-generated events). */
  delayedMs: number;
  ongoing: boolean;
  driver: { name: string; driverId: string | null; employeeId: string | null };
  deviceId: string;
  vehicle: string | null;
  shiftId: string;
  shiftLabel: string;
  lastLocation: AlertLocation | null;
  current: {
    status: ShiftRow["status"];
    cause: string | null;
    causeLabel: string | null;
    since: string | null;
    connectivityLost: boolean;
  };
}

export interface TrackingAlertsResult {
  alerts: TrackingAlertDTO[];
  /** Everyone on shift right now, problems first. */
  live: ShiftRow[];
  counts: { onShift: number; ongoingCritical: number; ongoingWarning: number; offline: number };
  serverTime: number;
  timezone: string;
}

interface SessionLean {
  shiftId: string;
  status: ShiftRow["status"];
  currentCause?: string;
  currentInterruptionStart?: Date;
  connectivityLost?: boolean;
  openSilenceSince?: Date;
  lastLocation?: { lat: number; lng: number; accuracy?: number; recordedAt?: Date };
  [k: string]: unknown;
}

interface EventLean {
  shiftId: string;
  eventKey: string;
  type: ShiftEventType;
  occurredAt: Date;
  receivedAt: Date;
  deviceId?: string;
  source?: string;
  payload?: {
    cause?: string;
    intentional?: boolean;
    endReason?: string;
    lastAliveAt?: number;
    reason?: string;
    evidence?: string;
    location?: { lat: number; lng: number; accuracy?: number; recordedAt?: number };
  };
}

const OPEN = ["ACTIVE", "INTERRUPTED"];

/** Lower sorts first: tracking failure, then silent, then offline, then healthy. */
function problemRank(r: ShiftRow): number {
  if (r.status === "INTERRUPTED") return 0;
  if (r.silentSince) return 1;
  if (r.connectivityLost) return 2;
  return 3;
}

export async function listTrackingAlerts(
  scope: string | null,
  opts: { since?: Date; limit?: number; includeInfo?: boolean },
  now = Date.now()
): Promise<TrackingAlertsResult> {
  // Polling this endpoint is what notices a phone that has gone silent.
  await maybeSweepOpenShifts(now);

  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 200);
  const company = scope ? { companyId: companyIdIn(scope) } : {};
  const match: Record<string, unknown> = { ...company, type: { $in: ALERT_EVENT_TYPES } };
  // receivedAt, not occurredAt: an outage reported late (phone was offline) is still news.
  if (opts.since) match.receivedAt = { $gt: opts.since };

  const [events, open] = await Promise.all([
    ShiftEvent.find(match).sort({ receivedAt: -1, seq: -1 }).limit(limit * 3).lean() as unknown as Promise<EventLean[]>,
    ShiftSession.find({ ...company, status: { $in: OPEN } }).limit(500).lean() as unknown as Promise<SessionLean[]>,
  ]);

  const shiftIds = [...new Set(events.map((e) => e.shiftId))];
  const sessions = (await ShiftSession.find({ shiftId: { $in: shiftIds } }).lean()) as unknown as SessionLean[];
  const byShift = new Map(sessions.map((s) => [s.shiftId, s]));

  const alerts: TrackingAlertDTO[] = [];
  for (const e of events) {
    if (alerts.length >= limit) break;
    const cls = classifyShiftEvent(e.type, e.payload ?? {});
    if (!cls || (cls.severity === "info" && opts.includeInfo === false)) continue;
    const s = byShift.get(e.shiftId);
    if (!s) continue;
    const row = toShiftRow(s as never, now);
    const occurred = new Date(e.occurredAt).getTime();
    const loc = e.payload?.location ?? null;
    alerts.push({
      id: `${e.shiftId}:${e.eventKey}`,
      kind: cls.kind,
      severity: cls.severity,
      title: cls.title,
      explanation: cls.explanation,
      reason: e.payload?.reason ?? e.payload?.evidence ?? null,
      occurredAt: new Date(e.occurredAt).toISOString(),
      receivedAt: new Date(e.receivedAt).toISOString(),
      delayedMs: e.source === "system" ? 0 : Math.max(0, new Date(e.receivedAt).getTime() - occurred),
      ongoing: isAlertOngoing(cls, occurred, {
        status: s.status,
        currentCause: s.currentCause ?? null,
        currentInterruptionStart: s.currentInterruptionStart ? new Date(s.currentInterruptionStart).getTime() : null,
        connectivityLost: !!s.connectivityLost,
        openSilenceSince: s.openSilenceSince ? new Date(s.openSilenceSince).getTime() : null,
      }),
      driver: { name: row.driverName, driverId: row.driverId ?? null, employeeId: row.employeeId ?? null },
      deviceId: row.deviceId,
      vehicle: row.vehicle ?? null,
      shiftId: row.shiftId,
      shiftLabel: row.shiftLabel,
      lastLocation: loc
        ? {
            lat: loc.lat,
            lng: loc.lng,
            accuracy: loc.accuracy,
            recordedAt: loc.recordedAt ? new Date(loc.recordedAt).toISOString() : undefined,
          }
        : row.lastLocation,
      current: {
        status: row.status,
        cause: row.currentCause,
        causeLabel: row.currentCauseLabel,
        since: row.currentInterruptionStart,
        connectivityLost: row.connectivityLost,
      },
    });
  }

  const live = open
    .map((s) => toShiftRow(s as never, now))
    .sort((a, b) => problemRank(a) - problemRank(b) || a.driverName.localeCompare(b.driverName));

  // Counted from the live shifts, not the alert page, so old alerts beyond `limit` can't hide a problem.
  const isCritical = (r: ShiftRow) =>
    r.status === "INTERRUPTED" && (r.currentCause === "LOCATION_SERVICES_OFF" || r.currentCause === "GPS_PERMISSION_DENIED");
  return {
    alerts,
    live,
    counts: {
      onShift: live.length,
      ongoingCritical: live.filter(isCritical).length,
      ongoingWarning: live.filter((r) => !isCritical(r) && (r.status === "INTERRUPTED" || r.silentSince)).length,
      offline: live.filter((r) => r.connectivityLost).length,
    },
    serverTime: now,
    timezone: getShiftTimezone(),
  };
}
