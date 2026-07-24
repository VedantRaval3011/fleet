import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import LocationSession from "@/models/LocationSession";
import mongoose from "mongoose";

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
    const limitParam = parseInt(searchParams.get("limit") ?? "50", 10);

    const query: any = {};

    if (session.user.role !== "super_admin") {
      query.companyId = new mongoose.Types.ObjectId(session.user.companyId!);
    }
    if (deviceId) query.deviceId = deviceId;
    if (driverId) query.driverId = new mongoose.Types.ObjectId(driverId);
    if (status) query.status = status;

    const sessions = await LocationSession.find(query)
      .sort({ startedAt: -1 })
      .limit(Math.min(limitParam, 200));

    return NextResponse.json(sessions);
  } catch (error) {
    console.error("GET /api/location/sessions error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
