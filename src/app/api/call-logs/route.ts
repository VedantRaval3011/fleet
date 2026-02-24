import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import CallLog from "@/models/CallLog";
import Driver from "@/models/Driver";
import mongoose from "mongoose";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const driverId = searchParams.get("driverId");
    const callType = searchParams.get("callType");
    const search = searchParams.get("search");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const query: any = {};
    if (session!.user.role !== "super_admin") {
      // Admins only see their company's logs AND any old legacy logs without a company assigned (for testing)
      query.$or = [
        { companyId: new mongoose.Types.ObjectId(session!.user.companyId!) },
        { companyId: { $exists: false } }
      ];
    }

    if (driverId) {
      query.driverId = new mongoose.Types.ObjectId(driverId);
    }
    if (callType && callType !== "ALL") {
      query.callType = callType;
    }
    if (search) {
      query.phoneNumber = { $regex: search, $options: "i" };
    }
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }

    await connectToDatabase();
    
    // Using populate to efficiently retrieve the driver's info through userId
    const logs = await CallLog.find(query)
      .populate({
        path: "driverId",
        select: "userId",
        populate: {
          path: "userId",
          select: "name email",
          model: "User"
        }
      })
      .sort({ timestamp: -1 })
      .limit(200);

    return NextResponse.json(logs);
  } catch (error) {
    console.error("Failed to fetch call logs:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
