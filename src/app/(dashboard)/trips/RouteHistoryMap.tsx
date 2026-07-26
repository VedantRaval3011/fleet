"use client";

import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Popup,
  Tooltip,
  ZoomControl,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import {
  type RoutePoint,
  type IdleEvent,
  type ViolationSegment,
  type MaxSpeed,
  speedSegments,
  headingAt,
  speedKmh,
  formatDuration,
  VIOLATION_COLOR,
} from "@/lib/routeAnalytics";

export type LocationPoint = RoutePoint;

export type FocusTarget =
  | { type: "point"; idx: number }
  | { type: "idle"; id: string }
  | { type: "violation"; id: string }
  | { type: "max"; idx: number }
  | { type: "bounds" }
  | null;

interface Props {
  points: LocationPoint[];
  playbackIndex?: number | null;
  emptyCenter?: [number, number];
  deviceColor?: string;
  idleEvents?: IdleEvent[];
  violations?: ViolationSegment[];
  maxSpeed?: MaxSpeed | null;
  speedLimitKmh?: number;
  showIdle?: boolean;
  showViolations?: boolean;
  showMaxSpeed?: boolean;
  focus?: FocusTarget;
  onFocusConsumed?: () => void;
}

function FitBounds({ points, enabled }: { points: [number, number][]; enabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!enabled || points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], Math.max(map.getZoom(), 15));
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [100, 100], maxZoom: 16 });
  }, [map, points, enabled]);
  return null;
}

