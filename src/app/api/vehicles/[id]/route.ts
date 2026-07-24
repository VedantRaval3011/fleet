import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Vehicle from "@/models/Vehicle";

export const dynamic = "force-dynamic";

function isAdmin(role?: string) {
  return role === "admin" || role === "super_admin";
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);
    if (!isAdmin(session?.user?.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await connectToDatabase();

    const body = await req.json();
    const update: Record<string, unknown> = { ...body };
    if (body.model !== undefined && body.vehicleModel === undefined) {
      update.vehicleModel = body.model;
      delete update.model;
    }
    const vehicle = await Vehicle.findByIdAndUpdate(id, update, { new: true });
    if (!vehicle) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Company scope check for non-super_admin
    if (
      session!.user.role !== "super_admin" &&
      vehicle.companyId.toString() !== session!.user.companyId
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(vehicle);
  } catch (error) {
    console.error("PUT /api/vehicles/[id] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);
    if (!isAdmin(session?.user?.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await connectToDatabase();

    const vehicle = await Vehicle.findById(id);
    if (!vehicle) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (
      session!.user.role !== "super_admin" &&
      vehicle.companyId.toString() !== session!.user.companyId
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await Vehicle.findByIdAndDelete(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/vehicles/[id] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
