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

  // A device can have more than one non-revoked enrollment doc (re-enrolling does
  // not replace the earlier one), so keep only the most recent row per deviceId.
  const byDeviceId = new Map<string, (typeof rows)[number]>();
  for (const device of rows) {
    if (!device.deviceId || byDeviceId.has(device.deviceId)) continue;
    byDeviceId.set(device.deviceId, device);
  }

  return NextResponse.json(
    Array.from(byDeviceId.values()).map((device) => ({
      deviceId: device.deviceId,
      employeeName: device.employeeName,
      employeeId: device.employeeId,
      role: device.role,
      vehicle: vehicleLabel(device.vehicle),
      lastReceivedAt: device.updatedAt,
    }))
  );
}

