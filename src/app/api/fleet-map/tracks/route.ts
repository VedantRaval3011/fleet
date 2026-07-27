import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import LocationPoint from "@/models/LocationPoint";
import { companyIdIn } from "@/lib/companyIdQuery";
import { filterGpsTrack, type RawTrackPoint } from "@/lib/gpsTrackFilter";

export const dynamic = "force-dynamic";

// Returns the recent movement trail for every device in the company so the
// live fleet map can draw a route polyline (not just the latest pin).
// Query params:
//   minutes   — look-back window in minutes (default 30, max 1440)
//   deviceId  — optional, restrict to a single device
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

    const tracks = Object.entries(rawByDevice).map(([id, raw]) => {
      const filtered = filterGpsTrack(raw);
      return {
        deviceId: id,
        points: filtered.map((p) => ({
          lat: p.lat,
          lng: p.lng,
          recordedAt: p.recordedAt,
          speed: p.speed,
        })),
      };
    });

    return NextResponse.json({
      windowMinutes: minutes,
      tracks,
    });
  } catch (error) {
    console.error("GET /api/fleet-map/tracks error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
