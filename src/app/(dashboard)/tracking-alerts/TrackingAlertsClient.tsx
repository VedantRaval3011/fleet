"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertOctagon, AlertTriangle, Loader2, MapPin, RadioTower, RefreshCw, Users, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "../income-expense/apiClient";
import { ShiftStatusBadge } from "@/components/shifts/ShiftStatusBadge";
import { OngoingChip, SEVERITY_STYLE, SeverityIcon } from "@/components/shifts/trackingAlertUi";
import { ShiftDetailDialog } from "../shifts/ShiftDetailDialog";
import { formatAgo, formatCoords, formatDateTimeSec, formatDurationMs, mapsUrl } from "@/lib/shiftFormat";
import type { AlertLocation, TrackingAlertsResult } from "@/lib/trackingAlertService";
import type { AlertSeverity } from "@/lib/trackingAlerts";
import { cn } from "@/lib/utils";

const REFRESH_MS = 20_000;
/** Phones upload on a ~5 minute heartbeat; a report later than this was buffered while offline. */
const LATE_MS = 7 * 60_000;

type Filter = "problems" | "all" | "critical" | "recovery";
const FILTERS: { id: Filter; label: string; match: (s: AlertSeverity) => boolean }[] = [
  { id: "problems", label: "Problems", match: (s) => s !== "recovery" },
  { id: "critical", label: "Critical only", match: (s) => s === "critical" },
  { id: "recovery", label: "Recoveries", match: (s) => s === "recovery" },
  { id: "all", label: "Everything", match: () => true },
];

function Stat({ label, value, sub, icon: Icon, tone }: { label: string; value: number; sub: string; icon: React.ComponentType<{ className?: string }>; tone: string }) {
  return (
    <Card className="flex items-start justify-between gap-3 border-slate-800 bg-slate-900 p-4">
      <div>
        <p className="text-sm font-medium text-slate-400">{label}</p>
        <p className={`mt-1 font-mono text-3xl font-bold ${tone}`}>{value}</p>
        <p className="mt-0.5 text-xs text-slate-500">{sub}</p>
      </div>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-800/70">
        <Icon className={`h-5 w-5 ${tone}`} />
      </div>
    </Card>
  );
}

