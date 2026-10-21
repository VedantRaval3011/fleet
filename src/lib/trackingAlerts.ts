/**
 * Which shift events HR/admin are alerted about, and in what words.
 *
 * Each alert names exactly what the evidence supports, so the dashboard never
 * reports every gap as "GPS turned off":
 *   - Location switched off and permission revoked are reported by the phone
 *     itself, separately.
 *   - "Location updates interrupted" means Location and permission are fine but
 *     no fix is arriving (weak signal) or the tracking service stopped.
 *   - "Device not reporting" is the server noticing silence; the cause is unknown.
 *   - "Network lost" is informational: the phone keeps recording offline.
 *
 * Pure and dependency-free (relative imports) so it is unit-tested directly.
 */
import { CAUSE_HELP, type ShiftEventType } from "./shiftVocabulary.ts";

export type AlertSeverity = "critical" | "warning" | "info" | "recovery";

export type AlertKind =
  | "LOCATION_SERVICES_DISABLED"
  | "LOCATION_PERMISSION_REVOKED"
  | "LOCATION_UPDATES_INTERRUPTED"
  | "TRACKING_SERVICE_STOPPED"
  | "TRACKING_STOPPED_UNKNOWN"
  | "DEVICE_RESTARTED"
  | "DEVICE_NOT_REPORTING"
  | "NETWORK_LOST"
  | "SHIFT_AUTO_ENDED"
  | "TRACKING_RESUMED"
  | "DEVICE_REPORTING_AGAIN"
  | "NETWORK_RESTORED";

export interface AlertClass {
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  explanation: string;
  /** Tracking cause this alert is about, for matching against the shift's current state. */
  cause: string | null;
}

/** Event types that can produce an alert; used to narrow the database query. */
export const ALERT_EVENT_TYPES: readonly ShiftEventType[] = [
  "TRACKING_INTERRUPTED",
  "TRACKING_STOPPED",
  "TRACKING_RESUMED",
  "HEARTBEAT_MISSED",
  "SIGNAL_RESTORED",
  "CONNECTIVITY_LOST",
  "CONNECTIVITY_RESTORED",
  "DEVICE_BOOTED",
  "SHIFT_ENDED",
];

export const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  LOCATION_SERVICES_DISABLED: "Location Services Disabled",
  LOCATION_PERMISSION_REVOKED: "Location Permission Revoked",
  LOCATION_UPDATES_INTERRUPTED: "Location Updates Interrupted",
  TRACKING_SERVICE_STOPPED: "Tracking Service Stopped",
  TRACKING_STOPPED_UNKNOWN: "Tracking Stopped",
  DEVICE_RESTARTED: "Device Restarted",
  DEVICE_NOT_REPORTING: "Device Not Reporting",
  NETWORK_LOST: "Network Connectivity Lost",
  SHIFT_AUTO_ENDED: "Shift Auto-Ended",
  TRACKING_RESUMED: "Tracking Resumed",
  DEVICE_REPORTING_AGAIN: "Device Reporting Again",
  NETWORK_RESTORED: "Network Restored",
};

function byCause(cause: string | undefined): AlertClass {
  switch (cause) {
    case "LOCATION_SERVICES_OFF":
      return {
        kind: "LOCATION_SERVICES_DISABLED",
        severity: "critical",
        title: ALERT_KIND_LABELS.LOCATION_SERVICES_DISABLED,
        explanation: "The phone reported that its Location (GPS) switch was turned off during the shift. No route is being recorded.",
        cause,
      };
    case "GPS_PERMISSION_DENIED":
      return {
        kind: "LOCATION_PERMISSION_REVOKED",
        severity: "critical",
        title: ALERT_KIND_LABELS.LOCATION_PERMISSION_REVOKED,
        explanation: "The phone reported that the Fleet app's location permission is off, although Location itself may still be on.",
        cause,
      };
    case "NO_LOCATION_FIX":
      return {
        kind: "LOCATION_UPDATES_INTERRUPTED",
        severity: "warning",
        title: ALERT_KIND_LABELS.LOCATION_UPDATES_INTERRUPTED,
        explanation: CAUSE_HELP.NO_LOCATION_FIX,
        cause,
      };
    case "TRACKING_SERVICE_STOPPED":
      return {
        kind: "TRACKING_SERVICE_STOPPED",
        severity: "warning",
        title: ALERT_KIND_LABELS.TRACKING_SERVICE_STOPPED,
        explanation:
          "Location is on, but the app's tracking service stopped (killed by the phone, provider failure, or app restart). The app tries to restart it automatically.",
        cause,
      };
    default:
      return {
        kind: "TRACKING_STOPPED_UNKNOWN",
        severity: "warning",
        title: ALERT_KIND_LABELS.TRACKING_STOPPED_UNKNOWN,
        explanation: "Tracking stopped during the shift and the phone did not report why.",
        cause: cause ?? "UNKNOWN",
      };
  }
}

