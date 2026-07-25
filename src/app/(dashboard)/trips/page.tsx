"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  Loader2,
  Route,
  MapPin,
  Play,
  Pause,
  Download,
  Printer,
  Gauge,
  Clock,
  Ruler,
  Flag,
} from "lucide-react";
import { format } from "date-fns";
import dynamic from "next/dynamic";

const RouteHistoryMap = dynamic(() => import("./RouteHistoryMap"), { ssr: false });

interface LocationSession {
  _id: string;
  sessionId: string;
  deviceId: string;
  status: "ACTIVE" | "COMPLETED" | "INTERRUPTED";
  startedAt: string;
  stoppedAt?: string;
  totalPoints: number;
  firstPointAt?: string;
  lastPointAt?: string;
}

interface LocationPoint {
  pointId: string;
  sessionId: string;
  sequenceNumber: number;
  latitude: number;
  longitude: number;
  recordedAt: string;
  speedMetersPerSecond?: number;
}

interface FleetDevice {
  deviceId: string;
  employeeName?: string;
  vehicle?: string;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "border-emerald-500/50 text-emerald-400 bg-emerald-500/10",
  COMPLETED: "border-indigo-500/50 text-indigo-400 bg-indigo-500/10",
  INTERRUPTED: "border-amber-500/50 text-amber-400 bg-amber-500/10",
};

