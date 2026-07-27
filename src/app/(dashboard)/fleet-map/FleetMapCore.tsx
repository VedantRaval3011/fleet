"use client";

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  Polyline,
  CircleMarker,
  ZoomControl,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, type ReactNode } from "react";
import { Loader2, Navigation, Radio, Satellite, StopCircle } from "lucide-react";
import { vehicleLabel } from "@/lib/companyIdQuery";

const DefaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

function makeIcon(color: string, selected = false) {
  const size = selected ? 30 : 24;
  const height = selected ? 40 : 32;
  const r = selected ? 12 : 10;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${height}" viewBox="0 0 ${size} ${height}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="${color}" stroke="white" stroke-width="${selected ? 3 : 2}"/>
    <line x1="${size / 2}" y1="${size / 2 + r}" x2="${size / 2}" y2="${height}" stroke="${color}" stroke-width="2"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [size, height],
    iconAnchor: [size / 2, height],
    popupAnchor: [0, -height + 8],
  });
}

const TRACK_COLOR: Record<string, string> = {
  fresh: "#10b981",
  stale: "#f59e0b",
  old: "#ef4444",
  unavailable: "#64748b",
};

interface DeviceState {
  deviceId: string;
  employeeName?: string;
  vehicle?: string | { id?: string; registration?: string };
  latestCoordinates: { lat: number; lng: number };
  latestAccuracy?: number;
  latestSpeed?: number;
  lastReceivedAt?: string;
  batteryPercent?: number;
  freshness: "fresh" | "stale" | "old" | "unavailable";
  ageMinutes: number | null;
}

export interface DeviceTrack {
  deviceId: string;
  points: { lat: number; lng: number; recordedAt?: string; speed?: number }[];
}

export type LocationCommand =
  | "location_latest"
  | "location_upload"
  | "location_live_mode"
  | "location_stop_live_mode"
  | "location_start_tracking"
  | "location_stop_tracking";

interface Props {
  devices: DeviceState[];
  tracks?: DeviceTrack[];
  autoFit?: boolean;
  selectedDeviceId?: string | null;
  onSelectDevice?: (deviceId: string) => void;
  onCommand?: (deviceId: string, type: LocationCommand) => void;
  commandStates?: Record<string, boolean>;
  focusPoint?: { lat: number; lng: number } | null;
}

function FitBounds({ points, enabled }: { points: [number, number][]; enabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!enabled || points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], Math.max(map.getZoom(), 15));
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [72, 72], maxZoom: 16 });
  }, [enabled, map, points]);
  return null;
}

