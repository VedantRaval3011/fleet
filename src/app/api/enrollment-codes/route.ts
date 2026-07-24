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
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function normalizeCapabilities(raw: unknown) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    return {
      callMonitoring: Boolean(o.callMonitoring),
      locationTracking: Boolean(o.locationTracking),
      expenseManagement: Boolean(o.expenseManagement),
    };
  }
  // Legacy comma-string / string[] from older UI
  const list = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === "string"
      ? raw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
  const lower = list.map((s) => s.toLowerCase());
  return {
    callMonitoring:
      lower.some((s) => s.includes("call")) || lower.length === 0,
    locationTracking: lower.some((s) => s.includes("location") || s.includes("gps")),
    expenseManagement: lower.some((s) => s.includes("expense")),
  };
}

function normalizeVehicle(raw: unknown) {
  if (!raw) return undefined;
  if (typeof raw === "string") {
    const registration = raw.trim();
    if (!registration) return undefined;
    return { id: registration, registration };
  }
  if (typeof raw === "object") {
    const o = raw as { id?: string; registration?: string };
    const registration = (o.registration || o.id || "").trim();
    if (!registration) return undefined;
    return { id: o.id || registration, registration };
  }
  return undefined;
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

    const query: Record<string, unknown> = {};
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
    const {
      employeeId,
      employeeName,
      role = "driver",
      capabilities,
      vehicle,
      expiresInHours = 48,
    } = body;

    if (!employeeName?.trim()) {
      return NextResponse.json({ error: "Employee name is required" }, { status: 400 });
    }

    await connectToDatabase();

    const companyId = new mongoose.Types.ObjectId(session.user.companyId!);
    const caps = normalizeCapabilities(capabilities);
    const vehicleObj = normalizeVehicle(vehicle);

    let code = "";
    for (let i = 0; i < 5; i++) {
      const candidate = generateCode();
      const exists = await EnrollmentCode.findOne({ code: candidate });
      if (!exists) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      return NextResponse.json({ error: "Could not generate unique code" }, { status: 500 });
    }

    const expiresAt = new Date(Date.now() + Number(expiresInHours || 48) * 60 * 60 * 1000);
    const serverUrl = process.env.BACKEND_URL?.trim().replace(/\/$/, "") || "";
    const apiKey = process.env.BACKEND_API_KEY ?? "";

    const enrollmentCode = await EnrollmentCode.create({
      code,
      companyId,
      employeeId: employeeId?.trim() || code,
      employeeName: employeeName.trim(),
      role: role === "employee" ? "employee" : "driver",
      capabilities: caps,
      vehicle: vehicleObj,
      serverUrl,
      apiKey,
      expiresAt,
      revoked: false,
    });

    // Shared Mongo is enough — Android redeems against Express which reads the same collection.
    return NextResponse.json(enrollmentCode, { status: 201 });
  } catch (error) {
    console.error("POST /api/enrollment-codes error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
