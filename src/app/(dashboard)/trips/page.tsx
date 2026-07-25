"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Route, RefreshCw, MapPin } from "lucide-react";
import { format } from "date-fns";
import dynamic from "next/dynamic";

const RouteHistoryMap = dynamic(() => import("./RouteHistoryMap"), { ssr: false });

interface LocationSession {
  _id: string;
  sessionId: string;
  deviceId: string;
  employeeId?: string;
  vehicleId?: string;
  status: "ACTIVE" | "COMPLETED" | "INTERRUPTED";
  startedAt: string;
  stoppedAt?: string;
  totalPoints: number;
  firstPointAt?: string;
  lastPointAt?: string;
}

interface LocationPoint {
  pointId: string;
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

function durationStr(start: string, end?: string): string {
  const ms = end ? new Date(end).getTime() - new Date(start).getTime() : Date.now() - new Date(start).getTime();
  const mins = Math.floor(ms / 60000);
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

export default function RouteHistoryPage() {
  const [sessions, setSessions] = useState<LocationSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<LocationSession | null>(null);
  const [points, setPoints] = useState<LocationPoint[]>([]);
  const [isLoadingPoints, setIsLoadingPoints] = useState(false);
  const [filterDate, setFilterDate] = useState("");
  const [devices, setDevices] = useState<FleetDevice[]>([]);

  // Resolve a device -> employee name where we have it, purely to enrich the
  // label. Sessions still show for everyone regardless of this lookup.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/fleet-map");
        if (res.ok) {
          const data: FleetDevice[] = await res.json();
          setDevices(data);
        }
      } catch {}
    })();
  }, []);

  const deviceById = new Map(devices.map((d) => [d.deviceId, d]));

  // Prefer the employee id carried on the session itself. Fall back to the
  // resolved employee name / vehicle when an id isn't recorded.
  const sessionOwner = (s: LocationSession) => {
    if (s.employeeId) return `Employee ${s.employeeId}`;
    const d = deviceById.get(s.deviceId);
    if (d?.employeeName?.trim()) return d.employeeName.trim();
    if (s.vehicleId) return `Vehicle ${s.vehicleId}`;
    if (d?.vehicle) return `Vehicle ${d.vehicle}`;
    return `Device ${s.deviceId.slice(0, 8)}…`;
  };

  const fetchSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      const res = await fetch(`/api/location/sessions?${params}`);
      if (res.ok) setSessions(await res.json());
    } catch {}
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const loadRoute = async (session: LocationSession) => {
    setSelectedSession(session);
    setPoints([]);
    setIsLoadingPoints(true);
    try {
      const res = await fetch(`/api/location/history?sessionId=${session.sessionId}`);
      if (res.ok) setPoints(await res.json());
    } catch {}
    finally { setIsLoadingPoints(false); }
  };

  const filteredSessions = sessions.filter((s) => {
    if (filterDate) {
      const d = new Date(s.startedAt);
      const filterD = new Date(filterDate);
      if (d.toDateString() !== filterD.toDateString()) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Route History</h1>
          <p className="text-slate-400 mt-1">View GPS route sessions and track driven paths on the map.</p>
        </div>
        <Button variant="outline" className="border-slate-700 text-slate-300 bg-transparent hover:bg-slate-800" onClick={fetchSessions} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Filters — date only. Sessions are shown for every employee. */}
      <div className="flex flex-wrap gap-3">
        <Input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="w-44 bg-slate-900 border-slate-700 text-slate-200"
        />
        {filterDate && (
          <Button variant="outline" size="sm" className="border-slate-700 text-slate-400 bg-transparent" onClick={() => setFilterDate("")}>
            Clear
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Sessions list */}
        <div className="lg:col-span-2 space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="text-center py-12 bg-slate-900 rounded-xl border border-slate-800 border-dashed">
              <Route className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-slate-500">No route sessions found.</p>
            </div>
          ) : filteredSessions.map((s) => (
            <button
              key={s._id}
              onClick={() => loadRoute(s)}
              className={`w-full text-left p-4 rounded-xl border transition-all ${selectedSession?.sessionId === s.sessionId ? "bg-indigo-600/20 border-indigo-500/50" : "bg-slate-900 border-slate-800 hover:bg-slate-800/70"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-white text-sm truncate">{sessionOwner(s)}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {format(new Date(s.startedAt), "MMM dd, HH:mm")}
                  </p>
                </div>
                <Badge variant="outline" className={STATUS_COLORS[s.status] || ""}>
                  {s.status}
                </Badge>
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                <span>{durationStr(s.startedAt, s.stoppedAt)}</span>
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{s.totalPoints} pts</span>
              </div>
            </button>
          ))}
        </div>

        {/* Map panel */}
        <div className="lg:col-span-3">
          {selectedSession ? (
            <Card className="bg-slate-900 border-slate-800 overflow-hidden">
              {isLoadingPoints ? (
                <div className="h-[500px] flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                </div>
              ) : points.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-4 p-4 border-b border-slate-800 flex-wrap">
                    <div>
                      <p className="text-xs text-slate-500">Distance</p>
                      <p className="font-bold text-white">{distanceKm(points).toFixed(2)} km</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Duration</p>
                      <p className="font-bold text-white">{durationStr(selectedSession.startedAt, selectedSession.stoppedAt)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Points</p>
                      <p className="font-bold text-white">{points.length}</p>
                    </div>
                  </div>
                  <RouteHistoryMap points={points} />
                </div>
              ) : (
                <div className="h-[500px] flex items-center justify-center">
                  <p className="text-slate-500">No GPS points for this session.</p>
                </div>
              )}
            </Card>
          ) : (
            <div className="h-[500px] flex items-center justify-center bg-slate-900 rounded-xl border border-slate-800 border-dashed">
              <div className="text-center">
                <Route className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                <p className="text-slate-500">Select a session to view its route</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