function durationStr(startMs: number, endMs: number): string {
  const mins = Math.max(0, Math.floor((endMs - startMs) / 60000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function distanceKm(points: LocationPoint[]): number {
  let dist = 0;
  for (let i = 1; i < points.length; i++) {
    const lat1 = (points[i - 1].latitude * Math.PI) / 180;
    const lat2 = (points[i].latitude * Math.PI) / 180;
    const dLat = lat2 - lat1;
    const dLng = ((points[i].longitude - points[i - 1].longitude) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    dist += 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return dist;
}

// Reverse-geocode a single coordinate via OpenStreetMap Nominatim (no API key).
// Falls back to "lat, lng" on any failure or rate-limit.
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) return fallback;
    const data = await res.json();
    return data.display_name || fallback;
  } catch {
    return fallback;
  }
}

export default function RouteHistoryPage() {
  const [devices, setDevices] = useState<FleetDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("23:59");
  const [formError, setFormError] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [hasQueried, setHasQueried] = useState(false);
  const [points, setPoints] = useState<LocationPoint[]>([]);
  const [sessions, setSessions] = useState<LocationSession[]>([]);
  const [selectedSubTrip, setSelectedSubTrip] = useState<string | null>(null); // sessionId or null = all

  const [startPlace, setStartPlace] = useState<string>("");
  const [endPlace, setEndPlace] = useState<string>("");

  // Playback
  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  // Load devices to power the employee/device picker.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/fleet-map");
        if (res.ok) setDevices(await res.json());
      } catch {}
    })();
  }, []);

  const deviceOptions: ComboboxOption[] = useMemo(
    () =>
      devices
        .map((d) => ({
          value: d.deviceId,
          label: d.employeeName?.trim() || `Device ${d.deviceId.slice(0, 8)}…`,
          sublabel: d.vehicle?.trim() || d.deviceId,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [devices]
  );

  // Points shown for the currently selected sub-trip (or the whole window).
  const displayedPoints = useMemo(
    () =>
      selectedSubTrip ? points.filter((p) => p.sessionId === selectedSubTrip) : points,
    [points, selectedSubTrip]
  );

  const stats = useMemo(() => {
    if (displayedPoints.length === 0) return null;
    const first = displayedPoints[0];
    const last = displayedPoints[displayedPoints.length - 1];
    const speeds = displayedPoints
      .map((p) => p.speedMetersPerSecond)
      .filter((s): s is number => s != null && s >= 0);
    const avg = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
    const max = speeds.length ? Math.max(...speeds) : 0;
    return {
      distance: distanceKm(displayedPoints),
      duration: durationStr(new Date(first.recordedAt).getTime(), new Date(last.recordedAt).getTime()),
      count: displayedPoints.length,
      avgKmh: avg * 3.6,
      maxKmh: max * 3.6,
    };
  }, [displayedPoints]);

  const resetPlayback = () => {
    setIsPlaying(false);
    setPlaybackIndex(null);
  };

  const viewRoute = useCallback(async () => {
    if (!selectedDeviceId) return;
    const from = new Date(`${date}T${startTime}:00`);
    const to = new Date(`${date}T${endTime}:59`);
    if (from.getTime() >= to.getTime()) {
      setFormError("Start time must be before end time.");
      return;
    }
    setFormError("");
    setIsLoading(true);
    setHasQueried(true);
    setSelectedSubTrip(null);
    resetPlayback();
    setStartPlace("");
    setEndPlace("");
    setPoints([]);
    setSessions([]);

    try {
      const params = new URLSearchParams({
        deviceId: selectedDeviceId,
        from: from.toISOString(),
        to: to.toISOString(),
      });
      const [ptsRes, sesRes] = await Promise.all([
        fetch(`/api/location/history?${params}`),
        fetch(`/api/location/sessions?deviceId=${selectedDeviceId}&limit=200`),
      ]);

      const pts: LocationPoint[] = ptsRes.ok ? await ptsRes.json() : [];
      setPoints(pts);

      if (sesRes.ok) {
        const all: LocationSession[] = await sesRes.json();
        // Sessions overlapping the selected window.
        const overlap = all.filter((s) => {
          const sStart = new Date(s.startedAt).getTime();
          const sEnd = s.stoppedAt ? new Date(s.stoppedAt).getTime() : Date.now();
          return sStart <= to.getTime() && sEnd >= from.getTime();
        });
        setSessions(overlap);
      }

      // Reverse-geocode endpoints (2 requests, graceful fallback).
      if (pts.length > 0) {
        const first = pts[0];
        const last = pts[pts.length - 1];
        reverseGeocode(first.latitude, first.longitude).then(setStartPlace);
        reverseGeocode(last.latitude, last.longitude).then(setEndPlace);
      }
    } catch {
      setPoints([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDeviceId, date, startTime, endTime]);

  // Reset playback whenever the displayed route changes.
  useEffect(() => {
    resetPlayback();
  }, [selectedSubTrip]);

  // Playback engine.
  useEffect(() => {
    if (!isPlaying || displayedPoints.length < 2) return;
    const step = Math.max(1, Math.ceil(displayedPoints.length / 300)) * speed;
    const id = setInterval(() => {
      setPlaybackIndex((idx) => {
        const next = (idx ?? 0) + step;
        if (next >= displayedPoints.length - 1) return displayedPoints.length - 1;
        return next;
      });
    }, 60);
    return () => clearInterval(id);
  }, [isPlaying, speed, displayedPoints.length]);

  // Stop when playback reaches the end.
  useEffect(() => {
    if (playbackIndex != null && playbackIndex >= displayedPoints.length - 1) {
      setIsPlaying(false);
    }
  }, [playbackIndex, displayedPoints.length]);

  const togglePlay = () => {
    if (displayedPoints.length < 2) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (playbackIndex == null || playbackIndex >= displayedPoints.length - 1) {
      setPlaybackIndex(0);
    }
    setIsPlaying(true);
  };

  const exportCsv = () => {
    if (displayedPoints.length === 0) return;
    const header = "sequence,recordedAt,latitude,longitude,speed_kmh";
    const rows = displayedPoints.map((p) =>
      [
        p.sequenceNumber,
        new Date(p.recordedAt).toISOString(),
        p.latitude,
        p.longitude,
        p.speedMetersPerSecond != null ? (p.speedMetersPerSecond * 3.6).toFixed(1) : "",
      ].join(",")
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `route-${selectedDeviceId?.slice(0, 8)}-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedLabel = deviceOptions.find((o) => o.value === selectedDeviceId)?.label ?? "";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Route History</h1>
          <p className="text-slate-400 mt-1">
            Pick an employee, a day and a time interval to replay their driven route.
          </p>
        </div>
      </div>

      {/* Control bar */}
      <Card className="bg-slate-900 border-slate-800 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div className="lg:col-span-2">
            <label className="text-xs text-slate-500 mb-1.5 block">Employee / Device</label>
            <Combobox
              options={deviceOptions}
              value={selectedDeviceId}
              onChange={setSelectedDeviceId}
              placeholder="Select an employee…"
              searchPlaceholder="Search name or device…"
              emptyText="No devices found."
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1.5 block">Date</label>
            <Input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className="bg-slate-900 border-slate-700 text-slate-200"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-500 mb-1.5 block">Start</label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="bg-slate-900 border-slate-700 text-slate-200"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1.5 block">End</label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="bg-slate-900 border-slate-700 text-slate-200"
              />
            </div>
          </div>
          <div>
            <Button
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white"
              onClick={viewRoute}
              disabled={!selectedDeviceId || isLoading}
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Route className="w-4 h-4 mr-2" />
              )}
              View route
            </Button>
          </div>
        </div>
        {formError && <p className="text-sm text-rose-400 mt-2">{formError}</p>}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: trips in interval */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300">
              Trips in interval {sessions.length > 0 && `(${sessions.length})`}
            </h2>
            {sessions.length > 0 && (
              <button
                onClick={() => setSelectedSubTrip(null)}
                className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                  selectedSubTrip === null
                    ? "border-indigo-500/50 text-indigo-300 bg-indigo-600/20"
                    : "border-slate-700 text-slate-400 hover:bg-slate-800"
                }`}
              >
                All
              </button>
            )}
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            </div>
          ) : !hasQueried ? (
            <div className="text-center py-12 bg-slate-900 rounded-xl border border-slate-800 border-dashed">
              <Route className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-slate-500">Choose an employee and interval, then View route.</p>
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-12 bg-slate-900 rounded-xl border border-slate-800 border-dashed">
              <Route className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-slate-500">No trips found in this interval.</p>
            </div>
          ) : (
            sessions.map((s) => {
              const sPts = points.filter((p) => p.sessionId === s.sessionId);
              return (
                <button
                  key={s._id}
                  onClick={() => setSelectedSubTrip(s.sessionId)}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    selectedSubTrip === s.sessionId
                      ? "bg-indigo-600/20 border-indigo-500/50"
                      : "bg-slate-900 border-slate-800 hover:bg-slate-800/70"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-white text-sm truncate">{selectedLabel}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {format(new Date(s.startedAt), "MMM dd, HH:mm")}
                        {s.stoppedAt && ` – ${format(new Date(s.stoppedAt), "HH:mm")}`}
                      </p>
                    </div>
                    <Badge variant="outline" className={STATUS_COLORS[s.status] || ""}>
                      {s.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                    <span>
                      {durationStr(
                        new Date(s.startedAt).getTime(),
                        s.stoppedAt ? new Date(s.stoppedAt).getTime() : Date.now()
                      )}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {sPts.length || s.totalPoints} pts
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Right: metadata + map */}
        <div className="lg:col-span-3">
          {isLoading ? (
            <div className="h-[560px] flex items-center justify-center bg-slate-900 rounded-xl border border-slate-800">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            </div>
          ) : displayedPoints.length > 0 && stats ? (
            <Card className="bg-slate-900 border-slate-800 overflow-hidden">
              {/* Metadata */}
              <div className="p-4 border-b border-slate-800 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                  <Metric icon={<Ruler className="w-3.5 h-3.5" />} label="Distance" value={`${stats.distance.toFixed(2)} km`} />
                  <Metric icon={<Clock className="w-3.5 h-3.5" />} label="Duration" value={stats.duration} />
                  <Metric icon={<MapPin className="w-3.5 h-3.5" />} label="Points" value={`${stats.count}`} />
                  <Metric icon={<Gauge className="w-3.5 h-3.5" />} label="Avg speed" value={`${stats.avgKmh.toFixed(1)} km/h`} />
                  <Metric icon={<Gauge className="w-3.5 h-3.5" />} label="Max speed" value={`${stats.maxKmh.toFixed(1)} km/h`} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="flex items-start gap-2">
                    <Flag className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500">Start</p>
                      <p className="text-slate-300 truncate" title={startPlace}>
                        {startPlace || "Resolving…"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Flag className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500">End</p>
                      <p className="text-slate-300 truncate" title={endPlace}>
                        {endPlace || "Resolving…"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Playback + export toolbar */}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <Button
                    size="sm"
                    className="bg-indigo-600 hover:bg-indigo-500 text-white"
                    onClick={togglePlay}
                    disabled={displayedPoints.length < 2}
                  >
                    {isPlaying ? <Pause className="w-4 h-4 mr-1.5" /> : <Play className="w-4 h-4 mr-1.5" />}
                    {isPlaying ? "Pause" : "Play"}
                  </Button>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, displayedPoints.length - 1)}
                    value={playbackIndex ?? 0}
                    onChange={(e) => {
                      setIsPlaying(false);
                      setPlaybackIndex(Number(e.target.value));
                    }}
                    className="flex-1 min-w-[120px] accent-indigo-500"
                  />
                  <div className="flex gap-1">
                    {[1, 2, 4].map((sp) => (
                      <button
                        key={sp}
                        onClick={() => setSpeed(sp)}
                        className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                          speed === sp
                            ? "border-indigo-500/50 text-indigo-300 bg-indigo-600/20"
                            : "border-slate-700 text-slate-400 hover:bg-slate-800"
                        }`}
                      >
                        {sp}×
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-slate-700 text-slate-300 bg-transparent hover:bg-slate-800"
                      onClick={exportCsv}
                    >
                      <Download className="w-4 h-4 mr-1.5" /> CSV
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-slate-700 text-slate-300 bg-transparent hover:bg-slate-800"
                      onClick={() => window.print()}
                    >
                      <Printer className="w-4 h-4 mr-1.5" /> PDF
                    </Button>
                  </div>
                </div>
              </div>

              <RouteHistoryMap points={displayedPoints} playbackIndex={playbackIndex} />
            </Card>
          ) : (
            <div className="h-[560px] flex items-center justify-center bg-slate-900 rounded-xl border border-slate-800 border-dashed">
              <div className="text-center">
                <Route className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                <p className="text-slate-500">
                  {hasQueried ? "No GPS points in this interval." : "Select a route to view it on the map."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500 flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p className="font-bold text-white mt-0.5">{value}</p>
    </div>
  );
}
