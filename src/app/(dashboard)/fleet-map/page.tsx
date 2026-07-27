"use client";

import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import {
  Loader2,
  RefreshCw,
  Navigation,
  Satellite,
  Radio,
  StopCircle,
  Search,
  X,
  Crosshair,
  Battery,
  MapPin,
  Menu,
  List,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useSidebar } from "@/components/layout/SidebarContext";
import { vehicleLabel } from "@/lib/companyIdQuery";
import type { DeviceTrack, LocationCommand } from "./FleetMapCore";

const FleetMapCore = dynamic(() => import("./FleetMapCore"), { ssr: false });

const TRACK_WINDOW_MINUTES = 120;
const REFRESH_MS = 5000;

interface DeviceState {
  _id: string;
  deviceId: string;
  employeeName?: string;
  vehicle?: string | { id?: string; registration?: string };
  latestCoordinates: { lat: number; lng: number };
  latestAccuracy?: number;
  latestSpeed?: number;
  lastReceivedAt?: string;
  trackingStatus?: string;
  batteryPercent?: number;
  freshness: "fresh" | "stale" | "old" | "unavailable";
  ageMinutes: number | null;
}

const freshnessMeta = {
  fresh: { label: "Live", chip: "bg-emerald-500 text-white", dot: "bg-emerald-400" },
  stale: { label: "1–5m", chip: "bg-amber-500 text-white", dot: "bg-amber-400" },
  old: { label: "> 5m", chip: "bg-rose-500 text-white", dot: "bg-rose-400" },
  unavailable: { label: "N/A", chip: "bg-slate-500 text-white", dot: "bg-slate-400" },
} as const;

