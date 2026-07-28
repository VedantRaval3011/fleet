import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import LocationPoint from "@/models/LocationPoint";
import { companyIdIn } from "@/lib/companyIdQuery";
import { filterGpsTrack, type RawTrackPoint } from "@/lib/gpsTrackFilter";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");
    const deviceId = searchParams.get("deviceId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    if (!sessionId && !deviceId) {
      return NextResponse.json({ error: "sessionId or deviceId required" }, { status: 400 });
    }

    await connectToDatabase();

    const query: Record<string, unknown> = {};
    if (session.user.role !== "super_admin") {
      query.companyId = companyIdIn(session.user.companyId!);
    }
    if (sessionId) query.sessionId = sessionId;
    if (deviceId) query.deviceId = deviceId;

    const windowMode = Boolean(from || to);
    if (windowMode) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = new Date(from);
      if (to) range.$lte = new Date(to);
      query.recordedAt = range;
    }

    const points = await LocationPoint.find(query)
      .sort(windowMode ? { recordedAt: 1 } : { sequenceNumber: 1 })
      .limit(5000)
      .lean();

    // Clean the trail before it reaches the trip map and the distance/speed
    // analytics: raw fixes include standstill jitter and low-accuracy outliers
    // that otherwise draw as spikes and inflate the trip distance.
    // The projection carries the whole document through untouched.
    type TrackDoc = RawTrackPoint & { doc: unknown };
    const docs = (points as unknown as Record<string, unknown>[]).flatMap<TrackDoc>((p) => {
      const lat = p.latitude as number | undefined;
      const lng = p.longitude as number | undefined;
      if (typeof lat !== "number" || typeof lng !== "number") return [];
      return [
        {
          doc: p,
          lat,
          lng,
          recordedAt: p.recordedAt as Date,
          speed: p.speedMetersPerSecond as number | undefined,
          accuracyMeters: p.accuracyMeters as number | null | undefined,
          isMockLocation: p.isMockLocation as boolean | null | undefined,
        },
      ];
    });

    const cleaned = filterGpsTrack(docs, { maxPoints: 5000 }).map((p) => p.doc);

    return NextResponse.json(cleaned);
  } catch (error) {
    console.error("GET /api/location/history error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
