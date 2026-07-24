import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import DeviceLocationState from "@/models/DeviceLocationState";
import mongoose from "mongoose";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const query: any = {};
    if (session.user.role !== "super_admin") {
      query.companyId = new mongoose.Types.ObjectId(session.user.companyId!);
    }

    const states = await DeviceLocationState.find(query).lean();

    const now = Date.now();
    const enriched = states.map((s) => {
      const lastMs = s.lastReceivedAt ? new Date(s.lastReceivedAt).getTime() : null;
      const ageMinutes = lastMs ? (now - lastMs) / 60000 : null;
      let freshness: "fresh" | "stale" | "old" | "unavailable" = "unavailable";
      if (ageMinutes !== null) {
        if (ageMinutes < 1) freshness = "fresh";
        else if (ageMinutes < 5) freshness = "stale";
        else freshness = "old";
      }
      return { ...s, ageMinutes, freshness };
    });

    return NextResponse.json(enriched);
  } catch (error) {
    console.error("GET /api/fleet-map error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
