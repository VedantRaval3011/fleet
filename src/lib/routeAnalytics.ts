// Shared analytics for Route History: speed bands, idle detection, speeding
// violations, max-speed, per-device colour, and trip statistics.

export interface RoutePoint {
  pointId?: string;
  sessionId?: string;
  sequenceNumber?: number;
  latitude: number;
  longitude: number;
  recordedAt: string;
  speedMetersPerSecond?: number;
  bearingDegrees?: number;
  accuracyMeters?: number;
  altitudeMeters?: number;
  batteryPercent?: number;
  provider?: string;
  isMockLocation?: boolean;
}

export type SpeedBand = "idle" | "normal" | "moderate" | "high";

// Upper bound (km/h, exclusive) for each band; "high" is everything above.
export const SPEED_BANDS: {
  band: SpeedBand;
  label: string;
  maxKmh: number;
  color: string;
}[] = [
  { band: "idle", label: "Idle / Stopped", maxKmh: 3, color: "#3b82f6" },
  { band: "normal", label: "Normal", maxKmh: 40, color: "#10b981" },
  { band: "moderate", label: "Moderate", maxKmh: 70, color: "#f59e0b" },
  { band: "high", label: "High", maxKmh: Infinity, color: "#ef4444" },
];

export const VIOLATION_COLOR = "#dc2626";

export function speedKmh(p: RoutePoint): number {
  return Math.max(0, (p.speedMetersPerSecond ?? 0) * 3.6);
}

export function bandForSpeed(kmh: number): SpeedBand {
  for (const b of SPEED_BANDS) if (kmh < b.maxKmh) return b.band;
  return "high";
}

export function colorForSpeed(kmh: number): string {
  return SPEED_BANDS.find((b) => b.band === bandForSpeed(kmh))!.color;
}