export default function FleetMapPage() {
  const { open } = useSidebar();
  const [devices, setDevices] = useState<DeviceState[]>([]);
  const [tracks, setTracks] = useState<DeviceTrack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [followFleet, setFollowFleet] = useState(true);
  const [commandStates, setCommandStates] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [focusPoint, setFocusPoint] = useState<{ lat: number; lng: number } | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  const fetchDevices = useCallback(async () => {
    try {
      const [statesRes, tracksRes] = await Promise.all([
        fetch("/api/fleet-map"),
        fetch(`/api/fleet-map/tracks?minutes=${TRACK_WINDOW_MINUTES}`),
      ]);
      if (statesRes.ok) setDevices(await statesRes.json());
      if (tracksRes.ok) {
        const data = await tracksRes.json();
        setTracks(data.tracks || []);
      }
    } catch {
      /* ignore */
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
    autoRefreshRef.current = setInterval(fetchDevices, REFRESH_MS);
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [fetchDevices]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!searchWrapRef.current?.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const sendCommand = async (deviceId: string, type: LocationCommand) => {
    const key = `${deviceId}:${type}`;
    setCommandStates((prev) => ({ ...prev, [key]: true }));
    try {
      await fetch("/api/location/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, type }),
      });
      setTimeout(fetchDevices, 3000);
    } catch {
      /* ignore */
    } finally {
      setTimeout(() => {
        setCommandStates((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 4000);
    }
  };

  const filteredDevices = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((d) => {
      const hay = `${d.employeeName || ""} ${vehicleLabel(d.vehicle) || ""} ${d.deviceId}`.toLowerCase();
      return hay.includes(q);
    });
  }, [devices, query]);

  const mappableDevices = useMemo(
    () =>
      devices.filter((d) => d.latestCoordinates?.lat && d.latestCoordinates?.lng),
    [devices]
  );

  const selected = devices.find((d) => d.deviceId === selectedDeviceId) || null;
  const selectedPlate = vehicleLabel(selected?.vehicle);

  const focusDevice = (deviceId: string) => {
    const d = devices.find((x) => x.deviceId === deviceId);
    setSelectedDeviceId(deviceId);
    setFollowFleet(false);
    setSearchOpen(false);
    setListOpen(false);
    setQuery(d?.employeeName || d?.deviceId || "");
    if (d?.latestCoordinates?.lat && d?.latestCoordinates?.lng) {
      setFocusPoint({ lat: d.latestCoordinates.lat, lng: d.latestCoordinates.lng });
    }
  };

  const clearSelection = () => {
    setSelectedDeviceId(null);
    setQuery("");
    setFocusPoint(null);
  };

  const isCmd = (deviceId: string, type: string) => !!commandStates[`${deviceId}:${type}`];

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-200">
      <FleetMapCore
        devices={mappableDevices}
        tracks={tracks}
        autoFit={followFleet}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={focusDevice}
        onCommand={sendCommand}
        commandStates={commandStates}
        focusPoint={focusPoint}
      />

      {isLoading && devices.length === 0 && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-black/10">
          <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-lg">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
            Loading map…
          </div>
        </div>
      )}

      {/* Top-left Google-style search stack */}
      <div className="absolute left-3 top-3 z-[1100] flex w-[min(calc(100%-5.5rem),22rem)] flex-col gap-2 sm:left-4 sm:top-4">
        <div ref={searchWrapRef} className="relative">
          <div className="flex items-center gap-1 rounded-full bg-white pl-2 pr-2 shadow-[0_2px_8px_rgba(0,0,0,0.18)]">
            <button
              type="button"
              onClick={() => open()}
              className="rounded-full p-2.5 text-slate-600 hover:bg-slate-100 sm:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Search className="ml-1 hidden h-4 w-4 shrink-0 text-slate-400 sm:block" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search fleet…"
              className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-slate-800 outline-none placeholder:text-slate-400"
            />
            {query ? (
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Clear"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setListOpen((v) => !v)}
                className={`rounded-full p-2 ${listOpen ? "bg-indigo-50 text-indigo-600" : "text-slate-500 hover:bg-slate-100"}`}
                aria-label="Device list"
                title="Device list"
              >
                <List className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Search / list dropdown — only as tall as content */}
          {(searchOpen || listOpen) && (
            <div className="mt-2 max-h-[min(50vh,22rem)] overflow-y-auto rounded-2xl bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.18)]">
              {filteredDevices.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-500">
                  {devices.length === 0 ? "No GPS devices yet" : "No matches"}
                </div>
              ) : (
                filteredDevices.map((d) => {
                  const meta = freshnessMeta[d.freshness];
                  const active = selectedDeviceId === d.deviceId;
                  const plate = vehicleLabel(d.vehicle);
                  return (
                    <button
                      key={d.deviceId}
                      type="button"
                      onClick={() => focusDevice(d.deviceId)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 ${
                        active ? "bg-indigo-50/70" : ""
                      }`}
                    >
                      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">
                          {d.employeeName || d.deviceId}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">
                          {plate ? `${plate} · ` : ""}
                          {d.latestCoordinates?.lat
                            ? `${d.latestCoordinates.lat.toFixed(4)}, ${d.latestCoordinates.lng.toFixed(4)}`
                            : "No location"}
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.chip}`}>
                        {meta.label}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Compact selected-device card (Google place card style) */}
        {selected && !searchOpen && !listOpen && (
          <div className="rounded-2xl bg-white p-3 shadow-[0_2px_10px_rgba(0,0,0,0.16)]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-slate-900">
                  {selected.employeeName || selected.deviceId}
                </p>
                {selectedPlate && (
                  <p className="truncate font-mono text-xs text-slate-500">{selectedPlate}</p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${freshnessMeta[selected.freshness].chip}`}
                >
                  {freshnessMeta[selected.freshness].label}
                </span>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
              {selected.latestCoordinates?.lat && (
                <span className="inline-flex items-center gap-1 font-mono">
                  <MapPin className="h-3 w-3" />
                  {selected.latestCoordinates.lat.toFixed(5)}, {selected.latestCoordinates.lng.toFixed(5)}
                </span>
              )}
              {selected.latestSpeed != null && (
                <span>{(selected.latestSpeed * 3.6).toFixed(0)} km/h</span>
              )}
              {selected.batteryPercent != null && (
                <span className="inline-flex items-center gap-1">
                  <Battery className="h-3 w-3" />
                  {selected.batteryPercent}%
                </span>
              )}
            </div>

            <div className="mt-3 grid grid-cols-4 gap-1.5">
              <ActionBtn
                label="Start"
                icon={<Radio className="h-3.5 w-3.5" />}
                busy={isCmd(selected.deviceId, "location_start_tracking")}
                onClick={() => sendCommand(selected.deviceId, "location_start_tracking")}
                tone="live"
              />
              <ActionBtn
                label="End"
                icon={<StopCircle className="h-3.5 w-3.5" />}
                busy={isCmd(selected.deviceId, "location_stop_tracking")}
                onClick={() => sendCommand(selected.deviceId, "location_stop_tracking")}
                tone="stop"
              />
              <ActionBtn
                label="Latest"
                icon={<Navigation className="h-3.5 w-3.5" />}
                busy={isCmd(selected.deviceId, "location_latest")}
                onClick={() => sendCommand(selected.deviceId, "location_latest")}
              />
              <ActionBtn
                label="Upload"
                icon={<Satellite className="h-3.5 w-3.5" />}
                busy={isCmd(selected.deviceId, "location_upload")}
                onClick={() => sendCommand(selected.deviceId, "location_upload")}
              />
            </div>
          </div>
        )}
      </div>

      {/* Right-side map FABs */}
      <div className="absolute right-3 top-3 z-[1100] flex flex-col gap-2 sm:right-4 sm:top-4">
        <Fab
          title={followFleet ? "Following fleet" : "Follow fleet"}
          active={followFleet}
          onClick={() => {
            setFollowFleet((v) => !v);
            if (!followFleet) setFocusPoint(null);
          }}
        >
          <Crosshair className="h-5 w-5" />
        </Fab>
        <Fab title="Refresh" onClick={fetchDevices}>
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
        </Fab>
      </div>

      {/* Bottom-left compact legend */}
      <div className="absolute bottom-3 left-3 z-[1000] flex flex-wrap gap-1 rounded-full bg-white/95 p-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.15)] sm:bottom-4 sm:left-4">
        {(Object.keys(freshnessMeta) as Array<keyof typeof freshnessMeta>).map((key) => (
          <span
            key={key}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-slate-600"
          >
            <span className={`h-2 w-2 rounded-full ${freshnessMeta[key].dot}`} />
            {freshnessMeta[key].label}
          </span>
        ))}
      </div>

      {!isLoading && devices.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 z-[1000] flex justify-center px-4">
          <div className="pointer-events-auto rounded-2xl bg-white px-4 py-3 text-center shadow-lg">
            <p className="text-sm font-medium text-slate-800">No active GPS devices</p>
            <p className="mt-0.5 text-xs text-slate-500">Enroll a device, then use Start on this map (or open the phone app once for permissions).</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Fab({
  children,
  onClick,
  title,
  active,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex h-11 w-11 items-center justify-center rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.2)] transition-colors ${
        active
          ? "bg-indigo-600 text-white hover:bg-indigo-500"
          : "bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function ActionBtn({
  label,
  icon,
  busy,
  onClick,
  tone = "neutral",
}: {
  label: string;
  icon: ReactNode;
  busy: boolean;
  onClick: () => void;
  tone?: "neutral" | "live" | "stop";
}) {
  const toneClass =
    tone === "live"
      ? "text-indigo-700 hover:bg-indigo-50"
      : tone === "stop"
        ? "text-rose-700 hover:bg-rose-50"
        : "text-slate-700 hover:bg-slate-50";
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 rounded-xl bg-slate-50 px-1 py-2 text-[10px] font-semibold disabled:opacity-50 ${toneClass}`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}