export function classifyShiftEvent(
  type: ShiftEventType,
  payload: { cause?: string; intentional?: boolean; endReason?: string; lastAliveAt?: number } = {}
): AlertClass | null {
  switch (type) {
    case "TRACKING_INTERRUPTED":
      return byCause(payload.cause);
    case "TRACKING_STOPPED":
      // Stopping because the driver ended the shift is not an alert.
      return payload.intentional === true ? null : byCause(payload.cause ?? "TRACKING_SERVICE_STOPPED");
    case "HEARTBEAT_MISSED":
      return {
        kind: "DEVICE_NOT_REPORTING",
        severity: "warning",
        title: ALERT_KIND_LABELS.DEVICE_NOT_REPORTING,
        explanation:
          "The server has stopped hearing from the phone. No internet, a dead battery and a stopped app look the same from here; the phone keeps recording if it can and reports the real cause when it reconnects.",
        cause: "NO_SIGNAL_FROM_DEVICE",
      };
    case "CONNECTIVITY_LOST":
      return {
        kind: "NETWORK_LOST",
        severity: "info",
        title: ALERT_KIND_LABELS.NETWORK_LOST,
        explanation: "The phone lost its internet connection. GPS tracking continues on the phone and uploads when it reconnects.",
        cause: "INTERNET_DISCONNECTED",
      };
    case "DEVICE_BOOTED":
      return {
        kind: "DEVICE_RESTARTED",
        severity: "warning",
        title: ALERT_KIND_LABELS.DEVICE_RESTARTED,
        explanation:
          typeof payload.lastAliveAt === "number"
            ? "The phone restarted during the shift. Tracking was not possible between the time it was last running and the restart."
            : "The phone restarted during the shift.",
        cause: "DEVICE_SHUTDOWN",
      };
    case "SHIFT_ENDED":
      if (payload.endReason !== "TRACKING_LOST_TIMEOUT") return null;
      return {
        kind: "SHIFT_AUTO_ENDED",
        severity: "critical",
        title: ALERT_KIND_LABELS.SHIFT_AUTO_ENDED,
        explanation: "A tracking failure reported by the phone was not fixed in time, so the system closed the shift.",
        cause: payload.cause ?? null,
      };
    case "TRACKING_RESUMED":
      return {
        kind: "TRACKING_RESUMED",
        severity: "recovery",
        title: ALERT_KIND_LABELS.TRACKING_RESUMED,
        explanation: "Location tracking is working again.",
        cause: null,
      };
    case "SIGNAL_RESTORED":
      return {
        kind: "DEVICE_REPORTING_AGAIN",
        severity: "recovery",
        title: ALERT_KIND_LABELS.DEVICE_REPORTING_AGAIN,
        explanation: "The server is hearing from the phone again.",
        cause: null,
      };
    case "CONNECTIVITY_RESTORED":
      return {
        kind: "NETWORK_RESTORED",
        severity: "recovery",
        title: ALERT_KIND_LABELS.NETWORK_RESTORED,
        explanation: "The phone is back online and uploading.",
        cause: null,
      };
    default:
      return null;
  }
}

/** Snapshot of the shift used to decide whether a problem alert is still going on. */
export interface ShiftNow {
  status: "ACTIVE" | "INTERRUPTED" | "ENDED";
  currentCause?: string | null;
  currentInterruptionStart?: number | null;
  connectivityLost?: boolean;
  openSilenceSince?: number | null;
}

/** True while the condition an alert reported is still the shift's current state. */
export function isAlertOngoing(alert: AlertClass, occurredAt: number, now: ShiftNow): boolean {
  if (alert.severity === "recovery" || now.status === "ENDED") return false;
  switch (alert.kind) {
    case "NETWORK_LOST":
      return !!now.connectivityLost;
    case "DEVICE_NOT_REPORTING":
      return now.openSilenceSince != null;
    case "DEVICE_RESTARTED":
    case "SHIFT_AUTO_ENDED":
      return false;
    default:
      return (
        now.status === "INTERRUPTED" &&
        now.currentCause === alert.cause &&
        (now.currentInterruptionStart == null || now.currentInterruptionStart <= occurredAt)
      );
  }
}
