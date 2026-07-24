"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Navigation, Satellite, Radio, StopCircle } from "lucide-react";
import dynamic from "next/dynamic";

const FleetMapCore = dynamic(() => import("./FleetMapCore"), { ssr: false });

interface DeviceState {
  _id: string;
  deviceId: string;
  employeeName?: string;
  vehicle?: string;
  latestCoordinates: { lat: number; lng: number };
  latestAccuracy?: number;
  latestSpeed?: number;
  lastReceivedAt?: string;
  trackingStatus?: string;
  batteryPercent?: number;
  freshness: "fresh" | "stale" | "old" | "unavailable";
  ageMinutes: number | null;
}

export default function FleetMapPage() {
  const [devices, setDevices] = useState<DeviceState[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [commandStates, setCommandStates] = useState<Record<string, boolean>>({});
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch("/api/fleet-map");
      if (res.ok) setDevices(await res.json());
    } catch {}
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => {
    fetchDevices();
    autoRefreshRef.current = setInterval(fetchDevices, 30000);
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, [fetchDevices]);

  const sendCommand = async (deviceId: string, type: string) => {
    const key = `${deviceId}:${type}`;
    setCommandStates((prev) => ({ ...prev, [key]: true }));
    try {
      await fetch("/api/location/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, type }),
      });
      setTimeout(fetchDevices, 3000);
    } catch {}
    finally {
      setTimeout(() => setCommandStates((prev) => { const n = { ...prev }; delete n[key]; return n; }), 4000);
    }
  };

  const freshnessColor = {
    fresh: "border-emerald-500/50 text-emerald-400 bg-emerald-500/10",
    stale: "border-amber-500/50 text-amber-400 bg-amber-500/10",
    old: "border-rose-500/50 text-rose-400 bg-rose-500/10",
    unavailable: "border-slate-600 text-slate-400 bg-slate-500/10",
  };

  const freshnessLabel = {
    fresh: "Live < 1m",
    stale: "1–5m ago",
    old: "> 5m ago",
    unavailable: "No data",
  };

  const mappableDevices = devices.filter(
    (d) => d.latestCoordinates?.lat && d.latestCoordinates?.lng
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Fleet GPS Map</h1>
          <p className="text-slate-400">
            Live device positions from GPS tracking.{" "}
            <span className="text-slate-500 text-xs">Auto-refreshes every 30s.</span>
          </p>
        </div>
        <Button
          onClick={fetchDevices}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-md border border-slate-700 transition-colors flex items-center gap-2"
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </Button>
      </div>

      {/* Freshness legend */}
      <div className="flex flex-wrap gap-3">
        {(["fresh", "stale", "old", "unavailable"] as const).map((f) => (
          <Badge key={f} variant="outline" className={freshnessColor[f]}>
            {freshnessLabel[f]}
          </Badge>
        ))}
      </div>

      {/* Map */}
      <Card className="bg-slate-900 border-slate-800 text-slate-100 p-1">
        {isLoading && devices.length === 0 ? (
          <div className="h-[480px] w-full flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
          </div>
        ) : (
          <FleetMapCore devices={mappableDevices} freshnessColor={freshnessColor} />
        )}
      </Card>

      {/* Device cards */}
      {devices.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-3">
            Active Devices <span className="text-slate-500 font-normal text-sm">({devices.length})</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {devices.map((d) => {
              const isCmd = (type: string) => !!commandStates[`${d.deviceId}:${type}`];
              return (
                <div key={d.deviceId} className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">{d.employeeName || d.deviceId}</p>
                      {d.vehicle && <p className="text-xs text-slate-400 font-mono">{d.vehicle}</p>}
                    </div>
                    <Badge variant="outline" className={freshnessColor[d.freshness]}>
                      {freshnessLabel[d.freshness]}
                    </Badge>
                  </div>

                  {d.latestCoordinates?.lat ? (
                    <div className="text-xs text-slate-500 font-mono">
                      {d.latestCoordinates.lat.toFixed(5)}, {d.latestCoordinates.lng.toFixed(5)}
                      {d.latestSpeed != null && (
                        <span className="ml-2 text-slate-400">{(d.latestSpeed * 3.6).toFixed(1)} km/h</span>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-600">No location data</p>
                  )}

                  {d.batteryPercent != null && (
                    <div className="flex items-center gap-1 text-xs">
                      <div className={`w-2 h-2 rounded-full ${d.batteryPercent > 20 ? "bg-emerald-400" : "bg-rose-400"}`} />
                      <span className="text-slate-400">Battery: {d.batteryPercent}%</span>
                    </div>
                  )}

                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-slate-700 text-slate-300 bg-transparent hover:bg-slate-800 text-xs h-8"
                      onClick={() => sendCommand(d.deviceId, "location_latest")}
                      disabled={isCmd("location_latest")}
                      title="Request latest location"
                    >
                      {isCmd("location_latest") ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Navigation className="w-3 h-3 mr-1" />}
                      Latest
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-slate-700 text-slate-300 bg-transparent hover:bg-slate-800 text-xs h-8"
                      onClick={() => sendCommand(d.deviceId, "location_upload")}
                      disabled={isCmd("location_upload")}
                      title="Request route upload"
                    >
                      {isCmd("location_upload") ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Satellite className="w-3 h-3 mr-1" />}
                      Route
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-indigo-700/50 text-indigo-400 bg-transparent hover:bg-indigo-500/10 text-xs h-8"
                      onClick={() => sendCommand(d.deviceId, "location_live_mode")}
                      disabled={isCmd("location_live_mode")}
                      title="Start live mode"
                    >
                      {isCmd("location_live_mode") ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Radio className="w-3 h-3 mr-1" />}
                      Live
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-rose-700/50 text-rose-400 bg-transparent hover:bg-rose-500/10 text-xs h-8"
                      onClick={() => sendCommand(d.deviceId, "location_stop_live_mode")}
                      disabled={isCmd("location_stop_live_mode")}
                      title="Stop live mode"
                    >
                      {isCmd("location_stop_live_mode") ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <StopCircle className="w-3 h-3 mr-1" />}
                      Stop
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!isLoading && devices.length === 0 && (
        <div className="text-center py-16 bg-slate-900 rounded-xl border border-slate-800 border-dashed">
          <Satellite className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No active GPS devices</p>
          <p className="text-slate-500 text-sm mt-1">Enroll devices via Device Enrollment and enable GPS tracking on the Android app.</p>
        </div>
      )}
    </div>
  );
}
