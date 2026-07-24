import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import LocationPoint from "@/models/LocationPoint";
import mongoose from "mongoose";

export const dynamic = "force-dynamic";

// Returns the recent movement trail for every device in the company so the
// live fleet map can draw a route polyline (not just the latest pin).
// Query params:
//   minutes   — look-back window in minutes (default 120, max 1440)
//   deviceId  — optional, restrict to a single device
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const minutes = Math.min(
      Math.max(parseInt(searchParams.get("minutes") || "120", 10) || 120, 1),
      1440
    );
    const deviceId = searchParams.get("deviceId");
    const cutoff = new Date(Date.now() - minutes * 60_000);

    await connectToDatabase();

    const query: Record<string, unknown> = { recordedAt: { $gte: cutoff } };
    if (session.user.role !== "super_admin") {
      query.companyId = new mongoose.Types.ObjectId(session.user.companyId!);
    }
    if (deviceId) query.deviceId = deviceId;

    // Bounded fetch, oldest → newest so the polyline is drawn in travel order.
    const points = await LocationPoint.find(query)
      .select("deviceId latitude longitude recordedAt speedMetersPerSecond sequenceNumber")
      .sort({ deviceId: 1, recordedAt: 1 })
      .limit(20000)
      .lean();

    // Group into one trail per device.
    const byDevice: Record<
      string,
      { deviceId: string; points: { lat: number; lng: number; recordedAt: Date; speed?: number }[] }
    > = {};

    for (const p of points as any[]) {
      if (p.latitude == null || p.longitude == null) continue;
      const t = (byDevice[p.deviceId] ??= { deviceId: p.deviceId, points: [] });
      t.points.push({
        lat: p.latitude,
        lng: p.longitude,
        recordedAt: p.recordedAt,
        speed: p.speedMetersPerSecond,
      });
    }

    return NextResponse.json({
      windowMinutes: minutes,
      tracks: Object.values(byDevice),
    });
  } catch (error) {
    console.error("GET /api/fleet-map/tracks error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
