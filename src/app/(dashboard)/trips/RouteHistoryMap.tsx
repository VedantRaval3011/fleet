"use client";

import { AdvancedMarker, InfoWindow, useMap } from "@vis.gl/react-google-maps";
import { useCallback, useEffect, useMemo, useState } from "react";
import MapShell from "@/components/maps/MapShell";
import { FitBounds, Polyline, type LatLng } from "@/components/maps/overlays";
import {
  type RoutePoint,
  type IdleEvent,
  type ViolationSegment,
  type MaxSpeed,
  speedSegments,
  headingAt,
  speedKmh,
  batteryAt,
  idleEventAt,
  formatDuration,
  formatDurationPrecise,
  cumulativeDistancesM,
  labelForSpeed,
  legAt,
  nearestPointIndex,
  violationAt,
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

/** routeAnalytics works in Leaflet's [lat, lng] tuples; Google wants literals. */
const toLatLng = (p: [number, number]): LatLng => ({ lat: p[0], lng: p[1] });

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
    if (!map || !focus) return;
    let target: LatLng | null = null;

    if (focus.type === "point" || focus.type === "max") {
      const p = points[focus.idx];
      if (p) target = { lat: p.latitude, lng: p.longitude };
    } else if (focus.type === "idle") {
      const e = idleEvents.find((x) => x.id === focus.id);
      if (e) target = { lat: e.latitude, lng: e.longitude };
    } else if (focus.type === "violation") {
      const v = violations.find((x) => x.id === focus.id);
      if (v) {
        const p = points[v.peakIdx] || points[v.startIdx];
        if (p) target = { lat: p.latitude, lng: p.longitude };
      }
    } else if (focus.type === "bounds" && points.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      points.forEach((p) => bounds.extend({ lat: p.latitude, lng: p.longitude }));
      map.fitBounds(bounds, 100);
      onConsumed?.();
      return;
    }

    if (target) {
      map.panTo(target);
      if ((map.getZoom() ?? 0) < 16) map.setZoom(16);
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

/**
 * Direction chevron repeated along the drawn route.
 *
 * Path coordinates are symbol-space (origin at the anchor, -y pointing along the
 * line) and the string form avoids touching `google.maps.SymbolPath` during
 * render, before the Maps library has finished loading.
 */
const DIRECTION_ARROW_PATH = "M 0 -7 L 5 6 L 0 2.5 L -5 6 Z";
/** Pixel spacing between direction arrows — constant on screen at any zoom. */
const DIRECTION_ARROW_REPEAT = "110px";
/**
 * Stroke width of the invisible line that catches route hover and clicks. Wider
 * than the drawn route so a thin line at low zoom is still comfortable to hit,
 * and wide enough to cover the direction arrows drawn on top of it.
 */
const ROUTE_HIT_WEIGHT = 20;

/** Direction-of-travel arrow, rotated to the heading. */
function ArrowGlyph({
  color,
  heading,
  size = 28,
}: {
  color: string;
  heading: number;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        transform: `rotate(${heading}deg)`,
        filter: "drop-shadow(0 1px 2px rgba(0,0,0,.45))",
      }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path
          d="M12 2 L20 20 L12 16 L4 20 Z"
          fill={color}
          stroke="#fff"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function PinGlyph({
  color,
  glyph,
  size = 26,
}: {
  color: string;
  glyph: string;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        border: "2px solid #fff",
        boxShadow: "0 1px 4px rgba(0,0,0,.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: 11,
        fontWeight: 700,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {glyph}
    </div>
  );
}

/** Paused glyph shown in place of the arrow while the cursor sits inside a stop. */
function IdleGlyph({ size = 32 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "#3b82f6",
        border: "3px solid #fff",
        boxShadow: "0 1px 6px rgba(0,0,0,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: size * 0.45,
        fontWeight: 700,
      }}
    >
      ⏸
    </div>
  );
}

type Tone = "good" | "warn" | "bad";

interface Fact {
  k: string;
  v: string;
  tone?: Tone;
}

interface PointReadout {
  title: string;
  /** Short flag shown beside the title — mock fix, logging gap, speeding. */
  badge?: { text: string; tone: Tone };
  facts: Fact[];
}

function batteryTone(pct: number): Tone | undefined {
  if (pct <= 15) return "bad";
  if (pct <= 35) return "warn";
  return undefined;
}

/** Time of day only — for spans, where the date is already established. */
function fmtClock(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtDistance(m: number): string {
  return m < 1000 ? `${m.toFixed(0)} m` : `${(m / 1000).toFixed(2)} km`;
}

/**
 * Everything known about one sample, assembled once and rendered by both the
 * hover card and the click InfoWindow so the two can never drift apart.
 *
 * Rows are omitted rather than shown empty: a route replayed from an older
 * client carries no altitude or battery, and blank rows read as missing data
 * rather than as data the device never sent.
 */
function readoutFor({
  points,
  idx,
  battery,
  idleEvents,
  violations,
  speedLimitKmh,
  cumDistM,
}: {
  points: LocationPoint[];
  idx: number;
  battery: number | null;
  idleEvents: IdleEvent[];
  violations: ViolationSegment[];
  speedLimitKmh: number;
  cumDistM: number[];
}): PointReadout | null {
  const p = points[idx];
  if (!p) return null;

  const idle = idleEventAt(idleEvents, idx);
  const violation = violationAt(violations, idx);
  const leg = legAt(points, idx);
  const kmh = speedKmh(p);
  const startMs = points[0] ? new Date(points[0].recordedAt).getTime() : 0;
  const atMs = new Date(p.recordedAt).getTime();
  const idleElapsedMs = idle
    ? Math.max(0, atMs - new Date(idle.startTime).getTime())
    : 0;

  const facts: Fact[] = [
    { k: "Time", v: fmtTime(p.recordedAt) },
    { k: "Elapsed", v: formatDurationPrecise(Math.max(0, atMs - startMs)) },
    { k: "Speed", v: `${kmh.toFixed(1)} km/h · ${labelForSpeed(kmh)}` },
  ];

  if (leg) {
    // The drawn line is coloured by the speed actually made good over the leg,
    // which is the number the map is showing — spell it out next to the fix's
    // own instantaneous reading so a red stretch under a "0 km/h" point makes
    // sense.
    facts.push({ k: "Segment", v: `${leg.kmh.toFixed(1)} km/h avg` });
    facts.push({
      k: "Leg",
      v: `${fmtDistance(leg.distanceM)} in ${formatDurationPrecise(leg.durationMs)}`,
    });
  }

  facts.push({ k: "Distance", v: fmtDistance(cumDistM[idx] ?? 0) });

  if (battery != null) {
    // batteryAt falls back to the nearest neighbouring reading, so mark a value
    // this fix did not itself carry rather than presenting it as measured here.
    const exact = p.batteryPercent != null;
    facts.push({
      k: "Battery",
      v: `${exact ? "" : "≈ "}${battery}%`,
      tone: batteryTone(battery),
    });
  }

  if (idle) {
    facts.push({
      k: "Idle",
      v: `${formatDurationPrecise(idleElapsedMs)} of ${formatDurationPrecise(idle.durationMs)}`,
      tone: "warn",
    });
  }

  if (violation) {
    facts.push({
      k: "Over limit",
      v: `peak ${violation.peakKmh.toFixed(1)} km/h${speedLimitKmh > 0 ? ` vs ${speedLimitKmh}` : ""}`,
      tone: "bad",
    });
    facts.push({
      k: "Speeding",
      v: `${fmtClock(violation.startTime)} → ${fmtClock(violation.endTime)} · ${formatDuration(violation.durationMs)}`,
      tone: "bad",
    });
  }

  facts.push({ k: "Heading", v: `${headingAt(points, idx).toFixed(0)}°` });
  if (p.bearingDegrees != null)
    facts.push({ k: "Bearing", v: `${p.bearingDegrees.toFixed(0)}° reported` });
  if (p.accuracyMeters != null)
    facts.push({
      k: "Accuracy",
      v: `±${p.accuracyMeters.toFixed(0)} m`,
      tone: p.accuracyMeters > 50 ? "warn" : undefined,
    });
  if (p.altitudeMeters != null)
    facts.push({ k: "Altitude", v: `${p.altitudeMeters.toFixed(0)} m` });
  if (p.provider) facts.push({ k: "Source", v: p.provider });
  facts.push({ k: "Coords", v: `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}` });
  facts.push({
    k: "Point",
    v: `${idx + 1} of ${points.length}${p.sequenceNumber != null ? ` · #${p.sequenceNumber}` : ""}`,
  });

  const badge: PointReadout["badge"] | undefined = p.isMockLocation
    ? { text: "mock", tone: "bad" }
    : violation
      ? { text: "speeding", tone: "bad" }
      : leg?.isGap
        ? { text: "gap", tone: "warn" }
        : idle
          ? { text: "stopped", tone: "warn" }
          : undefined;

  return {
    title: idle ? "Stopped here" : violation ? "Speeding here" : "GPS point",
    badge,
    facts,
  };
}

const DARK_TONE: Record<Tone, string> = {
  good: "text-emerald-300",
  warn: "text-amber-300",
  bad: "text-rose-300",
};
const LIGHT_TONE: Record<Tone, string> = {
  good: "text-emerald-600",
  warn: "text-amber-600",
  bad: "text-rose-600",
};

/**
 * Dark readout card. Rendered inside marker DOM rather than an InfoWindow so
 * hovering cannot flicker: the card is a child of the element being hovered, so
 * it never steals the pointer from it.
 */
function HoverCard({ readout }: { readout: PointReadout }) {
  return (
    <div className="w-max min-w-49 rounded-lg bg-slate-900/95 px-2.5 py-2 font-sans text-[11px] leading-tight text-white shadow-lg">
      <p className="mb-1 flex items-center gap-1.5 border-b border-white/10 pb-1 font-semibold">
        {readout.title}
        {readout.badge && (
          <span
            className={`text-[9px] font-bold uppercase tracking-wide ${DARK_TONE[readout.badge.tone]}`}
          >
            {readout.badge.text}
          </span>
        )}
      </p>
      {readout.facts.map((f) => (
        <DarkRow key={f.k} k={f.k} v={f.v} tone={f.tone} />
      ))}
    </div>
  );
}

/** Hover card anchored above the marker it belongs to, revealed on hover. */
function MarkerHoverCard({ readout }: { readout: PointReadout }) {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 group-hover:block">
      <HoverCard readout={readout} />
      <div className="mx-auto h-0 w-0 border-x-[5px] border-t-[5px] border-x-transparent border-t-slate-900/95" />
    </div>
  );
}

/** The same readout on the light InfoWindow surface, for a clicked point. */
function ReadoutList({ readout }: { readout: PointReadout }) {
  return (
    <div className="min-w-52 font-sans text-xs">
      <p className="mb-1.5 flex items-center gap-1.5 font-bold text-slate-900">
        {readout.title}
        {readout.badge && (
          <span
            className={`text-[10px] font-semibold uppercase ${LIGHT_TONE[readout.badge.tone]}`}
          >
            {readout.badge.text}
          </span>
        )}
      </p>
      {readout.facts.map((f) => (
        <Row key={f.k} k={f.k} v={f.v} tone={f.tone} />
      ))}
    </div>
  );
}

function DarkRow({ k, v, tone }: { k: string; v: string; tone?: Tone }) {
  return (
    <div className="flex justify-between gap-3 py-[1px]">
      <span className="text-slate-400">{k}</span>
      <span className={`font-semibold ${tone ? DARK_TONE[tone] : "text-white"}`}>{v}</span>
    </div>
  );
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
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  /** Sample under the pointer while the route itself is hovered. */
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  /** Sample kept open after a click on the route, until it is dismissed. */
  const [pinnedIdx, setPinnedIdx] = useState<number | null>(null);

  const routeKey = useMemo(
    () =>
      points.length
        ? `${points[0].recordedAt}|${points.length}|${points[points.length - 1].recordedAt}`
        : "",
    [points]
  );

  // Hover and click hold sample indices, which mean nothing once a different
  // route is loaded — drop them as the route changes rather than in an effect,
  // so no frame ever renders a readout against the wrong points.
  const [lastRouteKey, setLastRouteKey] = useState(routeKey);
  if (routeKey !== lastRouteKey) {
    setLastRouteKey(routeKey);
    setHoverIdx(null);
    setPinnedIdx(null);
  }

  const latlngs = useMemo<LatLng[]>(
    () => points.map((p) => ({ lat: p.latitude, lng: p.longitude })),
    [points]
  );

  const center = latlngs[0] || { lat: emptyCenter[0], lng: emptyCenter[1] };
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

  /** The marker index the hover readout describes — playback cursor or route end. */
  const readoutIdx = clampedIdx ?? staticArrowIdx;
  const readoutPoint = points[readoutIdx] ?? null;
  const readoutBattery = useMemo(
    () => (points.length ? batteryAt(points, readoutIdx) : null),
    [points, readoutIdx]
  );
  const cursorIdle = useMemo(
    () => (clampedIdx != null ? idleEventAt(idleEvents, clampedIdx) : null),
    [idleEvents, clampedIdx]
  );
  const cursorIdleElapsedMs =
    cursorIdle && cursor
      ? Math.max(
          0,
          new Date(cursor.recordedAt).getTime() - new Date(cursorIdle.startTime).getTime()
        )
      : 0;

  // Arrows ride the drawn path itself, so their direction comes from the route
  // geometry and stays correct through and after every stop.
  const arrowPath = useMemo(
    () => visiblePoints.map((p) => ({ lat: p.latitude, lng: p.longitude })),
    [visiblePoints]
  );
  /** The route as actually drawn — the arrows and the hover hit line share it. */
  const drawnLatLngs = arrowPath;
  const directionIcons = useMemo(
    () => [
      {
        icon: {
          path: DIRECTION_ARROW_PATH,
          fillColor: deviceColor,
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 1.2,
          scale: 1,
        },
        offset: "0",
        repeat: DIRECTION_ARROW_REPEAT,
      },
    ],
    [deviceColor]
  );

  const violationPolylines = showViolations ? violations : [];

  // ─── Route hover / click readouts ──────────────────────────────────────────
  // Distances are cumulative over the whole route, so they are built once per
  // route rather than re-walked on every pointer move.
  const cumDistM = useMemo(() => cumulativeDistancesM(points), [points]);

  const buildReadout = useCallback(
    (idx: number) =>
      readoutFor({
        points,
        idx,
        battery: batteryAt(points, idx),
        idleEvents,
        violations,
        speedLimitKmh,
        cumDistM,
      }),
    [points, idleEvents, violations, speedLimitKmh, cumDistM]
  );

  /**
   * Pointer position on the drawn line resolved back to the sample it belongs
   * to. The line is a rendering of the samples, not a surveyed path, so the
   * nearest fix is the point whose data the user is asking about.
   */
  const idxAtEvent = useCallback(
    (e: google.maps.PolyMouseEvent): number | null => {
      const ll = e.latLng;
      if (!ll || visiblePoints.length === 0) return null;
      // Search only the drawn portion — during playback the rest of the route
      // is not on screen, and a leg that doubles back would otherwise report a
      // point the user cannot see. Indices match `points`, which it prefixes.
      const idx = nearestPointIndex(visiblePoints, ll.lat(), ll.lng());
      return idx >= 0 ? idx : null;
    },
    [visiblePoints]
  );

  const handleRouteMove = useCallback(
    (e: google.maps.PolyMouseEvent) => {
      const idx = idxAtEvent(e);
      // Only re-render when the described sample actually changes; a pointer
      // move within one sample's stretch of line is not new information.
      setHoverIdx((prev) => (prev === idx ? prev : idx));
    },
    [idxAtEvent]
  );

  const handleRouteClick = useCallback(
    (e: google.maps.PolyMouseEvent) => {
      const idx = idxAtEvent(e);
      if (idx == null) return;
      setPinnedIdx(idx);
      setOpenInfo(null);
    },
    [idxAtEvent]
  );

  const hoverReadout = hoverIdx != null ? buildReadout(hoverIdx) : null;
  const hoverPoint = hoverIdx != null ? points[hoverIdx] : null;
  const pinnedReadout = pinnedIdx != null ? buildReadout(pinnedIdx) : null;
  const pinnedPoint = pinnedIdx != null ? points[pinnedIdx] : null;
  const cursorReadout = readoutPoint ? buildReadout(readoutIdx) : null;

  return (
    <MapShell defaultCenter={center} defaultZoom={points.length ? 14 : 5}>
      {latlngs.length > 0 && (
        <FitBounds
          points={latlngs}
          enabled
          fitOnceKey={routeKey}
          padding={100}
          maxZoom={16}
        />
      )}
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
                path={seg.positions.map(toLatLng)}
                strokeColor={seg.color}
                strokeWeight={3}
                strokeOpacity={0.2}
              />
            ))}

          {/* Device-color underlay — one unbroken line so the route always reads
              as continuous even where the speed bands change or a stop sits. */}
          <Polyline
            path={latlngs.slice(0, (clampedIdx ?? latlngs.length - 1) + 1)}
            strokeColor={deviceColor}
            strokeWeight={7}
            strokeOpacity={0.35}
          />

          {/* Speed-colored route */}
          {segments.map((seg, i) =>
            seg.isGap ? (
              // Logging gap: the vehicle travelled untracked, so show the join
              // dashed rather than implying a surveyed leg.
              <Polyline
                key={`s-${i}`}
                path={seg.positions.map(toLatLng)}
                strokeColor={seg.color}
                strokeWeight={0}
                strokeOpacity={0}
                icons={[
                  {
                    icon: { path: "M 0,-1 0,1", strokeOpacity: 0.7, strokeWeight: 4, scale: 3 },
                    offset: "0",
                    repeat: "14px",
                  },
                ]}
              />
            ) : (
              <Polyline
                key={`s-${i}`}
                path={seg.positions.map(toLatLng)}
                strokeColor={seg.color}
                strokeWeight={5}
                strokeOpacity={0.92}
              />
            )
          )}

          {/* Direction-of-travel arrows spaced along the whole drawn route */}
          {arrowPath.length > 1 && (
            <Polyline
              path={arrowPath}
              strokeOpacity={0}
              strokeWeight={0}
              icons={directionIcons}
              zIndex={3}
            />
          )}

          {/* Speeding segments highlight. Not clickable itself — the hit line
              below covers the whole route and reports the speeding stretch as
              part of the point's own readout. */}
          {violationPolylines.map((v) => (
            <Polyline
              key={v.id}
              path={v.positions.map(toLatLng)}
              strokeColor={VIOLATION_COLOR}
              strokeWeight={7}
              strokeOpacity={0.55}
            />
          ))}

          {/* Invisible hit line over the drawn route.
              Wide and topmost so hovering or clicking anywhere along the route
              — including on the direction arrows riding it — resolves to the
              sample under the pointer. Kept separate from the coloured segments
              so hit-testing is one continuous path rather than per-band pieces
              with gaps at the joins. */}
          {drawnLatLngs.length > 1 && (
            <Polyline
              path={drawnLatLngs}
              strokeColor="#000000"
              // Not fully transparent: a 0-opacity stroke is not reliably
              // hit-tested, and 1% of black under a 20px line is invisible.
              strokeOpacity={0.01}
              strokeWeight={ROUTE_HIT_WEIGHT}
              zIndex={10}
              onMouseMove={handleRouteMove}
              onMouseOut={() => setHoverIdx(null)}
              onClick={handleRouteClick}
            />
          )}

          {/* Hover readout — pointer-events-none so the card cannot pull the
              pointer off the line it describes and flicker itself away. */}
          {hoverPoint && hoverReadout && hoverIdx !== pinnedIdx && (
            <AdvancedMarker
              position={{ lat: hoverPoint.latitude, lng: hoverPoint.longitude }}
              className="pointer-events-none"
              zIndex={2000}
            >
              {/* Marker content is anchored by its bottom edge, so the column
                  is nudged down by half the dot to sit on the sample itself. */}
              <div
                className="pointer-events-none relative flex flex-col items-center"
                style={{ transform: "translateY(5px)" }}
              >
                <HoverCard readout={hoverReadout} />
                <div className="h-0 w-0 border-x-[5px] border-t-[5px] border-x-transparent border-t-slate-900/95" />
                <span
                  className="mt-0.5 block h-2.5 w-2.5 rounded-full border-2 border-white shadow"
                  style={{ backgroundColor: deviceColor }}
                />
              </div>
            </AdvancedMarker>
          )}

          {/* Clicked point — stays open until dismissed, so the numbers can be
              read and copied without holding the pointer still. */}
          {pinnedPoint && pinnedReadout && (
            <>
              <AdvancedMarker
                position={{ lat: pinnedPoint.latitude, lng: pinnedPoint.longitude }}
                zIndex={1500}
                onClick={() => setPinnedIdx(null)}
              >
                <span
                  className="block h-3.5 w-3.5 rounded-full border-2 border-white shadow-md"
                  style={{ backgroundColor: deviceColor, transform: "translateY(7px)" }}
                />
              </AdvancedMarker>
              <InfoWindow
                position={{ lat: pinnedPoint.latitude, lng: pinnedPoint.longitude }}
                pixelOffset={[0, -12]}
                onCloseClick={() => setPinnedIdx(null)}
              >
                <ReadoutList readout={pinnedReadout} />
              </InfoWindow>
            </>
          )}

          {/* Start */}
          {first && (
            <>
              <AdvancedMarker
                position={{ lat: first.latitude, lng: first.longitude }}
                title={`Trip start · ${fmtTime(first.recordedAt)}`}
                onClick={() => setOpenInfo("start")}
              >
                <PinGlyph color="#10b981" glyph="S" size={28} />
              </AdvancedMarker>
              {openInfo === "start" && (
                <InfoWindow
                  position={{ lat: first.latitude, lng: first.longitude }}
                  onCloseClick={() => setOpenInfo(null)}
                >
                  <div className="font-sans text-xs">
                    <p className="mb-1 font-bold text-emerald-700">Trip start</p>
                    <Row k="Time" v={fmtTime(first.recordedAt)} />
                    <Row
                      k="Coords"
                      v={`${first.latitude.toFixed(5)}, ${first.longitude.toFixed(5)}`}
                    />
                  </div>
                </InfoWindow>
              )}
            </>
          )}

          {/* End */}
          {points.length > 1 && last && (
            <>
              <AdvancedMarker
                position={{ lat: last.latitude, lng: last.longitude }}
                title={`Trip end · ${fmtTime(last.recordedAt)}`}
                onClick={() => setOpenInfo("end")}
              >
                <PinGlyph color="#ef4444" glyph="E" size={28} />
              </AdvancedMarker>
              {openInfo === "end" && (
                <InfoWindow
                  position={{ lat: last.latitude, lng: last.longitude }}
                  onCloseClick={() => setOpenInfo(null)}
                >
                  <div className="font-sans text-xs">
                    <p className="mb-1 font-bold text-rose-700">Trip end</p>
                    <Row k="Time" v={fmtTime(last.recordedAt)} />
                    <Row
                      k="Coords"
                      v={`${last.latitude.toFixed(5)}, ${last.longitude.toFixed(5)}`}
                    />
                  </div>
                </InfoWindow>
              )}
            </>
          )}

          {/* Idle markers */}
          {showIdle &&
            idleEvents.map((e) => (
              <span key={e.id}>
                <AdvancedMarker
                  position={{ lat: e.latitude, lng: e.longitude }}
                  title={`Idle ${formatDuration(e.durationMs)}`}
                  onClick={() => setOpenInfo(`idle:${e.id}`)}
                >
                  <PinGlyph color="#3b82f6" glyph="⏸" size={24} />
                </AdvancedMarker>
                {openInfo === `idle:${e.id}` && (
                  <InfoWindow
                    position={{ lat: e.latitude, lng: e.longitude }}
                    onCloseClick={() => setOpenInfo(null)}
                  >
                    <div className="min-w-[180px] font-sans text-xs">
                      <p className="mb-1 font-bold text-blue-700">Idle / Stopped</p>
                      <Row k="Duration" v={`Idle for ${formatDurationPrecise(e.durationMs)}`} />
                      {batteryAt(points, e.startIdx) != null && (
                        <Row k="Battery" v={`${batteryAt(points, e.startIdx)}%`} />
                      )}
                      <Row k="Start" v={fmtTime(e.startTime)} />
                      <Row k="End" v={fmtTime(e.endTime)} />
                      <Row
                        k="Location"
                        v={`${e.latitude.toFixed(5)}, ${e.longitude.toFixed(5)}`}
                      />
                    </div>
                  </InfoWindow>
                )}
              </span>
            ))}

          {/* Max speed */}
          {showMaxSpeed && maxSpeed && maxSpeed.kmh > 0 && (
            <>
              <AdvancedMarker
                position={{ lat: maxSpeed.latitude, lng: maxSpeed.longitude }}
                title={`Max ${maxSpeed.kmh.toFixed(0)} km/h`}
                onClick={() => setOpenInfo("max")}
              >
                <PinGlyph color="#f59e0b" glyph="⚡" size={26} />
              </AdvancedMarker>
              {openInfo === "max" && (
                <InfoWindow
                  position={{ lat: maxSpeed.latitude, lng: maxSpeed.longitude }}
                  onCloseClick={() => setOpenInfo(null)}
                >
                  <div className="min-w-[180px] font-sans text-xs">
                    <p className="mb-1 font-bold text-amber-700">Maximum speed</p>
                    <Row k="Speed" v={`${maxSpeed.kmh.toFixed(1)} km/h`} />
                    <Row k="Time" v={fmtTime(maxSpeed.time)} />
                    <Row
                      k="Location"
                      v={`${maxSpeed.latitude.toFixed(5)}, ${maxSpeed.longitude.toFixed(5)}`}
                    />
                  </div>
                </InfoWindow>
              )}
            </>
          )}

          {/* Violation peak markers */}
          {showViolations &&
            violations.map((v) => {
              const p = points[v.peakIdx];
              if (!p) return null;
              return (
                <span key={`vm-${v.id}`}>
                  <AdvancedMarker
                    position={{ lat: p.latitude, lng: p.longitude }}
                    title={`${v.peakKmh.toFixed(0)} km/h over limit`}
                    onClick={() => setOpenInfo(`vp:${v.id}`)}
                  >
                    <PinGlyph color={VIOLATION_COLOR} glyph="!" size={24} />
                  </AdvancedMarker>
                  {openInfo === `vp:${v.id}` && (
                    <InfoWindow
                      position={{ lat: p.latitude, lng: p.longitude }}
                      onCloseClick={() => setOpenInfo(null)}
                    >
                      <div className="min-w-[180px] font-sans text-xs">
                        <p className="mb-1 font-bold text-rose-700">Speed violation</p>
                        <Row k="Actual" v={`${v.peakKmh.toFixed(1)} km/h`} />
                        {speedLimitKmh > 0 && <Row k="Expected" v={`${speedLimitKmh} km/h`} />}
                        <Row k="Time" v={fmtTime(v.startTime)} />
                        <Row k="Duration" v={formatDuration(v.durationMs)} />
                      </div>
                    </InfoWindow>
                  )}
                </span>
              );
            })}

          {/* Playback / live cursor — full point readout on hover */}
          {readoutPoint && cursorReadout && (
            <>
              <AdvancedMarker
                position={{ lat: readoutPoint.latitude, lng: readoutPoint.longitude }}
                title={[
                  `${speedKmh(readoutPoint).toFixed(0)} km/h`,
                  fmtTime(readoutPoint.recordedAt),
                  readoutBattery != null ? `${readoutBattery}% battery` : null,
                  cursorIdle ? `idle ${formatDurationPrecise(cursorIdleElapsedMs)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                zIndex={cursor ? 1000 : 500}
                onClick={() => setOpenInfo("cursor")}
              >
                <div className="group relative flex items-center justify-center">
                  <MarkerHoverCard readout={cursorReadout} />
                  {cursorIdle ? (
                    <IdleGlyph size={30} />
                  ) : (
                    <ArrowGlyph
                      color={deviceColor}
                      heading={cursor ? cursorHeading : staticHeading}
                      size={cursor ? 32 : 30}
                    />
                  )}
                </div>
              </AdvancedMarker>
              {openInfo === "cursor" && (
                <InfoWindow
                  position={{ lat: readoutPoint.latitude, lng: readoutPoint.longitude }}
                  onCloseClick={() => setOpenInfo(null)}
                >
                  <ReadoutList readout={cursorReadout} />
                </InfoWindow>
              )}
            </>
          )}
        </>
      )}
    </MapShell>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: Tone }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-slate-500">{k}</span>
      <span className={`font-medium ${tone ? LIGHT_TONE[tone] : "text-slate-800"}`}>{v}</span>
    </div>
  );
}
