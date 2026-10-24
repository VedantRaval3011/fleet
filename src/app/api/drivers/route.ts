import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Driver from "@/models/Driver";
import { ensureEnrollmentDriverAccounts } from "@/lib/enrollmentDrivers";
import mongoose from "mongoose";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const companyId = session.user.role === "super_admin" ? null : session.user.companyId!;
    // Same people as Device Enrollment, including codes that never got a sign-in.
    await ensureEnrollmentDriverAccounts(companyId);

    const query: any = {};
    if (companyId) {
      query.companyId = new mongoose.Types.ObjectId(companyId);
    }

    const drivers = await Driver.find(query).populate("userId", "name email").sort({ createdAt: -1 });
    return NextResponse.json(drivers);
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
