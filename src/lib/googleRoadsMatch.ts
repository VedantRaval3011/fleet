import type { RawTrackPoint } from "@/lib/gpsTrackFilter";
import { haversineMeters } from "@/lib/gpsTrackFilter";

export type LatLng = { lat: number; lng: number };

const ROADS_ENDPOINT = "https://roads.googleapis.com/v1/snapToRoads";
/** Roads API hard limit is 100 points per snapToRoads request. */
const CHUNK = 100;
const MATCH_MIN_SPACING_M = 35;
const CACHE_TTL_MS = 25_000;

type CacheEntry = { route: LatLng[]; expires: number };
const routeCache = new Map<string, CacheEntry>();

/**
 * Server-side key. Prefer a dedicated one: the browser key is HTTP-referrer
 * restricted, which the Roads API (a server-to-server call) cannot satisfy.
 */
function roadsApiKey(): string {
  return (
    process.env.GOOGLE_MAPS_SERVER_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    ""
  ).trim();
}

export function hasRoadsApiKey(): boolean {
  return roadsApiKey().length > 0;
}

/** Space points so map-matching sees a clean driving trace. */
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

  const key = roadsApiKey();
  if (!key) return null;

  const path = points.map((p) => `${p.lat},${p.lng}`).join("|");
  const url =
    `${ROADS_ENDPOINT}?interpolate=true` +
    `&path=${encodeURIComponent(path)}` +
    `&key=${encodeURIComponent(key)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      // 403 here almost always means the Roads API is not enabled on the key,
      // or the key is referrer-restricted. Log once per failure, then fall back.
      console.warn(`Roads API snapToRoads failed: ${res.status} ${res.statusText}`);
      return null;
    }

    const data = (await res.json()) as {
      snappedPoints?: { location?: { latitude?: number; longitude?: number } }[];
      error?: { message?: string };
    };
    if (data.error) {
      console.warn(`Roads API error: ${data.error.message}`);
      return null;
    }
    if (!data.snappedPoints?.length) return null;

    const route: LatLng[] = [];
    for (const sp of data.snappedPoints) {
      const lat = sp.location?.latitude;
      const lng = sp.location?.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const prev = route[route.length - 1];
      if (prev && prev.lat === lat && prev.lng === lng) continue;
      route.push({ lat: lat as number, lng: lng as number });
    }
    return route.length >= 2 ? route : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Snap a filtered GPS trail onto the road network (Google Roads API).
 * Returns null if matching fails — caller should fall back to raw GPS.
 */
export async function snapTrackToRoads(
  deviceId: string,
  points: RawTrackPoint[]
): Promise<LatLng[] | null> {
  if (points.length < 2) return null;
  if (!hasRoadsApiKey()) return null;

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
    const piece = matched ?? chunk.map((p) => ({ lat: p.lat, lng: p.lng }));

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
  if (!hasRoadsApiKey()) return out;

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
