"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import {
  Database,
  Download,
  Loader2,
  Pause,
  Play,
  Square,
  RefreshCw,
  Phone,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Job = {
  id: string;
  status:
    | "requested"
    | "running"
    | "pausing"
    | "paused"
    | "stopping"
    | "stopped"
    | "completed"
    | "failed";
  deviceId: string;
  employeeName?: string;
  mobileProvider: string;
  seriesId: string;
  seriesPrefix: string;
  seriesLabel: string;
  startNumber: string;
  endNumber: string;
  batchSize: number;
  delayMs: number;
  workers: number;
  lookupProviderId: string;
  totalPlanned: number;
  processed: number;
  remaining: number;
  successful: number;
  failed: number;
  currentNumber?: string | null;
  progressPct: number;
  speedPerSec: number;
  avgLookupMs: number;
  etaSeconds: number | null;
  startedAt?: string | null;
  errorMessage?: string | null;
  lastHeartbeatAt?: string | null;
};

type LookupResult = {
  _id: string;
  phoneNumber: string;
  callerName?: string | null;
  lookupStatus: string;
  lookedUpAt: string;
  kyc?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  durationMs?: number;
  error?: string | null;
  provider?: string;
};

type LogRow = {
  _id: string;
  level: string;
  message: string;
  phoneNumber?: string | null;
  durationMs?: number | null;
  createdAt: string;
  details?: Record<string, unknown> | null;
};

type ProviderOption = {
  id: string;
  label: string;
  description: string;
  supportsNameLookup: boolean;
};

type AndroidDevice = {
  deviceId: string;
  employeeName?: string;
  vehicle?: string;
  lastReceivedAt?: string;
  freshness?: string;
};

type SeriesOption = {
  id: string;
  prefix: string;
  label: string;
  startNumber: string;
  endNumber: string;
  circle?: string;
};

const BATCH_PRESETS = [100, 200, 500, 1000, 10000];

function statusColor(status: string) {
  switch (status) {
    case "running":
      return "text-emerald-300 bg-emerald-500/15 border-emerald-500/30";
    case "requested":
    case "pausing":
    case "stopping":
      return "text-cyan-300 bg-cyan-500/15 border-cyan-500/30";
    case "paused":
      return "text-amber-300 bg-amber-500/15 border-amber-500/30";
    case "completed":
      return "text-sky-300 bg-sky-500/15 border-sky-500/30";
    case "stopped":
    case "failed":
      return "text-rose-300 bg-rose-500/15 border-rose-500/30";
    default:
      return "text-slate-300 bg-slate-500/15 border-slate-500/30";
  }
}

