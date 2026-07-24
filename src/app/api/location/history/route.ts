import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import LocationPoint from "@/models/LocationPoint";
import mongoose from "mongoose";

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

    if (!sessionId && !deviceId) {
      return NextResponse.json({ error: "sessionId or deviceId required" }, { status: 400 });
    }

    await connectToDatabase();

    const query: any = {};
    if (session.user.role !== "super_admin") {
      query.companyId = new mongoose.Types.ObjectId(session.user.companyId!);
    }
    if (sessionId) query.sessionId = sessionId;
    if (deviceId) query.deviceId = deviceId;

    const points = await LocationPoint.find(query)
      .sort({ sequenceNumber: 1 })
      .limit(5000)
      .lean();

    return NextResponse.json(points);
  } catch (error) {
    console.error("GET /api/location/history error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
