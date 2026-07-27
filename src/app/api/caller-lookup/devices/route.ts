import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import DeviceEnrollment from "@/models/DeviceEnrollment";
import { companyIdIn } from "@/lib/companyIdQuery";
import { vehicleLabel } from "@/lib/vehicleLabel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();
  const query: Record<string, unknown> = { revoked: { $ne: true } };
  if (session.user.role !== "super_admin" && session.user.companyId) {
    query.companyId = companyIdIn(session.user.companyId);
  }
  const devices = await DeviceEnrollment.find(query)
    .sort({ updatedAt: -1 })
    .select("deviceId employeeName employeeId role vehicle updatedAt")
    .lean();
  const rows = devices as unknown as Array<{
    deviceId: string;
    employeeName?: string;
    employeeId?: string;
    role?: string;
    vehicle?: unknown;
    updatedAt?: Date;
  }>;

  return NextResponse.json(
    rows.map((device) => ({
      deviceId: device.deviceId,
      employeeName: device.employeeName,
      employeeId: device.employeeId,
      role: device.role,
      vehicle: vehicleLabel(device.vehicle),
      lastReceivedAt: device.updatedAt,
    }))
  );
}