function formatEta(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.ceil((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function KycBlock({ kyc }: { kyc?: Record<string, unknown> | null }) {
  if (!kyc || !Object.keys(kyc).length) {
    return <p className="text-xs text-slate-500">No KYC information available.</p>;
  }
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
      {Object.entries(kyc).map(([key, value]) => (
        <div key={key} className="flex gap-2">
          <dt className="text-slate-500 shrink-0">{key}:</dt>
          <dd className="text-slate-200 break-all">
            {typeof value === "object" ? JSON.stringify(value) : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function CallerLookupPage() {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesOption[]>([]);
  const [mobileProvider, setMobileProvider] = useState("jio");
  const [seriesId, setSeriesId] = useState("");
  const [startNumber, setStartNumber] = useState("");
  const [endNumber, setEndNumber] = useState("");
  const [batchSize, setBatchSize] = useState(200);
  const [delayMs, setDelayMs] = useState(200);
  const [workers, setWorkers] = useState(1);
  const [maxRetries, setMaxRetries] = useState(2);
  const [lookupProviderId, setLookupProviderId] = useState("android-call-log-cache");
  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [deviceId, setDeviceId] = useState("");

  const [job, setJob] = useState<Job | null>(null);
  const [results, setResults] = useState<LookupResult[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const selectedSeries = useMemo(
    () => seriesList.find((s) => s.id === seriesId) || null,
    [seriesList, seriesId]
  );

  const selectedResult = useMemo(
    () => results.find((r) => r._id === selectedResultId) || results[0] || null,
    [results, selectedResultId]
  );

  const refresh = useCallback(async () => {
    const res = await fetch("/api/caller-lookup/job");
    if (!res.ok) return;
    const data = await res.json();
    setJob(data.job);
    setResults(data.results || []);
    setLogs(data.logs || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingMeta(true);
      try {
        const [pRes, sRes, dRes] = await Promise.all([
          fetch("/api/caller-lookup/providers"),
          fetch("/api/caller-lookup/series?provider=jio"),
          fetch("/api/caller-lookup/devices"),
        ]);
        if (pRes.ok) {
          const p = await pRes.json();
          if (!cancelled) {
            setProviders(p.providers || []);
            setLookupProviderId(p.defaultProviderId || "android-call-log-cache");
          }
        }
        if (dRes.ok) {
          const list: AndroidDevice[] = await dRes.json();
          if (!cancelled) {
            setDevices(list);
            if (list[0]) setDeviceId((current) => current || list[0].deviceId);
          }
        }
        if (sRes.ok) {
          const s = await sRes.json();
          if (!cancelled) {
            const list: SeriesOption[] = s.series || [];
            setSeriesList(list);
            if (list[0]) {
              setSeriesId(list[0].id);
              setStartNumber(list[0].startNumber);
              setEndNumber("");
            }
          }
        }
        await refresh();
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!selectedSeries) return;
    setStartNumber(selectedSeries.startNumber);
    setEndNumber("");
  }, [selectedSeries?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The dashboard only monitors. Android advances the job and uploads state.
  useEffect(() => {
    const active = ["requested", "running", "pausing", "paused", "stopping"].includes(
      job?.status || ""
    );
    const id = setInterval(refresh, active ? 1000 : 5000);
    return () => clearInterval(id);
  }, [job?.status, refresh]);

  const exportExcel = async (foundOnly = false) => {
    if (!job) return;
    setExporting(true);
    setError("");
    try {
      const params = new URLSearchParams({ jobId: job.id });
      if (foundOnly) params.set("foundOnly", "1");
      const res = await fetch(`/api/caller-lookup/job/export?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Export failed");
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const match = /filename="([^"]+)"/.exec(cd);
      const filename = match?.[1] || `caller-lookup-${job.id.slice(-8)}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const startJob = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/caller-lookup/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mobileProvider,
          deviceId,
          seriesId,
          startNumber: startNumber || undefined,
          endNumber: endNumber || undefined,
          batchSize,
          delayMs,
          workers,
          maxRetries,
          lookupProviderId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start job");
      setJob(data.job);
      setResults([]);
      setLogs([]);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start job");
    } finally {
      setBusy(false);
    }
  };

  const control = async (action: "pause" | "resume" | "stop") => {
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/caller-lookup/job/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Control failed");
      setJob(data.job);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Control failed");
    } finally {
      setBusy(false);
    }
  };

  const isRunning = job?.status === "running";
  const isPaused = job?.status === "paused";
  const isActive = [
    "requested",
    "running",
    "pausing",
    "paused",
    "stopping",
  ].includes(job?.status || "");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            <Database className="h-8 w-8 text-cyan-400" />
            Caller Lookup Job
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            Control a persistent lookup job on an enrolled Android device and monitor its
            uploaded progress, results, and logs.
          </p>
        </div>
        <Button
          variant="outline"
          className="border-slate-700 text-slate-200"
          onClick={() => refresh()}
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="bg-slate-900 border-slate-800 text-slate-100 xl:col-span-1">
          <CardHeader>
            <CardTitle className="text-base text-slate-200">Job Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingMeta ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              <>
                <label className="block space-y-1.5">
                  <span className="text-xs text-slate-400">Android device</span>
                  <select
                    className="w-full h-9 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"
                    value={deviceId}
                    onChange={(e) => setDeviceId(e.target.value)}
                    disabled={isActive}
                  >
                    {devices.length === 0 && (
                      <option value="">No enrolled devices available</option>
                    )}
                    {devices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.employeeName || device.deviceId}
                        {device.vehicle ? ` — ${device.vehicle}` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500">
                    This device generates numbers, performs lookups, retries, and uploads
                    progress. The web page never executes a lookup.
                  </p>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs text-slate-400">Mobile provider</span>
                  <select
                    className="w-full h-9 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"
                    value={mobileProvider}
                    onChange={(e) => setMobileProvider(e.target.value)}
                    disabled={isActive}
                  >
                    <option value="jio">Jio</option>
                  </select>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs text-slate-400">Number series</span>
                  <select
                    className="w-full h-9 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"
                    value={seriesId}
                    onChange={(e) => setSeriesId(e.target.value)}
                    disabled={isActive}
                  >
                    {seriesList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1.5">
                    <span className="text-xs text-slate-400">Starting number</span>
                    <Input
                      value={startNumber}
                      onChange={(e) => setStartNumber(e.target.value)}
                      disabled={isActive}
                      className="bg-slate-950 border-slate-700"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs text-slate-400">Ending number (optional)</span>
                    <Input
                      value={endNumber}
                      onChange={(e) => setEndNumber(e.target.value)}
                      placeholder="Leave blank"
                      disabled={isActive}
                      className="bg-slate-950 border-slate-700"
                    />
                  </label>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-xs text-slate-400">Batch size</span>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {BATCH_PRESETS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        disabled={isActive}
                        onClick={() => setBatchSize(n)}
                        className={cn(
                          "px-2.5 py-1 rounded-md text-xs border",
                          batchSize === n
                            ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-200"
                            : "border-slate-700 text-slate-400 hover:border-slate-500"
                        )}
                      >
                        {n.toLocaleString()}
                      </button>
                    ))}
                  </div>
                  <Input
                    type="number"
                    min={1}
                    max={100000}
                    value={batchSize}
                    onChange={(e) => setBatchSize(Number(e.target.value) || 1)}
                    disabled={isActive}
                    className="bg-slate-950 border-slate-700"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1.5">
                    <span className="text-xs text-slate-400">Delay between lookups (ms)</span>
                    <Input
                      type="number"
                      min={0}
                      value={delayMs}
                      onChange={(e) => setDelayMs(Number(e.target.value) || 0)}
                      disabled={isActive}
                      className="bg-slate-950 border-slate-700"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs text-slate-400">Concurrent workers</span>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={workers}
                      onChange={(e) => setWorkers(Number(e.target.value) || 1)}
                      disabled={isActive}
                      className="bg-slate-950 border-slate-700"
                    />
                  </label>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-xs text-slate-400">Retries per failed lookup</span>
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    value={maxRetries}
                    onChange={(e) => setMaxRetries(Number(e.target.value) || 0)}
                    disabled={isActive}
                    className="bg-slate-950 border-slate-700"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs text-slate-400">Lookup provider</span>
                  <select
                    className="w-full h-9 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"
                    value={lookupProviderId}
                    onChange={(e) => setLookupProviderId(e.target.value)}
                    disabled={isActive}
                  >
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500">
                    {providers.find((p) => p.id === lookupProviderId)?.description}
                  </p>
                </label>

                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    onClick={startJob}
                    disabled={busy || isActive || !seriesId || !deviceId}
                    className="bg-cyan-600 hover:bg-cyan-500 text-white"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    Start Job
                  </Button>
                  <Button
                    variant="outline"
                    className="border-slate-700"
                    onClick={() => control("pause")}
                    disabled={busy || !isRunning}
                  >
                    <Pause className="h-4 w-4" />
                    Pause
                  </Button>
                  <Button
                    variant="outline"
                    className="border-slate-700"
                    onClick={() => control("resume")}
                    disabled={busy || !isPaused}
                  >
                    <Play className="h-4 w-4" />
                    Resume
                  </Button>
                  <Button
                    variant="outline"
                    className="border-rose-700 text-rose-300"
                    onClick={() => control("stop")}
                    disabled={busy || !isActive || job?.status === "stopping"}
                  >
                    <Square className="h-4 w-4" />
                    Stop
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800 text-slate-100 xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base text-slate-200">Job Dashboard</CardTitle>
            {job && (
              <span
                className={cn(
                  "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border capitalize",
                  statusColor(job.status)
                )}
              >
                {job.status}
              </span>
            )}
          </CardHeader>
          <CardContent className="space-y-5">
            {!job ? (
              <p className="text-sm text-slate-500">
                No job yet. Configure a batch and click Start Job.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Progress</span>
                    <span>{job.progressPct.toFixed(1)}%</span>
                  </div>
                  <div className="h-3 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-600 to-emerald-500 transition-all duration-300"
                      style={{ width: `${Math.min(100, job.progressPct)}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Stat label="Processed" value={String(job.processed)} />
                  <Stat label="Remaining" value={String(job.remaining)} />
                  <Stat label="Successful" value={String(job.successful)} accent="text-emerald-300" />
                  <Stat label="Failed / empty" value={String(job.failed)} accent="text-rose-300" />
                  <Stat
                    label="Current number"
                    value={job.currentNumber || "—"}
                    icon={<Phone className="h-3.5 w-3.5" />}
                  />
                  <Stat
                    label="Speed"
                    value={
                      job.speedPerSec > 0
                        ? `${job.speedPerSec.toFixed(2)}/s`
                        : "—"
                    }
                  />
                  <Stat label="Avg lookup" value={job.avgLookupMs ? `${Math.round(job.avgLookupMs)}ms` : "—"} />
                  <Stat label="ETA" value={formatEta(job.etaSeconds)} />
                </div>

                <div className="text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
                  <span>Series: {job.seriesLabel}</span>
                  <span>
                    Android: {job.employeeName || job.deviceId} ({job.deviceId})
                  </span>
                  <span>
                    Range: {job.startNumber} → {job.endNumber}
                  </span>
                  <span>Provider: {job.lookupProviderId}</span>
                  <span>Total planned: {job.totalPlanned}</span>
                  <span>
                    Device heartbeat:{" "}
                    {job.lastHeartbeatAt
                      ? format(new Date(job.lastHeartbeatAt), "HH:mm:ss")
                      : "waiting"}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="bg-slate-900 border-slate-800 text-slate-100 xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base text-slate-200">Results</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-slate-700"
                onClick={() => exportExcel(false)}
                disabled={!job || exporting || (job.processed || 0) === 0}
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Export Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-emerald-700 text-emerald-300"
                onClick={() => exportExcel(true)}
                disabled={!job || exporting || (job.successful || 0) === 0}
              >
                <Download className="h-4 w-4" />
                Found only
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-slate-800 overflow-hidden max-h-[420px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-800 hover:bg-transparent">
                    <TableHead className="text-slate-400">Phone Number</TableHead>
                    <TableHead className="text-slate-400">Caller Name</TableHead>
                    <TableHead className="text-slate-400">Lookup Status</TableHead>
                    <TableHead className="text-slate-400">Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.length === 0 ? (
                    <TableRow className="border-slate-800">
                      <TableCell colSpan={4} className="text-slate-500 text-sm">
                        Results will appear here as lookups complete.
                      </TableCell>
                    </TableRow>
                  ) : (
                    results.map((r) => (
                      <TableRow
                        key={r._id}
                        className={cn(
                          "border-slate-800 cursor-pointer",
                          selectedResult?._id === r._id && "bg-slate-800/60"
                        )}
                        onClick={() => setSelectedResultId(r._id)}
                      >
                        <TableCell className="font-mono text-sm">{r.phoneNumber}</TableCell>
                        <TableCell className="text-sm">
                          {r.callerName || <span className="text-slate-500">—</span>}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "text-xs px-2 py-0.5 rounded-full border",
                              r.lookupStatus === "found"
                                ? "border-emerald-500/30 text-emerald-300"
                                : r.lookupStatus === "error"
                                  ? "border-rose-500/30 text-rose-300"
                                  : "border-slate-600 text-slate-400"
                            )}
                          >
                            {r.lookupStatus}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {r.lookedUpAt
                            ? format(new Date(r.lookedUpAt), "HH:mm:ss dd MMM")
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800 text-slate-100">
          <CardHeader>
            <CardTitle className="text-base text-slate-200">Selected Result Detail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedResult ? (
              <p className="text-sm text-slate-500">Select a result row to inspect details.</p>
            ) : (
              <>
                <div>
                  <h3 className="text-sm font-medium text-slate-300 mb-2">Basic Information</h3>
                  <dl className="space-y-1 text-xs">
                    <div className="flex gap-2">
                      <dt className="text-slate-500 w-28">Phone Number</dt>
                      <dd className="font-mono">{selectedResult.phoneNumber}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-slate-500 w-28">Caller Name</dt>
                      <dd>{selectedResult.callerName || "—"}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-slate-500 w-28">Lookup Status</dt>
                      <dd>{selectedResult.lookupStatus}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-slate-500 w-28">Timestamp</dt>
                      <dd>
                        {selectedResult.lookedUpAt
                          ? format(new Date(selectedResult.lookedUpAt), "PPpp")
                          : "—"}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-slate-500 w-28">Duration</dt>
                      <dd>{selectedResult.durationMs != null ? `${selectedResult.durationMs}ms` : "—"}</dd>
                    </div>
                  </dl>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-slate-300 mb-2">KYC Information</h3>
                  <KycBlock kyc={selectedResult.kyc} />
                </div>
                {selectedResult.metadata && Object.keys(selectedResult.metadata).length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-slate-300 mb-2">Metadata</h3>
                    <KycBlock kyc={selectedResult.metadata} />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-slate-900 border-slate-800 text-slate-100">
        <CardHeader>
          <CardTitle className="text-base text-slate-200">Live Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-64 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/60 p-3 font-mono text-[11px] space-y-1">
            {logs.length === 0 ? (
              <p className="text-slate-500">Logs will stream here while the job runs.</p>
            ) : (
              logs.map((l) => (
                <div key={l._id} className="flex gap-2">
                  <span className="text-slate-600 shrink-0">
                    {l.createdAt ? format(new Date(l.createdAt), "HH:mm:ss") : ""}
                  </span>
                  <span
                    className={cn(
                      "uppercase w-16 shrink-0",
                      l.level === "success"
                        ? "text-emerald-400"
                        : l.level === "error"
                          ? "text-rose-400"
                          : l.level === "failure"
                            ? "text-amber-400"
                            : l.level === "api"
                              ? "text-sky-400"
                              : "text-slate-400"
                    )}
                  >
                    {l.level}
                  </span>
                  <span className="text-slate-300">
                    {l.phoneNumber ? `[${l.phoneNumber}] ` : ""}
                    {l.message}
                    {l.durationMs != null ? ` (${l.durationMs}ms)` : ""}
                  </span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
      <div className="text-[11px] text-slate-500 flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className={cn("text-lg font-semibold mt-0.5 truncate", accent || "text-slate-100")}>
        {value}
      </div>
    </div>
  );
}
