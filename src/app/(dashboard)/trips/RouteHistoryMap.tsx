"use client";

import { MapContainer, TileLayer, Polyline, Marker, Popup, CircleMarker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo } from "react";

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
  /** When set, draws the route up to this index and shows a moving marker. */
  playbackIndex?: number | null;
}

// Fits the map to every route point once, when the route changes.
// (Deps intentionally exclude playbackIndex so playback doesn't re-fit/jitter.)
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], Math.max(map.getZoom(), 15));
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
  }, [map, points]);
  return null;
}

export default function RouteHistoryMap({ points, playbackIndex = null }: Props) {
  const latlngs = useMemo<[number, number][]>(
    () => points.map((p) => [p.latitude, p.longitude]),
    [points]
  );

  if (points.length === 0) return null;

  const center = latlngs[0];
  const first = points[0];
  const last = points[points.length - 1];

  const isPlaying = playbackIndex != null;
  const clampedIdx = isPlaying ? Math.min(Math.max(playbackIndex!, 0), points.length - 1) : null;
  // During playback the polyline "draws" up to the current position.
  const drawn = clampedIdx != null ? latlngs.slice(0, clampedIdx + 1) : latlngs;
  const cursor = clampedIdx != null ? points[clampedIdx] : null;

  return (
    <div className="h-[440px] w-full rounded-b-xl overflow-hidden relative z-0">
      <MapContainer center={center} zoom={14} style={{ height: "100%", width: "100%", zIndex: 0 }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={latlngs} />

        {/* Full route ghosted underneath while playing, solid otherwise */}
        {isPlaying && (
          <Polyline positions={latlngs} color="#6366f1" weight={3} opacity={0.2} />
        )}
        <Polyline positions={drawn} color="#6366f1" weight={3} opacity={0.85} />

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

        {/* Playback cursor */}
        {cursor && (
          <CircleMarker
            center={[cursor.latitude, cursor.longitude]}
            radius={9}
            pathOptions={{ color: "#fff", weight: 3, fillColor: "#6366f1", fillOpacity: 1 }}
          >
            <Popup>
              <p className="text-xs font-semibold text-slate-700">
                {new Date(cursor.recordedAt).toLocaleTimeString()}
              </p>
              {cursor.speedMetersPerSecond != null && (
                <p className="text-xs text-slate-500">
                  {(cursor.speedMetersPerSecond * 3.6).toFixed(1)} km/h
                </p>
              )}
            </Popup>
          </CircleMarker>
        )}
      </MapContainer>
    </div>
  );
}