function FocusOn({ point }: { point: { lat: number; lng: number } | null | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (!point) return;
    map.flyTo([point.lat, point.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [map, point?.lat, point?.lng]);
  return null;
}

function CmdButton({
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
      ? "border-indigo-300 text-indigo-700 hover:bg-indigo-50"
      : tone === "stop"
        ? "border-rose-300 text-rose-700 hover:bg-rose-50"
        : "border-slate-200 text-slate-700 hover:bg-slate-50";
  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${toneClass}`}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : icon}
      {label}
    </button>
  );
}

export default function FleetMapCore({
  devices,
  tracks = [],
  autoFit = true,
  selectedDeviceId = null,
  onSelectDevice,
  onCommand,
  commandStates = {},
  focusPoint = null,
}: Props) {
  const trackByDevice = new Map(tracks.map((t) => [t.deviceId, t.points]));
  const center: [number, number] =
    devices.length > 0
      ? [devices[0].latestCoordinates.lat, devices[0].latestCoordinates.lng]
      : [20.5937, 78.9629];

  const allPoints: [number, number][] = [];
  devices.forEach((d) => allPoints.push([d.latestCoordinates.lat, d.latestCoordinates.lng]));
  tracks.forEach((t) => t.points.forEach((p) => allPoints.push([p.lat, p.lng])));

  const isCmd = (deviceId: string, type: string) => !!commandStates[`${deviceId}:${type}`];

  return (
    <div className="absolute inset-0 z-0 h-full w-full">
      <MapContainer
        center={center}
        zoom={devices.length ? 13 : 5}
        style={{ height: "100%", width: "100%" }}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomControl position="bottomright" />
        <FitBounds points={allPoints} enabled={autoFit && !focusPoint} />
        <FocusOn point={focusPoint} />

        {devices.map((d) => {
          const trail = trackByDevice.get(d.deviceId) || [];
          const latlngs: [number, number][] = trail
            .filter((p) => p.lat != null && p.lng != null)
            .map((p) => [p.lat, p.lng]);
          const color = TRACK_COLOR[d.freshness];
          const selected = selectedDeviceId === d.deviceId;
          const plate = vehicleLabel(d.vehicle);

          return (
            <span key={d.deviceId}>
              {latlngs.length > 1 && (
                <>
                  <Polyline
                    positions={latlngs}
                    pathOptions={{
                      color,
                      weight: selected ? 5 : 4,
                      opacity: selected ? 0.95 : 0.8,
                    }}
                  />
                  <CircleMarker
                    center={latlngs[0]}
                    radius={5}
                    pathOptions={{ color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 }}
                  >
                    <Popup>
                      <p className="text-xs font-semibold text-slate-700">Trail start</p>
                      {trail[0].recordedAt && (
                        <p className="text-xs text-slate-500">
                          {new Date(trail[0].recordedAt).toLocaleTimeString()}
                        </p>
                      )}
                    </Popup>
                  </CircleMarker>
                </>
              )}

              {d.latestAccuracy != null && d.latestAccuracy > 0 && (
                <Circle
                  center={[d.latestCoordinates.lat, d.latestCoordinates.lng]}
                  radius={d.latestAccuracy}
                  pathOptions={{
                    color,
                    fillOpacity: 0.08,
                    weight: 1.5,
                    dashArray: "5,5",
                  }}
                />
              )}

              <Marker
                position={[d.latestCoordinates.lat, d.latestCoordinates.lng]}
                icon={makeIcon(color, selected)}
                eventHandlers={{
                  click: () => onSelectDevice?.(d.deviceId),
                }}
              >
                <Popup className="fleet-map-popup">
                  <div className="min-w-[210px] space-y-2 font-sans text-sm">
                    <div>
                      <p className="font-bold text-slate-900">{d.employeeName || d.deviceId}</p>
                      {plate && <p className="font-mono text-xs text-slate-600">{plate}</p>}
                    </div>
                    <div className="space-y-0.5 text-xs text-slate-600">
                      {d.latestSpeed != null && (
                        <p>{(d.latestSpeed * 3.6).toFixed(1)} km/h</p>
                      )}
                      {latlngs.length > 1 && <p>{latlngs.length} points in trail</p>}
                      {d.batteryPercent != null && <p>Battery: {d.batteryPercent}%</p>}
                      {d.lastReceivedAt && d.ageMinutes != null && (
                        <p className="text-slate-400">
                          {d.ageMinutes < 1 ? "< 1" : Math.round(d.ageMinutes)} min ago
                        </p>
                      )}
                    </div>
                    {onCommand && (
                      <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
                        <CmdButton
                          label="Start"
                          icon={<Radio className="h-3 w-3" />}
                          busy={isCmd(d.deviceId, "location_start_tracking")}
                          onClick={() => onCommand(d.deviceId, "location_start_tracking")}
                          tone="live"
                        />
                        <CmdButton
                          label="End"
                          icon={<StopCircle className="h-3 w-3" />}
                          busy={isCmd(d.deviceId, "location_stop_tracking")}
                          onClick={() => onCommand(d.deviceId, "location_stop_tracking")}
                          tone="stop"
                        />
                        <CmdButton
                          label="Latest"
                          icon={<Navigation className="h-3 w-3" />}
                          busy={isCmd(d.deviceId, "location_latest")}
                          onClick={() => onCommand(d.deviceId, "location_latest")}
                        />
                        <CmdButton
                          label="Upload"
                          icon={<Satellite className="h-3 w-3" />}
                          busy={isCmd(d.deviceId, "location_upload")}
                          onClick={() => onCommand(d.deviceId, "location_upload")}
                        />
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            </span>
          );
        })}
      </MapContainer>
    </div>
  );
}
