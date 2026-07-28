/** GPS trail cleanup for live fleet-map polylines. */

export interface RawTrackPoint {
  lat: number;
  lng: number;
  recordedAt: Date | string;
  speed?: number;
  accuracyMeters?: number | null;
  isMockLocation?: boolean | null;
}

const EARTH_R = 6_371_000;

export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export interface TrackFilterOptions {
  /** Drop fixes worse than this (meters). Default 50 — above this a fix is wifi/cell derived. */
  maxAccuracyM?: number;
  /** Reject segment if implied speed exceeds this (m/s). Default 45 (~162 km/h). */
  maxSpeedMps?: number;
  /** Collapse points closer than this (meters). Default 12. */
  minMoveM?: number;
  /** While stationary, keep at most one point per this many ms. Default 5min. */
  stationaryHoldMs?: number;
  /** Out-and-back excursion longer than this is a spike, not travel (meters). Default 60. */
  spikeExcursionM?: number;
  /** Soft cap of points kept per device after filtering. Default 1500. */
  maxPoints?: number;
}

/**
 * Clean a chronologically sorted GPS trail:
 * drop mock / low-accuracy fixes, reject teleport jumps, collapse near-duplicates.
 */
export function filterGpsTrack<T extends RawTrackPoint>(
  points: T[],
  opts: TrackFilterOptions = {}
): T[] {
  const maxAccuracyM = opts.maxAccuracyM ?? 50;
  const maxSpeedMps = opts.maxSpeedMps ?? 45;
  const minMoveM = opts.minMoveM ?? 12;
  const stationaryHoldMs = opts.stationaryHoldMs ?? 5 * 60_000;
  const spikeExcursionM = opts.spikeExcursionM ?? 60;
  const maxPoints = opts.maxPoints ?? 1500;

  const cleaned: T[] = [];

  for (const p of points) {
    if (p.lat == null || p.lng == null) continue;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (p.isMockLocation) continue;
    if (p.accuracyMeters != null && p.accuracyMeters > maxAccuracyM) continue;

    const t = new Date(p.recordedAt).getTime();
    if (!Number.isFinite(t)) continue;

    const prev = cleaned[cleaned.length - 1];
    if (!prev) {
      cleaned.push(p);
      continue;
    }

    const prevT = new Date(prev.recordedAt).getTime();
    const dtMs = Math.max(0, t - prevT);
    const dist = haversineMeters(prev.lat, prev.lng, p.lat, p.lng);

    // Impossible jump (teleport) — skip outlier; keep previous good fix.
    if (dtMs > 0) {
      const speed = dist / (dtMs / 1000);
      if (speed > maxSpeedMps && dist > 80) continue;
    } else if (dist > 80) {
      continue;
    }

    // Collapse stationary / near-duplicate noise. A parked vehicle reports every
    // 20s, so gating on the interval alone let the whole standstill through —
    // only a real move, or a long-stop keepalive, produces a new point.
    if (dist < minMoveM && dtMs < stationaryHoldMs) continue;

    cleaned.push(p);
  }

  const deSpiked = removeSpikes(cleaned, spikeExcursionM, minMoveM);

  if (deSpiked.length <= maxPoints) return deSpiked;

  // Uniform downsample while keeping first and last.
  const out: T[] = [deSpiked[0]];
  const step = (deSpiked.length - 1) / (maxPoints - 1);
  for (let i = 1; i < maxPoints - 1; i++) {
    out.push(deSpiked[Math.round(i * step)]);
  }
  out.push(deSpiked[deSpiked.length - 1]);
  return out;
}

/**
 * Drop out-and-back excursions — the "spider web" legs on the fleet map.
 *
 * A bad fix moves hundreds of metres away and the next good fix comes straight
 * back, so the neighbours of the outlier are close to each other. The implied
 * speed can stay under the teleport threshold (500m over a 20s parked sample is
 * only 25 m/s), which is why this needs its own geometric test.
 */
function removeSpikes<T extends RawTrackPoint>(
  points: T[],
  excursionM: number,
  minMoveM: number
): T[] {
  if (points.length < 3) return points;

  const out: T[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    const next = points[i + 1];

    const outbound = haversineMeters(prev.lat, prev.lng, cur.lat, cur.lng);
    const back = haversineMeters(cur.lat, cur.lng, next.lat, next.lng);
    const through = haversineMeters(prev.lat, prev.lng, next.lat, next.lng);

    // Went far and returned to where it started: not a path, an error.
    if (outbound > excursionM && back > excursionM && through < minMoveM * 2) {
      continue;
    }
    out.push(cur);
  }
  out.push(points[points.length - 1]);
  return out;
}
