"use client";

import { MapContainer, TileLayer, Polyline, Marker, Popup, CircleMarker } from "react-leaflet";
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

interface LocationPoint {
  pointId: string;
  sequenceNumber: number;
  latitude: number;
  longitude: number;
  recordedAt: string;
  speedMetersPerSecond?: number;
}

interface Props {
  points: LocationPoint[];
}

export default function RouteHistoryMap({ points }: Props) {
  if (points.length === 0) return null;

  const latlngs: [number, number][] = points.map((p) => [p.latitude, p.longitude]);
  const center = latlngs[0];
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className="h-[440px] w-full rounded-b-xl overflow-hidden relative z-0">
      <MapContainer
        center={center}
        zoom={14}
        style={{ height: "100%", width: "100%", zIndex: 0 }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline positions={latlngs} color="#6366f1" weight={3} opacity={0.85} />

        {/* Start marker */}
        <Marker position={[first.latitude, first.longitude]}>
          <Popup>
            <p className="font-bold text-emerald-700">Start</p>
            <p className="text-xs text-slate-500">{new Date(first.recordedAt).toLocaleTimeString()}</p>
          </Popup>
        </Marker>

        {/* End marker */}
        {points.length > 1 && (
          <CircleMarker
            center={[last.latitude, last.longitude]}
            radius={8}
            pathOptions={{ color: "#ef4444", fillColor: "#ef4444", fillOpacity: 1 }}
          >
            <Popup>
              <p className="font-bold text-rose-700">End</p>
              <p className="text-xs text-slate-500">{new Date(last.recordedAt).toLocaleTimeString()}</p>
            </Popup>
          </CircleMarker>
        )}
      </MapContainer>
    </div>
  );
}
