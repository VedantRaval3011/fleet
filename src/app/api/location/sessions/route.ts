import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import LocationSession from "@/models/LocationSession";
import { companyIdIn } from "@/lib/companyIdQuery";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const { searchParams } = new URL(req.url);
    const deviceId = searchParams.get("deviceId");
    const driverId = searchParams.get("driverId");
    const status = searchParams.get("status");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const limitParam = parseInt(searchParams.get("limit") ?? "50", 10);

    const query: Record<string, unknown> = {};

    if (session.user.role !== "super_admin") {
      query.companyId = companyIdIn(session.user.companyId!);
    }
    if (deviceId) query.deviceId = deviceId;
    if (driverId) query.driverId = driverId;
    if (status) query.status = status;
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = new Date(from);
      if (to) range.$lte = new Date(to);
      query.startedAt = range;
    }

    const sessions = await LocationSession.find(query)
      .sort({ startedAt: -1 })
      .limit(Math.min(limitParam, 200));

    return NextResponse.json(sessions);
  } catch (error) {
    console.error("GET /api/location/sessions error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
