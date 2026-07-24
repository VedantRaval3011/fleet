import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import LocationCommand from "@/models/LocationCommand";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { deviceId, type, sessionId } = body;

    if (!deviceId || !type) {
      return NextResponse.json({ error: "deviceId and type are required" }, { status: 400 });
    }

    const validTypes = ["location_upload", "location_latest", "location_live_mode", "location_stop_live_mode"];
    if (!validTypes.includes(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    await connectToDatabase();

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min TTL

    const command = await LocationCommand.create({
      deviceId,
      type,
      sessionId,
      status: "REQUESTED",
      expiresAt,
    });

    // Forward to Express backend for FCM delivery
    const backendUrl = process.env.BACKEND_URL?.trim().replace(/\/$/, "");
    const apiKey = process.env.BACKEND_API_KEY ?? "";

    if (backendUrl) {
      try {
        await fetch(`${backendUrl}/api/location/request-upload`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
          },
          body: JSON.stringify({ deviceId, type, sessionId, commandId: command._id }),
        });
      } catch {
        // Non-fatal — command is stored, device will poll
      }
    }

    return NextResponse.json(command, { status: 201 });
  } catch (error) {
    console.error("POST /api/location/request error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
