"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, History, Loader2, MapPin, RadioTower, RefreshCw, Search, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, endOfLocalDayISO, startOfLocalDayISO } from "../income-expense/apiClient";
import { Pager } from "../income-expense/Pager";
import { ShiftStatusBadge } from "@/components/shifts/ShiftStatusBadge";
import { ShiftDetailDialog } from "./ShiftDetailDialog";
import { formatAgo, formatCoords, formatDateTimeSec, formatDurationMs, formatScheduleRange, mapsUrl } from "@/lib/shiftFormat";
import type { ShiftRow, listShifts } from "@/lib/shiftService";

type ListResponse = Awaited<ReturnType<typeof listShifts>>;
type View = "live" | "history";

const REFRESH_MS = 30_000;
const selectCls =
  "h-9 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500";

function Stat({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}) {
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

function LocationCell({ row }: { row: ShiftRow }) {
  if (!row.lastLocation) return <span className="text-slate-500">None recorded</span>;
  return (
    <div>
      <a
        href={mapsUrl(row.lastLocation.lat, row.lastLocation.lng)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200"
      >
        <MapPin className="h-3 w-3" /> {formatCoords(row.lastLocation.lat, row.lastLocation.lng)}
      </a>
      {row.lastLocation.recordedAt && <p className="text-xs text-slate-500">{formatAgo(row.lastLocation.recordedAt)}</p>}
    </div>
  );
}

function VarianceCell({ row }: { row: ShiftRow }) {
  const v = row.varianceMs;
  const tone = row.status === "ENDED" && v < -15 * 60_000 ? "text-amber-300" : "text-slate-300";
  return (
    <span className={`font-mono ${tone}`}>
      {v >= 0 ? "+" : ""}
      {formatDurationMs(v)}
    </span>
  );
}

export default function ShiftsClient() {
  const [view, setView] = useState<View>("live");
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [shiftType, setShiftType] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [onlyInterrupted, setOnlyInterrupted] = useState(false);
  const [page, setPage] = useState(1);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const query = useMemo(() => {
    const p = new URLSearchParams({ view, page: String(page), limit: view === "live" ? "100" : "25" });
    if (view === "history") {
      if (search.trim()) p.set("search", search.trim());
      if (shiftType) p.set("shiftType", shiftType);
      if (status) p.set("status", status);
      if (from) p.set("from", startOfLocalDayISO(from));
      if (to) p.set("to", endOfLocalDayISO(to));
      if (onlyInterrupted) p.set("interrupted", "1");
    }
    return p.toString();
  }, [view, page, search, shiftType, status, from, to, onlyInterrupted]);

  useEffect(() => {
    let cancelled = false;
    api<ListResponse>(`/api/shifts?${query}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError("");
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load shifts."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, refreshKey]);

  // The live board keeps itself current: a driver whose tracking just dropped should
  // show up without anyone pressing refresh.
  useEffect(() => {
    if (view !== "live") return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [view, refresh]);

  const switchView = (v: View) => {
    setView(v);
    setPage(1);
    setLoading(true);
    setData(null);
  };

  const timezone = data?.config.timezone;
  const summary = data?.summary;
  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Driver Shifts</h1>
          <p className="mt-1 text-sm text-slate-400">
            Who is on shift, whose tracking is interrupted, and the full audit log of every shift.
            {data && (
              <>
                {" "}
                Schedule:{" "}
                {data.config.shifts
                  .map((s) => {
                    const fmt = (m: number) =>
                      `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
                    return `${s.label} ${fmt(s.startMinute)}-${fmt(s.endMinute)}`;
                  })
                  .join(", ")}{" "}
                ({data.config.timezone}).
              </>
            )}
          </p>
        </div>
        <Button variant="outline" className="border-slate-700 bg-transparent text-slate-200" onClick={refresh}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="On shift now" value={summary?.onShift ?? 0} sub="Tracking healthy" icon={CheckCircle2} tone="text-emerald-400" />
        <Stat
          label="Tracking interrupted"
          value={summary?.interrupted ?? 0}
          sub="Failed or not reporting"
          icon={AlertTriangle}
          tone={(summary?.interrupted ?? 0) > 0 ? "text-rose-400" : "text-slate-300"}
        />
        <Stat label="Ended in last 24h" value={summary?.endedLast24h ?? 0} sub="Completed shifts" icon={Square} tone="text-slate-300" />
      </div>

      <div className="flex w-fit gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1">
        {(
          [
            ["live", "Live now", RadioTower],
            ["history", "History", History],
          ] as const
        ).map(([v, label, Icon]) => (
          <button
            key={v}
            onClick={() => switchView(v)}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
              view === v ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {view === "history" && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
            <Input
              placeholder="Search driver"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-56 border-slate-700 bg-slate-950 pl-8 text-slate-200"
            />
          </div>
          <select className={selectCls} value={shiftType} onChange={(e) => { setShiftType(e.target.value); setPage(1); }}>
            <option value="">All shifts</option>
            <option value="MORNING">Morning</option>
            <option value="EVENING">Evening</option>
          </select>
          <select className={selectCls} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Any status</option>
            <option value="ACTIVE">On shift</option>
            <option value="INTERRUPTED">Interrupted</option>
            <option value="ENDED">Ended</option>
          </select>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            From
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="h-9 w-40 border-slate-700 bg-slate-950 text-slate-200" />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            To
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="h-9 w-40 border-slate-700 bg-slate-950 text-slate-200" />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={onlyInterrupted}
              onChange={(e) => { setOnlyInterrupted(e.target.checked); setPage(1); }}
              className="h-4 w-4 accent-indigo-500"
            />
            With interruptions only
          </label>
        </div>
      )}

      {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}

      <Card className="overflow-hidden border-slate-800 bg-slate-900">
        {loading && !data ? (
          <div className="flex justify-center py-16 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">
            {view === "live" ? "Nobody is on shift right now." : "No shifts match these filters."}
          </div>
        ) : view === "live" ? (
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead>Driver</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Elapsed / scheduled</TableHead>
                <TableHead>Last heard</TableHead>
                <TableHead>Last location</TableHead>
                <TableHead className="text-right">Interruptions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.shiftId} className="cursor-pointer border-slate-800 hover:bg-slate-800/50" onClick={() => setSelected(r.shiftId)}>
                  <TableCell>
                    <p className="font-medium text-slate-100">{r.driverName}</p>
                    <p className="text-xs text-slate-500">{r.vehicle ?? r.deviceId}</p>
                  </TableCell>
                  <TableCell>
                    <p className="text-slate-200">{r.shiftLabel}</p>
                    <p className="text-xs text-slate-500">{formatScheduleRange(r.scheduledStart, r.scheduledEnd, timezone)}</p>
                  </TableCell>
                  <TableCell>
                    <ShiftStatusBadge status={r.status} currentCause={r.currentCause} currentCauseLabel={r.currentCauseLabel} connectivityLost={r.connectivityLost} />
                    {r.status === "INTERRUPTED" && (
                      <p className="mt-1 max-w-56 text-xs text-slate-400">
                        {r.currentCauseLabel}
                        {r.currentInterruptionStart && <> - since {formatAgo(r.currentInterruptionStart)}</>}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-slate-300">{formatDateTimeSec(r.actualStart)}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-slate-200">
                    {formatDurationMs(r.actualMs)} <span className="text-slate-500">/ {formatDurationMs(r.scheduledMs)}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-slate-300">{formatAgo(r.lastContactAt, data?.serverTime)}</TableCell>
                  <TableCell>
                    <LocationCell row={r} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-slate-200">
                    {r.interruptionCount}
                    {r.trackingInterruptedMs > 0 && <p className="text-xs text-rose-300">{formatDurationMs(r.trackingInterruptedMs)} lost</p>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead>Driver</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Ended</TableHead>
                  <TableHead className="text-right">Scheduled</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Tracking lost</TableHead>
                  <TableHead>Status / end reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.shiftId} className="cursor-pointer border-slate-800 hover:bg-slate-800/50" onClick={() => setSelected(r.shiftId)}>
                    <TableCell>
                      <p className="font-medium text-slate-100">{r.driverName}</p>
                      <p className="text-xs text-slate-500">{r.vehicle ?? r.deviceId}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-slate-200">{r.shiftLabel}</p>
                      {r.outsideSchedule && <p className="text-xs text-amber-400">outside schedule</p>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-slate-300">{formatDateTimeSec(r.actualStart)}</TableCell>
                    <TableCell className="whitespace-nowrap text-slate-300">{r.actualEnd ? formatDateTimeSec(r.actualEnd) : "In progress"}</TableCell>
                    <TableCell className="text-right font-mono text-slate-300">{formatDurationMs(r.scheduledMs)}</TableCell>
                    <TableCell className="text-right font-mono text-slate-200">{formatDurationMs(r.actualMs)}</TableCell>
                    <TableCell className="text-right">
                      <VarianceCell row={r} />
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      <span className={r.trackingInterruptedMs > 0 ? "text-rose-300" : "text-slate-400"}>
                        {formatDurationMs(r.trackingInterruptedMs)}
                      </span>
                      <p className="text-xs text-slate-500">{r.interruptionCount}x</p>
                    </TableCell>
                    <TableCell>
                      {r.status === "ENDED" ? (
                        <p className="max-w-64 text-xs text-slate-300">{r.endReasonLabel}</p>
                      ) : (
                        <ShiftStatusBadge status={r.status} currentCause={r.currentCause} currentCauseLabel={r.currentCauseLabel} connectivityLost={r.connectivityLost} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
          </>
        )}
      </Card>

      {selected && <ShiftDetailDialog shiftId={selected} timezone={timezone} onClose={() => setSelected(null)} />}
    </div>
  );
}
