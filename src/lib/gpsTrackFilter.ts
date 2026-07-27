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
  /** Drop fixes worse than this (meters). Default 80. */
  maxAccuracyM?: number;
  /** Reject segment if implied speed exceeds this (m/s). Default 45 (~162 km/h). */
  maxSpeedMps?: number;
  /** Collapse points closer than this (meters). Default 12. */
  minMoveM?: number;
  /** Also require at least this many ms between kept points when nearly stationary. Default 8s. */
  minIntervalMs?: number;
  /** Soft cap of points kept per device after filtering. Default 1500. */
  maxPoints?: number;
}

/**
 * Clean a chronologically sorted GPS trail:
 * drop mock / low-accuracy fixes, reject teleport jumps, collapse near-duplicates.
 */
export function filterGpsTrack(
  points: RawTrackPoint[],
  opts: TrackFilterOptions = {}
): RawTrackPoint[] {
  const maxAccuracyM = opts.maxAccuracyM ?? 80;
  const maxSpeedMps = opts.maxSpeedMps ?? 45;
  const minMoveM = opts.minMoveM ?? 12;
  const minIntervalMs = opts.minIntervalMs ?? 8_000;
  const maxPoints = opts.maxPoints ?? 1500;

  const cleaned: RawTrackPoint[] = [];

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

    // Collapse stationary / near-duplicate noise.
    if (dist < minMoveM && dtMs < minIntervalMs) continue;

    cleaned.push(p);
  }

  if (cleaned.length <= maxPoints) return cleaned;

  // Uniform downsample while keeping first and last.
  const out: RawTrackPoint[] = [cleaned[0]];
  const step = (cleaned.length - 1) / (maxPoints - 1);
  for (let i = 1; i < maxPoints - 1; i++) {
    out.push(cleaned[Math.round(i * step)]);
  }
  out.push(cleaned[cleaned.length - 1]);
  return out;
}
