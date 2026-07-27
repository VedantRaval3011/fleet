import type { RawTrackPoint } from "@/lib/gpsTrackFilter";
import { haversineMeters } from "@/lib/gpsTrackFilter";

export type LatLng = { lat: number; lng: number };

const DEFAULT_OSRM = "https://router.project-osrm.org";
const CHUNK = 80;
const MATCH_MIN_SPACING_M = 35;
const CACHE_TTL_MS = 25_000;

type CacheEntry = { route: LatLng[]; expires: number };
const routeCache = new Map<string, CacheEntry>();

function osrmBase(): string {
  return (process.env.OSRM_URL || DEFAULT_OSRM).replace(/\/$/, "");
}

/** Space points so OSRM map-matching has a clean driving trace. */
function thinForMatch(points: RawTrackPoint[], minM = MATCH_MIN_SPACING_M): RawTrackPoint[] {
  if (points.length <= 2) return points;
  const out: RawTrackPoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1];
    const p = points[i];
    if (haversineMeters(prev.lat, prev.lng, p.lat, p.lng) >= minM) out.push(p);
  }
  const last = points[points.length - 1];
  const prev = out[out.length - 1];
  if (prev !== last) {
    if (haversineMeters(prev.lat, prev.lng, last.lat, last.lng) < 5) {
      out[out.length - 1] = last;
    } else {
      out.push(last);
    }
  }
  return out;
}

function cacheKey(deviceId: string, points: RawTrackPoint[]): string {
  const first = points[0];
  const last = points[points.length - 1];
  return [
    deviceId,
    points.length,
    new Date(first.recordedAt).getTime(),
    new Date(last.recordedAt).getTime(),
    last.lat.toFixed(5),
    last.lng.toFixed(5),
  ].join(":");
}

async function matchChunk(points: RawTrackPoint[]): Promise<LatLng[] | null> {
  if (points.length < 2) return null;

  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const timestamps = points
    .map((p) => Math.floor(new Date(p.recordedAt).getTime() / 1000))
    .join(";");
  const radiuses = points
    .map((p) => {
      const acc = p.accuracyMeters != null && p.accuracyMeters > 0 ? p.accuracyMeters : 25;
      return Math.min(Math.max(acc, 15), 60);
    })
    .join(";");

  const url =
    `${osrmBase()}/match/v1/driving/${coords}` +
    `?overview=full&geometries=geojson&tidy=true&gaps=ignore` +
    `&timestamps=${timestamps}&radiuses=${radiuses}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code?: string;
      matchings?: { geometry?: { coordinates?: [number, number][] } }[];
    };
    if (data.code !== "Ok" || !data.matchings?.length) return null;

    const route: LatLng[] = [];
    for (const m of data.matchings) {
      const coordsGeo = m.geometry?.coordinates;
      if (!coordsGeo?.length) continue;
      for (const [lng, lat] of coordsGeo) {
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const prev = route[route.length - 1];
        if (prev && prev.lat === lat && prev.lng === lng) continue;
        route.push({ lat, lng });
      }
    }
    return route.length >= 2 ? route : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Snap a filtered GPS trail onto the road network (OSRM map matching).
 * Returns null if matching fails — caller should fall back to raw GPS.
 */
export async function snapTrackToRoads(
  deviceId: string,
  points: RawTrackPoint[]
): Promise<LatLng[] | null> {
  if (points.length < 2) return null;

  const key = cacheKey(deviceId, points);
  const hit = routeCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.route;

  const thinned = thinForMatch(points);
  if (thinned.length < 2) return null;

  const snapped: LatLng[] = [];

  for (let start = 0; start < thinned.length; start += CHUNK - 1) {
    const chunk = thinned.slice(start, start + CHUNK);
    if (chunk.length < 2) break;
    const matched = await matchChunk(chunk);
    const piece =
      matched ??
      chunk.map((p) => ({ lat: p.lat, lng: p.lng }));

    if (snapped.length === 0) {
      snapped.push(...piece);
    } else {
      // Skip overlapping first vertex from chunk window.
      snapped.push(...piece.slice(1));
    }
    if (start + CHUNK >= thinned.length) break;
  }

  if (snapped.length < 2) return null;

  routeCache.set(key, { route: snapped, expires: Date.now() + CACHE_TTL_MS });

  // Bound memory on warm serverless instances.
  if (routeCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of routeCache) {
      if (v.expires < now) routeCache.delete(k);
    }
  }

  return snapped;
}

/** Run map-match for many devices with limited concurrency. */
export async function snapTracksToRoads(
  tracks: { deviceId: string; points: RawTrackPoint[] }[],
  concurrency = 3
): Promise<Map<string, LatLng[]>> {
  const out = new Map<string, LatLng[]>();
  let i = 0;

  async function worker() {
    while (i < tracks.length) {
      const idx = i++;
      const t = tracks[idx];
      const route = await snapTrackToRoads(t.deviceId, t.points);
      if (route) out.set(t.deviceId, route);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(tracks.length, 1)) }, () => worker())
  );
  return out;
}
