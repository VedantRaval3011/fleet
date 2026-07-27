import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import LocationPoint from "@/models/LocationPoint";
import { companyIdIn } from "@/lib/companyIdQuery";
import { filterGpsTrack, type RawTrackPoint } from "@/lib/gpsTrackFilter";
import { snapTracksToRoads } from "@/lib/osrmMapMatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Returns the recent movement trail for every device in the company so the
// live fleet map can draw a route polyline (not just the latest pin).
// Query params:
//   minutes   — look-back window in minutes (default 30, max 1440)
//   deviceId  — optional, restrict to a single device
//   snap      — "0" to skip road matching (default on)
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const minutes = Math.min(
      Math.max(parseInt(searchParams.get("minutes") || "30", 10) || 30, 1),
      1440
    );
    const deviceId = searchParams.get("deviceId");
    const snap =
      searchParams.get("snap") !== "0" && process.env.FLEET_MAP_SNAP !== "0";
    const cutoff = new Date(Date.now() - minutes * 60_000);

    await connectToDatabase();

    const query: Record<string, unknown> = { recordedAt: { $gte: cutoff } };
    if (session.user.role !== "super_admin") {
      query.companyId = companyIdIn(session.user.companyId!);
    }
    if (deviceId) query.deviceId = deviceId;

    const points = await LocationPoint.find(query)
      .select(
        "deviceId latitude longitude recordedAt speedMetersPerSecond accuracyMeters isMockLocation sequenceNumber"
      )
      .sort({ deviceId: 1, recordedAt: 1, sequenceNumber: 1 })
      .limit(30000)
      .lean();

    const rawByDevice: Record<string, RawTrackPoint[]> = {};

    for (const p of points as any[]) {
      if (p.latitude == null || p.longitude == null) continue;
      (rawByDevice[p.deviceId] ??= []).push({
        lat: p.latitude,
        lng: p.longitude,
        recordedAt: p.recordedAt,
        speed: p.speedMetersPerSecond,
        accuracyMeters: p.accuracyMeters,
        isMockLocation: p.isMockLocation,
      });
    }

    const filteredTracks = Object.entries(rawByDevice).map(([id, raw]) => ({
      deviceId: id,
      points: filterGpsTrack(raw),
    }));

    const snapped = snap
      ? await snapTracksToRoads(filteredTracks)
      : new Map<string, { lat: number; lng: number }[]>();

    const tracks = filteredTracks.map((t) => {
      const route = snapped.get(t.deviceId);
      const gpsPoints = t.points.map((p) => ({
        lat: p.lat,
        lng: p.lng,
        recordedAt: p.recordedAt,
        speed: p.speed,
      }));
      return {
        deviceId: t.deviceId,
        // GPS fixes (marker tip / trail start time)
        points: gpsPoints,
        // Road-snapped geometry for the polyline (falls back to GPS)
        route: route && route.length >= 2 ? route : gpsPoints.map((p) => ({ lat: p.lat, lng: p.lng })),
        snapped: !!(route && route.length >= 2),
      };
    });

    return NextResponse.json({
      windowMinutes: minutes,
      snapped: snap,
      tracks,
    });
  } catch (error) {
    console.error("GET /api/fleet-map/tracks error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
