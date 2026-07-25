"use client";

import { MapContainer, TileLayer, Polyline, Marker, Popup, CircleMarker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";

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

export interface LocationPoint {
  pointId: string;
  sessionId: string;
  sequenceNumber: number;
  latitude: number;
  longitude: number;
  recordedAt: string;
  speedMetersPerSecond?: number;
  accuracyMeters?: number;
  bearingDegrees?: number;
  altitudeMeters?: number;
  batteryPercent?: number;
  provider?: string;
  isMockLocation?: boolean;
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
    map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 16 });
  }, [map, points]);
  return null;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "short",
  });
}

export default function RouteHistoryMap({ points, playbackIndex = null }: Props) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  // Reset the inspected point whenever the route changes (adjust-state-during-render).
  const [prevPoints, setPrevPoints] = useState(points);
  if (prevPoints !== points) {
    setPrevPoints(points);
    setSelectedIdx(null);
  }

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
  const drawn = clampedIdx != null ? latlngs.slice(0, clampedIdx + 1) : latlngs;
  const cursor = clampedIdx != null ? points[clampedIdx] : null;

  // Find the route point nearest to a clicked coordinate.
  const nearestIdx = (lat: number, lng: number) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = (points[i].latitude - lat) ** 2 + (points[i].longitude - lng) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  const selected = selectedIdx != null ? points[selectedIdx] : null;

  return (
    <div className="h-full w-full relative z-0">
      <MapContainer center={center} zoom={14} style={{ height: "100%", width: "100%", zIndex: 0 }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={latlngs} />

        {/* Full route ghosted underneath while playing */}
        {isPlaying && <Polyline positions={latlngs} color="#6366f1" weight={3} opacity={0.2} />}

        {/* Wide invisible hit-area to make the route easy to click */}
        <Polyline
          positions={latlngs}
          pathOptions={{ color: "#000", opacity: 0, weight: 18 }}
          eventHandlers={{
            click: (e) => setSelectedIdx(nearestIdx(e.latlng.lat, e.latlng.lng)),
          }}
        />

        {/* Visible route */}
        <Polyline
          positions={drawn}
          color="#6366f1"
          weight={4}
          opacity={0.9}
          eventHandlers={{
            click: (e) => setSelectedIdx(nearestIdx(e.latlng.lat, e.latlng.lng)),
          }}
        />

        {/* Start marker */}
        <Marker position={[first.latitude, first.longitude]}>
          <Popup>
            <p className="font-bold text-emerald-700">Start</p>
            <p className="text-xs text-slate-500">{fmtTime(first.recordedAt)}</p>
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
              <p className="text-xs text-slate-500">{fmtTime(last.recordedAt)}</p>
            </Popup>
          </CircleMarker>
        )}

        {/* Inspected point */}
        {selected && (
          <>
            <CircleMarker
              center={[selected.latitude, selected.longitude]}
              radius={7}
              pathOptions={{ color: "#fff", weight: 2, fillColor: "#f59e0b", fillOpacity: 1 }}
            />
            <Popup
              position={[selected.latitude, selected.longitude]}
              eventHandlers={{ remove: () => setSelectedIdx(null) }}
            >
              <PointDetails p={selected} />
            </Popup>
          </>
        )}

        {/* Playback cursor */}
        {cursor && (
          <CircleMarker
            center={[cursor.latitude, cursor.longitude]}
            radius={9}
            pathOptions={{ color: "#fff", weight: 3, fillColor: "#6366f1", fillOpacity: 1 }}
          >
            <Popup>
              <PointDetails p={cursor} />
            </Popup>
          </CircleMarker>
        )}
      </MapContainer>
    </div>
  );
}

function PointDetails({ p }: { p: LocationPoint }) {
  const rows: [string, string][] = [];
  rows.push(["Time", fmtTime(p.recordedAt)]);
  if (p.speedMetersPerSecond != null) rows.push(["Speed", `${(p.speedMetersPerSecond * 3.6).toFixed(1)} km/h`]);
  if (p.batteryPercent != null) rows.push(["Battery", `${p.batteryPercent}%`]);
  if (p.accuracyMeters != null) rows.push(["Accuracy", `±${p.accuracyMeters.toFixed(0)} m`]);
  if (p.altitudeMeters != null) rows.push(["Altitude", `${p.altitudeMeters.toFixed(0)} m`]);
  if (p.bearingDegrees != null) rows.push(["Bearing", `${p.bearingDegrees.toFixed(0)}°`]);
  if (p.provider) rows.push(["Provider", p.provider]);
  rows.push(["Point", `#${p.sequenceNumber}`]);
  rows.push(["Coords", `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`]);

  return (
    <div className="font-sans min-w-[190px]">
      <p className="font-bold text-slate-900 mb-1.5 flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
        GPS point
        {p.isMockLocation && (
          <span className="ml-1 text-[10px] font-semibold text-rose-600 uppercase">mock</span>
        )}
      </p>
      <table className="text-xs">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="pr-3 py-0.5 text-slate-500 align-top whitespace-nowrap">{k}</td>
              <td className="py-0.5 text-slate-800 font-medium">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
