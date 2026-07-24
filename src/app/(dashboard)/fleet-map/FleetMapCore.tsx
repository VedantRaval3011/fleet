"use client";

import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Fix default icons
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

// Coloured circle markers per freshness
function makeIcon(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32">
    <circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2"/>
    <line x1="12" y1="22" x2="12" y2="32" stroke="${color}" stroke-width="2"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [24, 32],
    iconAnchor: [12, 32],
    popupAnchor: [0, -34],
  });
}

const ICONS = {
  fresh: makeIcon("#10b981"),
  stale: makeIcon("#f59e0b"),
  old: makeIcon("#ef4444"),
  unavailable: makeIcon("#64748b"),
};

interface DeviceState {
  deviceId: string;
  employeeName?: string;
  vehicle?: string;
  latestCoordinates: { lat: number; lng: number };
  latestAccuracy?: number;
  latestSpeed?: number;
  lastReceivedAt?: string;
  batteryPercent?: number;
  freshness: "fresh" | "stale" | "old" | "unavailable";
  ageMinutes: number | null;
}

interface Props {
  devices: DeviceState[];
  freshnessColor: Record<string, string>;
}

export default function FleetMapCore({ devices }: Props) {
  if (devices.length === 0) {
    return (
      <div className="h-[480px] w-full bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-center">
        <p className="text-slate-500 text-lg">No GPS locations available yet.</p>
      </div>
    );
  }

  const center: [number, number] = [devices[0].latestCoordinates.lat, devices[0].latestCoordinates.lng];

  return (
    <div className="h-[480px] w-full rounded-xl overflow-hidden border border-slate-800 shadow-2xl relative z-0">
      <MapContainer center={center} zoom={13} style={{ height: "100%", width: "100%", zIndex: 0 }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {devices.map((d) => (
          <span key={d.deviceId}>
            {d.latestAccuracy != null && d.latestAccuracy > 0 && (
              <Circle
                center={[d.latestCoordinates.lat, d.latestCoordinates.lng]}
                radius={d.latestAccuracy}
                pathOptions={{
                  color: d.freshness === "fresh" ? "#10b981" : d.freshness === "stale" ? "#f59e0b" : "#ef4444",
                  fillOpacity: 0.08,
                  weight: 1.5,
                  dashArray: "5,5",
                }}
              />
            )}
            <Marker
              position={[d.latestCoordinates.lat, d.latestCoordinates.lng]}
              icon={ICONS[d.freshness]}
            >
              <Popup className="rounded-xl overflow-hidden">
                <div className="space-y-2 min-w-[180px] font-sans text-sm">
                  <p className="font-bold text-slate-900">{d.employeeName || d.deviceId}</p>
                  {d.vehicle && <p className="font-mono text-xs text-slate-600">{d.vehicle}</p>}
                  {d.latestSpeed != null && (
                    <p className="text-slate-600 text-xs">{(d.latestSpeed * 3.6).toFixed(1)} km/h</p>
                  )}
                  {d.batteryPercent != null && (
                    <p className="text-xs text-slate-500">Battery: {d.batteryPercent}%</p>
                  )}
                  {d.lastReceivedAt && (
                    <p className="text-xs text-slate-400">
                      {d.ageMinutes != null ? `${d.ageMinutes < 1 ? "< 1" : Math.round(d.ageMinutes)} min ago` : ""}
                    </p>
                  )}
                </div>
              </Popup>
            </Marker>
          </span>
        ))}
      </MapContainer>
    </div>
  );
}
