import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Department from "@/models/Department";
import EmployeeDepartment from "@/models/EmployeeDepartment";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const query: any = {};
    if (session.user.role !== "super_admin") {
      query.$or = [
        { companyId: new mongoose.Types.ObjectId(session.user.companyId!) },
        // Mappings created by a super_admin carry no company.
        { companyId: null },
      ];
    }

    const rows = await EmployeeDepartment.find(query)
      .populate({ path: "departmentId", select: "name", model: "Department" })
      .sort({ employeeName: 1 })
      .lean();

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Failed to fetch employee departments:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// Upsert mapping (create or update) for an employeeName
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      employeeName?: string;
      departmentId?: string;
      companyId?: string; // super_admin only
    };

    const employeeName = String(body.employeeName ?? "").trim();
    const departmentId = String(body.departmentId ?? "").trim();
    if (!employeeName) return NextResponse.json({ error: "Employee name is required" }, { status: 400 });
    if (!departmentId) return NextResponse.json({ error: "Department is required" }, { status: 400 });
    if (!mongoose.Types.ObjectId.isValid(departmentId)) {
      return NextResponse.json({ error: "Invalid department" }, { status: 400 });
    }

    await connectToDatabase();

    // A super_admin is not tied to a company. They may name one explicitly,
    // otherwise the mapping follows the employee's existing row (below) or the
    // company of the department being assigned.
    const isSuperAdmin = session.user.role === "super_admin";
    let companyId = String((isSuperAdmin ? body.companyId : session.user.companyId) ?? "").trim();
    if (!companyId && !isSuperAdmin) {
      return NextResponse.json({ error: "Company is required" }, { status: 400 });
    }
    if (companyId && !mongoose.Types.ObjectId.isValid(companyId)) {
      return NextResponse.json({ error: "Invalid company" }, { status: 400 });
    }

    if (!companyId) {
      // An employee must not end up with two rows pointing at different
      // departments, so reassign the row they already have, whatever company
      // it sits in, rather than adding an unscoped duplicate beside it.
      const existing = await EmployeeDepartment.findOne({ employeeName });
      if (existing) {
        existing.departmentId = new mongoose.Types.ObjectId(departmentId);
        await existing.save();

        const updated = await EmployeeDepartment.findById(existing._id)
          .populate({ path: "departmentId", select: "name", model: "Department" })
          .lean();

        return NextResponse.json(updated, { status: 200 });
      }

      // First mapping for this employee: inherit the department's company.
      const department = await Department.findById(departmentId).select("companyId").lean<{
        companyId?: mongoose.Types.ObjectId;
      } | null>();
      companyId = department?.companyId ? department.companyId.toString() : "";
    }

    const scopedCompanyId = companyId ? new mongoose.Types.ObjectId(companyId) : null;

    const doc = await EmployeeDepartment.findOneAndUpdate(
      {
        companyId: scopedCompanyId,
        employeeName,
      },
      {
        $set: {
          departmentId: new mongoose.Types.ObjectId(departmentId),
        },
        $setOnInsert: {
          companyId: scopedCompanyId,
          employeeName,
        },
      },
      { upsert: true, new: true }
    )
      .populate({ path: "departmentId", select: "name", model: "Department" })
      .lean();

    return NextResponse.json(doc, { status: 201 });
  } catch (error: any) {
    if (error?.code === 11000) {
      return NextResponse.json({ error: "Mapping already exists" }, { status: 400 });
    }
    console.error("Failed to upsert employee department:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

    await connectToDatabase();

    const row = await EmployeeDepartment.findById(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (
      session.user.role !== "super_admin" &&
      row.companyId?.toString() !== session.user.companyId
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await EmployeeDepartment.deleteOne({ _id: row._id });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete employee department:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