function Location({ loc }: { loc: AlertLocation | null }) {
  if (!loc) return <span className="text-slate-500">None recorded</span>;
  return (
    <div>
      <a href={mapsUrl(loc.lat, loc.lng)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200">
        <MapPin className="h-3 w-3" /> {formatCoords(loc.lat, loc.lng)}
      </a>
      {loc.recordedAt && (
        <p className="text-xs text-slate-500" title={formatDateTimeSec(loc.recordedAt)}>
          fix {formatAgo(loc.recordedAt)}
        </p>
      )}
    </div>
  );
}

export default function TrackingAlertsClient() {
  const [data, setData] = useState<TrackingAlertsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [filter, setFilter] = useState<Filter>("problems");
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    api<TrackingAlertsResult>("/api/tracking-alerts?limit=200")
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError("");
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load tracking alerts."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!;
    return (data?.alerts ?? []).filter((a) => f.match(a.severity));
  }, [data, filter]);

  const counts = data?.counts;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Tracking Alerts</h1>
          <p className="text-sm text-slate-400">
            Location problems during active shifts, reported by the driver&apos;s phone or detected by the server. Updates every 20 seconds.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800">
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      {error && <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="On shift" value={counts?.onShift ?? 0} sub="Drivers with an open shift" icon={Users} tone="text-slate-100" />
        <Stat label="Location off / revoked" value={counts?.ongoingCritical ?? 0} sub="Location switched off or permission removed" icon={AlertOctagon} tone="text-rose-300" />
        <Stat label="Other tracking problems" value={counts?.ongoingWarning ?? 0} sub="No GPS fix, service stopped, or phone silent" icon={AlertTriangle} tone="text-amber-300" />
        <Stat label="Offline" value={counts?.offline ?? 0} sub="No internet; phone keeps recording" icon={WifiOff} tone="text-sky-300" />
      </div>

      <Card className="border-slate-800 bg-slate-900 p-0">
        <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
          <RadioTower className="h-4 w-4 text-indigo-300" />
          <h2 className="font-semibold text-slate-100">Live tracking status</h2>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead className="text-slate-400">Driver</TableHead>
                <TableHead className="text-slate-400">Status</TableHead>
                <TableHead className="text-slate-400">Last location</TableHead>
                <TableHead className="text-slate-400">Last heard from</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !data && (
                <TableRow className="border-slate-800">
                  <TableCell colSpan={4} className="py-8 text-center text-slate-500">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              )}
              {data && data.live.length === 0 && (
                <TableRow className="border-slate-800">
                  <TableCell colSpan={4} className="py-8 text-center text-slate-500">
                    Nobody is on shift right now.
                  </TableCell>
                </TableRow>
              )}
              {data?.live.map((r) => (
                <TableRow key={r.shiftId} className="cursor-pointer border-slate-800 hover:bg-slate-800/50" onClick={() => setSelected(r.shiftId)}>
                  <TableCell>
                    <p className="font-medium text-slate-100">{r.driverName}</p>
                    <p className="text-xs text-slate-500">
                      {[r.employeeId, r.vehicle, r.shiftLabel].filter(Boolean).join(" · ")}
                    </p>
                  </TableCell>
                  <TableCell>
                    <ShiftStatusBadge status={r.status} currentCause={r.currentCause} currentCauseLabel={r.currentCauseLabel} connectivityLost={r.connectivityLost} />
                    {r.status === "INTERRUPTED" && r.currentCauseLabel && (
                      <p className="mt-1 text-xs text-slate-300">
                        {r.currentCauseLabel}
                        {r.currentInterruptionStart && <span className="text-slate-500"> · since {formatAgo(r.currentInterruptionStart)}</span>}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Location loc={r.lastLocation} />
                  </TableCell>
                  <TableCell className="text-sm text-slate-300">{r.lastContactAt ? formatAgo(r.lastContactAt) : "Never"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="border-slate-800 bg-slate-900 p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <h2 className="font-semibold text-slate-100">Alert history</h2>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  filter === f.id ? "border-indigo-500 bg-indigo-600 text-white" : "border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-800"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead className="text-slate-400">When</TableHead>
                <TableHead className="text-slate-400">Event</TableHead>
                <TableHead className="text-slate-400">Driver</TableHead>
                <TableHead className="text-slate-400">Last location</TableHead>
                <TableHead className="text-slate-400">Status now</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data && visible.length === 0 && (
                <TableRow className="border-slate-800">
                  <TableCell colSpan={5} className="py-8 text-center text-slate-500">
                    No alerts match this filter.
                  </TableCell>
                </TableRow>
              )}
              {visible.map((a) => (
                <TableRow key={a.id} className="cursor-pointer border-slate-800 align-top hover:bg-slate-800/50" onClick={() => setSelected(a.shiftId)}>
                  <TableCell className="whitespace-nowrap text-sm">
                    <p className="text-slate-200">{formatDateTimeSec(a.occurredAt)}</p>
                    <p className="text-xs text-slate-500">{formatAgo(a.occurredAt)}</p>
                    {a.delayedMs > LATE_MS && (
                      <p className="text-xs text-sky-300" title={`Received ${formatDateTimeSec(a.receivedAt)}`}>
                        reported {formatDurationMs(a.delayedMs)} later
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="min-w-[16rem] max-w-md">
                    <div className="flex items-center gap-2">
                      <SeverityIcon severity={a.severity} />
                      <span className={cn("font-medium", SEVERITY_STYLE[a.severity].text)}>{a.title}</span>
                      <OngoingChip ongoing={a.ongoing} severity={a.severity} />
                    </div>
                    <p className="mt-1 whitespace-normal text-xs text-slate-400">{a.explanation}</p>
                    {a.reason && <p className="mt-1 whitespace-normal text-xs text-slate-500">Device: {a.reason}</p>}
                  </TableCell>
                  <TableCell>
                    <p className="font-medium text-slate-100">{a.driver.name}</p>
                    <p className="text-xs text-slate-500">{[a.driver.employeeId, a.vehicle].filter(Boolean).join(" · ") || a.deviceId}</p>
                  </TableCell>
                  <TableCell>
                    <Location loc={a.lastLocation} />
                  </TableCell>
                  <TableCell>
                    <ShiftStatusBadge status={a.current.status} currentCause={a.current.cause} currentCauseLabel={a.current.causeLabel} connectivityLost={a.current.connectivityLost} />
                    {a.current.status === "INTERRUPTED" && a.current.causeLabel && (
                      <p className="mt-1 text-xs text-slate-400">{a.current.causeLabel}</p>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {selected && <ShiftDetailDialog shiftId={selected} timezone={data?.timezone} onClose={() => setSelected(null)} />}
    </div>
  );
}