function FocusController({
  focus,
  points,
  idleEvents,
  violations,
  onConsumed,
}: {
  focus: FocusTarget;
  points: LocationPoint[];
  idleEvents: IdleEvent[];
  violations: ViolationSegment[];
  onConsumed?: () => void;
}) {
  const map = useMap();
  useEffect(() => {
    if (!focus) return;
    let target: [number, number] | null = null;
    if (focus.type === "point" || focus.type === "max") {
      const p = points[focus.idx];
      if (p) target = [p.latitude, p.longitude];
    } else if (focus.type === "idle") {
      const e = idleEvents.find((x) => x.id === focus.id);
      if (e) target = [e.latitude, e.longitude];
    } else if (focus.type === "violation") {
      const v = violations.find((x) => x.id === focus.id);
      if (v) {
        const p = points[v.peakIdx] || points[v.startIdx];
        if (p) target = [p.latitude, p.longitude];
      }
    } else if (focus.type === "bounds" && points.length > 0) {
      const latlngs = points.map((p) => [p.latitude, p.longitude] as [number, number]);
      map.fitBounds(L.latLngBounds(latlngs), { padding: [100, 100], maxZoom: 16 });
      onConsumed?.();
      return;
    }
    if (target) {
      map.flyTo(target, Math.max(map.getZoom(), 16), { duration: 0.6 });
    }
    onConsumed?.();
  }, [focus, map, points, idleEvents, violations, onConsumed]);
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

function arrowIcon(color: string, heading: number, size = 28) {
  const html = `
    <div style="width:${size}px;height:${size}px;transform:rotate(${heading}deg);display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));">
      <svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2 L20 20 L12 16 L4 20 Z" fill="${color}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>
    </div>`;
  return L.divIcon({
    className: "",
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function pinIcon(color: string, glyph: string, size = 26) {
  const html = `
    <div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;font-family:system-ui,sans-serif;">
      ${glyph}
    </div>`;
  return L.divIcon({
    className: "",
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function startIcon() {
  return pinIcon("#10b981", "S", 28);
}
function endIcon() {
  return pinIcon("#ef4444", "E", 28);
}
function idleIcon() {
  return pinIcon("#3b82f6", "⏸", 24);
}
function maxIcon() {
  return pinIcon("#f59e0b", "⚡", 26);
}
function violIcon() {
  return pinIcon(VIOLATION_COLOR, "!", 24);
}

export default function RouteHistoryMap({
  points,
  playbackIndex = null,
  emptyCenter = [20.5937, 78.9629],
  deviceColor = "#6366f1",
  idleEvents = [],
  violations = [],
  maxSpeed = null,
  speedLimitKmh = 0,
  showIdle = true,
  showViolations = true,
  showMaxSpeed = true,
  focus = null,
  onFocusConsumed,
}: Props) {
  const fitOnceKey = useRef<string>("");
  const routeKey = useMemo(
    () => (points.length ? `${points[0].recordedAt}|${points.length}|${points[points.length - 1].recordedAt}` : ""),
    [points]
  );
  const shouldFit = routeKey !== "" && routeKey !== fitOnceKey.current;
  useEffect(() => {
    if (shouldFit) fitOnceKey.current = routeKey;
  }, [shouldFit, routeKey]);

  const latlngs = useMemo<[number, number][]>(
    () => points.map((p) => [p.latitude, p.longitude]),
    [points]
  );

  const center = latlngs[0] || emptyCenter;
  const first = points[0];
  const last = points[points.length - 1];

  const isPlaying = playbackIndex != null;
  const clampedIdx =
    isPlaying && points.length > 0
      ? Math.min(Math.max(playbackIndex!, 0), points.length - 1)
      : null;

  // During playback, only draw segments up to the cursor.
  const visiblePoints = useMemo(
    () => (clampedIdx != null ? points.slice(0, clampedIdx + 1) : points),
    [points, clampedIdx]
  );
  const segments = useMemo(() => speedSegments(visiblePoints), [visiblePoints]);
  const ghostSegments = useMemo(
    () => (isPlaying ? speedSegments(points) : []),
    [isPlaying, points]
  );

  const cursor = clampedIdx != null ? points[clampedIdx] : null;
  const cursorHeading = clampedIdx != null ? headingAt(points, clampedIdx) : 0;
  const staticArrowIdx = points.length > 1 ? points.length - 1 : 0;
  const staticHeading = headingAt(points, staticArrowIdx);

  const violationPolylines = showViolations ? violations : [];

  return (
    <div className="absolute inset-0 z-0 h-full w-full">
      <MapContainer
        center={center}
        zoom={points.length ? 14 : 5}
        style={{ height: "100%", width: "100%" }}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomControl position="bottomright" />
        {latlngs.length > 0 && <FitBounds points={latlngs} enabled={shouldFit} />}
        <FocusController
          focus={focus}
          points={points}
          idleEvents={idleEvents}
          violations={violations}
          onConsumed={onFocusConsumed}
        />

        {points.length > 0 && (
          <>
            {/* Ghost full route while playing */}
            {isPlaying &&
              ghostSegments.map((seg, i) => (
                <Polyline
                  key={`g-${i}`}
                  positions={seg.positions}
                  pathOptions={{ color: seg.color, weight: 3, opacity: 0.2 }}
                />
              ))}

            {/* Speed-colored route */}
            {segments.map((seg, i) => (
              <Polyline
                key={`s-${i}`}
                positions={seg.positions}
                pathOptions={{ color: seg.color, weight: 5, opacity: 0.92, lineCap: "round", lineJoin: "round" }}
              />
            ))}

            {/* Device-color underlay (subtle identity) */}
            <Polyline
              positions={latlngs.slice(0, (clampedIdx ?? latlngs.length - 1) + 1)}
              pathOptions={{ color: deviceColor, weight: 2, opacity: 0.25 }}
            />

            {/* Speeding segments highlight */}
            {violationPolylines.map((v) => (
              <Polyline
                key={v.id}
                positions={v.positions}
                pathOptions={{
                  color: VIOLATION_COLOR,
                  weight: 7,
                  opacity: 0.55,
                  dashArray: "6 8",
                }}
              >
                <Tooltip sticky>
                  <span className="text-xs font-semibold">
                    Speeding · peak {v.peakKmh.toFixed(0)} km/h
                    {speedLimitKmh > 0 ? ` (limit ${speedLimitKmh})` : ""}
                  </span>
                </Tooltip>
                <Popup>
                  <div className="min-w-[180px] font-sans text-xs">
                    <p className="mb-1 font-bold text-rose-700">Speed violation</p>
                    <Row k="Peak" v={`${v.peakKmh.toFixed(1)} km/h`} />
                    {speedLimitKmh > 0 && <Row k="Limit" v={`${speedLimitKmh} km/h`} />}
                    <Row k="Start" v={fmtTime(v.startTime)} />
                    <Row k="End" v={fmtTime(v.endTime)} />
                    <Row k="Duration" v={formatDuration(v.durationMs)} />
                  </div>
                </Popup>
              </Polyline>
            ))}

            {/* Start */}
            {first && (
              <Marker position={[first.latitude, first.longitude]} icon={startIcon()}>
                <Tooltip direction="top" offset={[0, -12]}>
                  Trip start · {fmtTime(first.recordedAt)}
                </Tooltip>
                <Popup>
                  <div className="font-sans text-xs">
                    <p className="mb-1 font-bold text-emerald-700">Trip start</p>
                    <Row k="Time" v={fmtTime(first.recordedAt)} />
                    <Row k="Coords" v={`${first.latitude.toFixed(5)}, ${first.longitude.toFixed(5)}`} />
                  </div>
                </Popup>
              </Marker>
            )}

            {/* End */}
            {points.length > 1 && last && (
              <Marker position={[last.latitude, last.longitude]} icon={endIcon()}>
                <Tooltip direction="top" offset={[0, -12]}>
                  Trip end · {fmtTime(last.recordedAt)}
                </Tooltip>
                <Popup>
                  <div className="font-sans text-xs">
                    <p className="mb-1 font-bold text-rose-700">Trip end</p>
                    <Row k="Time" v={fmtTime(last.recordedAt)} />
                    <Row k="Coords" v={`${last.latitude.toFixed(5)}, ${last.longitude.toFixed(5)}`} />
                  </div>
                </Popup>
              </Marker>
            )}

            {/* Idle markers */}
            {showIdle &&
              idleEvents.map((e) => (
                <Marker key={e.id} position={[e.latitude, e.longitude]} icon={idleIcon()}>
                  <Tooltip direction="top" offset={[0, -10]}>
                    Idle {formatDuration(e.durationMs)}
                  </Tooltip>
                  <Popup>
                    <div className="min-w-[180px] font-sans text-xs">
                      <p className="mb-1 font-bold text-blue-700">Idle / Stopped</p>
                      <Row k="Duration" v={`Idle for ${formatDuration(e.durationMs)}`} />
                      <Row k="Start" v={fmtTime(e.startTime)} />
                      <Row k="End" v={fmtTime(e.endTime)} />
                      <Row k="Location" v={`${e.latitude.toFixed(5)}, ${e.longitude.toFixed(5)}`} />
                    </div>
                  </Popup>
                </Marker>
              ))}

            {/* Max speed */}
            {showMaxSpeed && maxSpeed && maxSpeed.kmh > 0 && (
              <Marker
                position={[maxSpeed.latitude, maxSpeed.longitude]}
                icon={maxIcon()}
              >
                <Tooltip direction="top" offset={[0, -10]}>
                  Max {maxSpeed.kmh.toFixed(0)} km/h
                </Tooltip>
                <Popup>
                  <div className="min-w-[180px] font-sans text-xs">
                    <p className="mb-1 font-bold text-amber-700">Maximum speed</p>
                    <Row k="Speed" v={`${maxSpeed.kmh.toFixed(1)} km/h`} />
                    <Row k="Time" v={fmtTime(maxSpeed.time)} />
                    <Row
                      k="Location"
                      v={`${maxSpeed.latitude.toFixed(5)}, ${maxSpeed.longitude.toFixed(5)}`}
                    />
                  </div>
                </Popup>
              </Marker>
            )}

            {/* Violation peak markers */}
            {showViolations &&
              violations.map((v) => {
                const p = points[v.peakIdx];
                if (!p) return null;
                return (
                  <Marker
                    key={`vm-${v.id}`}
                    position={[p.latitude, p.longitude]}
                    icon={violIcon()}
                  >
                    <Tooltip direction="top" offset={[0, -10]}>
                      {v.peakKmh.toFixed(0)} km/h over limit
                    </Tooltip>
                    <Popup>
                      <div className="min-w-[180px] font-sans text-xs">
                        <p className="mb-1 font-bold text-rose-700">Speed violation</p>
                        <Row k="Actual" v={`${v.peakKmh.toFixed(1)} km/h`} />
                        {speedLimitKmh > 0 && <Row k="Expected" v={`${speedLimitKmh} km/h`} />}
                        <Row k="Time" v={fmtTime(v.startTime)} />
                        <Row k="Duration" v={formatDuration(v.durationMs)} />
                      </div>
                    </Popup>
                  </Marker>
                );
              })}

            {/* Playback / live arrow marker */}
            {cursor ? (
              <Marker
                position={[cursor.latitude, cursor.longitude]}
                icon={arrowIcon(deviceColor, cursorHeading, 32)}
                zIndexOffset={1000}
              >
                <Tooltip direction="top" offset={[0, -14]} permanent={false}>
                  {speedKmh(cursor).toFixed(0)} km/h · {fmtTime(cursor.recordedAt)}
                </Tooltip>
                <Popup>
                  <PointDetails p={cursor} />
                </Popup>
              </Marker>
            ) : (
              points.length > 0 && (
                <Marker
                  position={[points[staticArrowIdx].latitude, points[staticArrowIdx].longitude]}
                  icon={arrowIcon(deviceColor, staticHeading, 30)}
                  zIndexOffset={500}
                >
                  <Tooltip direction="top" offset={[0, -14]}>
                    {speedKmh(points[staticArrowIdx]).toFixed(0)} km/h
                  </Tooltip>
                </Marker>
              )
            )}
          </>
        )}
      </MapContainer>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-slate-500">{k}</span>
      <span className="font-medium text-slate-800">{v}</span>
    </div>
  );
}

function PointDetails({ p }: { p: LocationPoint }) {
  return (
    <div className="min-w-[190px] font-sans text-xs">
      <p className="mb-1.5 font-bold text-slate-900">
        GPS point
        {p.isMockLocation && (
          <span className="ml-1 text-[10px] font-semibold uppercase text-rose-600">mock</span>
        )}
      </p>
      <Row k="Time" v={fmtTime(p.recordedAt)} />
      <Row k="Speed" v={`${speedKmh(p).toFixed(1)} km/h`} />
      {p.batteryPercent != null && <Row k="Battery" v={`${p.batteryPercent}%`} />}
      {p.accuracyMeters != null && <Row k="Accuracy" v={`±${p.accuracyMeters.toFixed(0)} m`} />}
      {p.bearingDegrees != null && <Row k="Bearing" v={`${p.bearingDegrees.toFixed(0)}°`} />}
      <Row k="Coords" v={`${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`} />
    </div>
  );
}
