import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import EnrollmentCode from "@/models/EnrollmentCode";
import mongoose from "mongoose";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function generateCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase(); // 8 char hex
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.user.role !== "admin" && session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await connectToDatabase();

    const query: any = {};
    if (session.user.role !== "super_admin") {
      query.companyId = new mongoose.Types.ObjectId(session.user.companyId!);
    }

    const codes = await EnrollmentCode.find(query).sort({ createdAt: -1 }).limit(200);
    return NextResponse.json(codes);
  } catch (error) {
    console.error("GET /api/enrollment-codes error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.user.role !== "admin" && session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { employeeId, employeeName, role = "driver", capabilities, vehicle, serverUrl, expiresInHours = 48 } = body;

    await connectToDatabase();

    const companyId = new mongoose.Types.ObjectId(session.user.companyId!);

    // Generate unique code (retry up to 5 times)
    let code = "";
    for (let i = 0; i < 5; i++) {
      const candidate = generateCode();
      const exists = await EnrollmentCode.findOne({ code: candidate });
      if (!exists) { code = candidate; break; }
    }
    if (!code) {
      return NextResponse.json({ error: "Could not generate unique code" }, { status: 500 });
    }

    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    const backendUrl = process.env.BACKEND_URL?.trim().replace(/\/$/, "");
    const apiKey = process.env.BACKEND_API_KEY ?? "";

    // Write to shared Mongo via Mongoose (Express reads same collection)
    const enrollmentCode = await EnrollmentCode.create({
      code,
      companyId,
      employeeId,
      employeeName,
      role,
      capabilities: capabilities ?? [],
      vehicle,
      serverUrl,
      expiresAt,
      revoked: false,
    });

    // Also notify Express backend if configured (optional — same Mongo, so Express can read directly)
    if (backendUrl) {
      try {
        await fetch(`${backendUrl}/api/enrollment/codes`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
          },
          body: JSON.stringify({
            code,
            companyId: companyId.toString(),
            employeeId,
            employeeName,
            role,
            capabilities: capabilities ?? [],
            vehicle,
            serverUrl,
            expiresAt,
          }),
        });
      } catch {
        // Non-fatal — the code was already written to shared Mongo
      }
    }

    return NextResponse.json(enrollmentCode, { status: 201 });
  } catch (error) {
    console.error("POST /api/enrollment-codes error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