/** Haversine distance in metres. */
export function haversineM(a: RoutePoint, b: RoutePoint): number {
  const R = 6371000;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Bearing in degrees (0=N, 90=E) from a → b. */
export function bearingDeg(a: RoutePoint, b: RoutePoint): number {
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI + 360;
}

/** Heading for a point, preferring reported bearing, else computed from neighbours. */
export function headingAt(points: RoutePoint[], idx: number): number {
  const p = points[idx];
  if (p?.bearingDegrees != null) return p.bearingDegrees;
  const prev = points[idx - 1];
  const next = points[idx + 1];
  if (prev && p) return bearingDeg(prev, p) % 360;
  if (p && next) return bearingDeg(p, next) % 360;
  return 0;
}

// ─── Colored polyline segments (consecutive points grouped by band) ──────────
export interface ColoredSegment {
  color: string;
  band: SpeedBand;
  positions: [number, number][];
}

export function speedSegments(points: RoutePoint[]): ColoredSegment[] {
  if (points.length < 2) return [];
  const segments: ColoredSegment[] = [];
  let current: ColoredSegment | null = null;

  for (let i = 1; i < points.length; i++) {
    const kmh = (speedKmh(points[i - 1]) + speedKmh(points[i])) / 2;
    const band = bandForSpeed(kmh);
    const color = colorForSpeed(kmh);
    const a: [number, number] = [points[i - 1].latitude, points[i - 1].longitude];
    const b: [number, number] = [points[i].latitude, points[i].longitude];

    if (current && current.band === band) {
      current.positions.push(b);
    } else {
      current = { color, band, positions: [a, b] };
      segments.push(current);
    }
  }
  return segments;
}

// ─── Idle events ─────────────────────────────────────────────────────────────
export interface IdleEvent {
  id: string;
  startIdx: number;
  endIdx: number;
  latitude: number;
  longitude: number;
  startTime: string;
  endTime: string;
  durationMs: number;
}

export function detectIdleEvents(
  points: RoutePoint[],
  opts: { minIdleMs?: number; idleSpeedKmh?: number } = {}
): IdleEvent[] {
  const minIdleMs = opts.minIdleMs ?? 3 * 60_000;
  const idleSpeedKmh = opts.idleSpeedKmh ?? 3;
  const events: IdleEvent[] = [];

  let runStart = -1;
  const flush = (endIdx: number) => {
    if (runStart < 0) return;
    const s = points[runStart];
    const e = points[endIdx];
    const durationMs = new Date(e.recordedAt).getTime() - new Date(s.recordedAt).getTime();
    if (durationMs >= minIdleMs) {
      events.push({
        id: `idle-${runStart}-${endIdx}`,
        startIdx: runStart,
        endIdx,
        latitude: s.latitude,
        longitude: s.longitude,
        startTime: s.recordedAt,
        endTime: e.recordedAt,
        durationMs,
      });
    }
    runStart = -1;
  };

  for (let i = 0; i < points.length; i++) {
    const idle = speedKmh(points[i]) <= idleSpeedKmh;
    if (idle) {
      if (runStart < 0) runStart = i;
    } else {
      flush(i - 1 >= 0 ? i - 1 : 0);
    }
  }
  flush(points.length - 1);
  return events;
}

// ─── Speed-limit violations ──────────────────────────────────────────────────
export interface ViolationSegment {
  id: string;
  startIdx: number;
  endIdx: number;
  peakIdx: number;
  peakKmh: number;
  startTime: string;
  endTime: string;
  durationMs: number;
  positions: [number, number][];
}

export function detectViolations(
  points: RoutePoint[],
  limitKmh: number
): ViolationSegment[] {
  if (!limitKmh || limitKmh <= 0) return [];
  const out: ViolationSegment[] = [];
  let start = -1;
  let peakIdx = -1;
  let peak = 0;

  const flush = (endIdx: number) => {
    if (start < 0) return;
    const s = points[start];
    const e = points[endIdx];
    out.push({
      id: `viol-${start}-${endIdx}`,
      startIdx: start,
      endIdx,
      peakIdx,
      peakKmh: peak,
      startTime: s.recordedAt,
      endTime: e.recordedAt,
      durationMs: new Date(e.recordedAt).getTime() - new Date(s.recordedAt).getTime(),
      positions: points.slice(start, endIdx + 1).map((p) => [p.latitude, p.longitude]),
    });
    start = -1;
    peakIdx = -1;
    peak = 0;
  };

  for (let i = 0; i < points.length; i++) {
    const kmh = speedKmh(points[i]);
    if (kmh > limitKmh) {
      if (start < 0) start = i;
      if (kmh > peak) {
        peak = kmh;
        peakIdx = i;
      }
    } else {
      flush(i - 1 >= start ? i - 1 : start);
    }
  }
  flush(points.length - 1);
  return out.filter((v) => v.startIdx >= 0);
}

// ─── Max speed point ─────────────────────────────────────────────────────────
export interface MaxSpeed {
  idx: number;
  kmh: number;
  time: string;
  latitude: number;
  longitude: number;
}

export function maxSpeedPoint(points: RoutePoint[]): MaxSpeed | null {
  let best = -1;
  let bestKmh = -1;
  for (let i = 0; i < points.length; i++) {
    const kmh = speedKmh(points[i]);
    if (kmh > bestKmh) {
      bestKmh = kmh;
      best = i;
    }
  }
  if (best < 0) return null;
  return {
    idx: best,
    kmh: bestKmh,
    time: points[best].recordedAt,
    latitude: points[best].latitude,
    longitude: points[best].longitude,
  };
}

// ─── Trip statistics ─────────────────────────────────────────────────────────
export interface TripStats {
  distanceKm: number;
  totalMs: number;
  idleMs: number;
  drivingMs: number;
  avgKmh: number;
  maxKmh: number;
  stops: number;
}

export function tripStats(points: RoutePoint[], idle: IdleEvent[]): TripStats | null {
  if (points.length === 0) return null;
  let distanceM = 0;
  for (let i = 1; i < points.length; i++) distanceM += haversineM(points[i - 1], points[i]);
  const totalMs =
    new Date(points[points.length - 1].recordedAt).getTime() -
    new Date(points[0].recordedAt).getTime();
  const idleMs = idle.reduce((a, e) => a + e.durationMs, 0);
  const drivingMs = Math.max(0, totalMs - idleMs);
  const speeds = points.map(speedKmh).filter((s) => s >= 0);
  const maxKmh = speeds.length ? Math.max(...speeds) : 0;
  const drivingHours = drivingMs / 3_600_000;
  const avgKmh = drivingHours > 0 ? distanceM / 1000 / drivingHours : 0;
  return {
    distanceKm: distanceM / 1000,
    totalMs,
    idleMs,
    drivingMs,
    avgKmh,
    maxKmh,
    stops: idle.length,
  };
}

export function formatDuration(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// ─── Per-device colour ───────────────────────────────────────────────────────
const DEVICE_PALETTE = [
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#14b8a6", // teal
  "#f97316", // orange
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#22c55e", // green
  "#eab308", // amber
  "#ef4444", // red
  "#06b6d4", // cyan
];

export function deviceColor(deviceId: string): string {
  let hash = 0;
  for (let i = 0; i < deviceId.length; i++) {
    hash = (hash * 31 + deviceId.charCodeAt(i)) | 0;
  }
  return DEVICE_PALETTE[Math.abs(hash) % DEVICE_PALETTE.length];
}
