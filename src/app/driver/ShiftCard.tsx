"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, Clock, ShieldCheck, Smartphone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ShiftStatusBadge } from "@/components/shifts/ShiftStatusBadge";
import { formatAgo, formatDateTimeSec, formatDurationMs, formatScheduleRange } from "@/lib/shiftFormat";
import type { getDriverShiftSummary } from "@/lib/shiftService";

type Summary = Awaited<ReturnType<typeof getDriverShiftSummary>>;

const REFRESH_MS = 30_000;

/** What the driver should DO about each failure - in plain words, not codes. */
const DRIVER_ADVICE: Record<string, string> = {
  GPS_PERMISSION_DENIED:
    "Location permission for the Fleet app is off. Open your phone's Settings, allow location for the app, and your shift will resume tracking.",
  LOCATION_SERVICES_OFF: "Your phone's Location (GPS) is switched off. Turn it back on to resume tracking.",
  DEVICE_SHUTDOWN: "Your phone was switched off or restarted. Open the Fleet app so tracking can resume.",
  TRACKING_SERVICE_STOPPED: "Tracking stopped unexpectedly. Open the Fleet app so it can restart.",
  NO_LOCATION_FIX:
    "Your phone cannot get a GPS fix right now (tunnel, basement or weak signal). Location is on, so this clears by itself once the phone can see the sky.",
  NO_SIGNAL_FROM_DEVICE:
    "We have not heard from your phone recently. Check that it has internet and that the Fleet app is running. If your phone was only offline, nothing is lost: it keeps recording and catches up when it reconnects.",
  UNKNOWN: "Tracking stopped. Open the Fleet app to resume.",
};

export function ShiftCard() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/driver/me/shift", { cache: "no-store" })
        .then(async (r) => {
          if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `Request failed (${r.status})`);
          return r.json() as Promise<Summary>;
        })
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setError("");
        })
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load shift."));
    load();
    const poll = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  if (error && !data) {
    return (
      <Card className="border-slate-800 bg-slate-900">
        <CardContent className="p-4 text-sm text-slate-400">Shift status is unavailable right now.</CardContent>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card className="border-slate-800 bg-slate-900">
        <CardContent className="p-4 text-sm text-slate-500">Loading shift...</CardContent>
      </Card>
    );
  }

  const tz = data.timezone;
  const cur = data.current;
  const last = data.last;
  const interrupted = cur?.status === "INTERRUPTED";

  return (
    <Card className={`border ${interrupted ? "border-rose-500/50 bg-rose-950/40" : cur ? "border-emerald-500/30 bg-slate-900" : "border-slate-800 bg-slate-900"}`}>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
            <Clock className="h-4 w-4" /> My shift
          </h2>
          {cur ? (
            <ShiftStatusBadge
              status={cur.status}
              currentCause={cur.currentCause}
              currentCauseLabel={cur.currentCauseLabel}
              connectivityLost={cur.connectivityLost}
            />
          ) : (
            <span className="rounded-full border border-slate-600/50 bg-slate-700/30 px-2 py-0.5 text-xs text-slate-300">Off shift</span>
          )}
        </div>

        {cur ? (
          <>
            <div>
              <p className="text-lg font-bold text-white">{cur.shiftLabel}</p>
              <p className="text-sm text-slate-400">Scheduled {formatScheduleRange(cur.scheduledStart, cur.scheduledEnd, tz)}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Started</p>
                <p className="text-sm font-semibold text-slate-100">{formatDateTimeSec(cur.actualStart)}</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Duration</p>
                <p className="font-mono text-sm font-bold text-slate-100">
                  {formatDurationMs(cur.actualStart ? now - new Date(cur.actualStart).getTime() : 0)}
                  <span className="font-sans font-normal text-slate-500"> / {formatDurationMs(cur.scheduledMs)}</span>
                </p>
              </div>
            </div>
            {interrupted && (
              <div className="flex gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">{cur.currentCauseLabel}</p>
                  {cur.currentInterruptionStart && (
                    <p className="text-xs text-rose-200/80">Since {formatAgo(cur.currentInterruptionStart, now)}</p>
                  )}
                  <p className="mt-1 text-xs text-rose-200/90">{DRIVER_ADVICE[cur.currentCause ?? "UNKNOWN"] ?? DRIVER_ADVICE.UNKNOWN}</p>
                </div>
              </div>
            )}
            {cur.trackingInterruptedMs > 0 && !interrupted && (
              <p className="text-xs text-slate-400">
                Tracking was interrupted for {formatDurationMs(cur.trackingInterruptedMs)} earlier in this shift.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="flex gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">
              <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
              <p>
                Start and end your shift with the <span className="font-semibold">Shift On / Shift Off</span> button in the Fleet
                app on your phone. Location tracking starts when you switch on and stops the moment you switch off.
              </p>
            </div>
            {last && (
              <div className="text-sm text-slate-400">
                <p>
                  Last shift: <span className="text-slate-200">{last.shiftLabel}</span>, {formatDateTimeSec(last.actualStart)} to{" "}
                  {formatDateTimeSec(last.actualEnd)} ({formatDurationMs(last.actualMs)})
                </p>
                {last.endReasonLabel && <p className="text-xs text-slate-500">{last.endReasonLabel}</p>}
              </div>
            )}
            <ul className="space-y-1 text-xs text-slate-500">
              {data.config.shifts.map((s) => {
                const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
                return (
                  <li key={s.type}>
                    {s.label}: {fmt(s.startMinute)} - {fmt(s.endMinute)}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {data.events.length > 0 && (
          <div>
            <button
              onClick={() => setShowLog((v) => !v)}
              className="flex w-full items-center justify-between text-xs font-medium text-indigo-300 hover:text-indigo-200"
            >
              {showLog ? "Hide" : "Show"} my shift log ({data.events.length})
              <ChevronDown className={`h-4 w-4 transition-transform ${showLog ? "rotate-180" : ""}`} />
            </button>
            {showLog && (
              <ol className="mt-2 max-h-64 space-y-2 overflow-y-auto border-l border-slate-700 pl-3">
                {[...data.events].reverse().map((e) => (
                  <li key={e.key} className="text-xs">
                    <p className="text-slate-200">
                      {e.label}
                      {e.causeLabel && <span className="text-slate-400"> - {e.causeLabel}</span>}
                    </p>
                    <p className="text-slate-500">
                      {formatDateTimeSec(e.occurredAt)}
                      {e.type === "LOG_VIEWED" && e.detail ? ` - ${e.detail}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        <p className="flex items-start gap-2 text-[11px] leading-snug text-slate-500">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Your location is recorded only while your shift is on, and is visible only to HR and authorised administrators. Every time
          someone opens your shift log, it is recorded above.
        </p>
      </CardContent>
    </Card>
  );
}
