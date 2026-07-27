import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import ExcelJS from "exceljs";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import CallerLookupJob from "@/models/CallerLookupJob";
import CallerLookupResult from "@/models/CallerLookupResult";
import { companyIdIn } from "@/lib/companyIdQuery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cell(v: unknown): string | number {
  if (v == null) return "";
  if (typeof v === "number") return v;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");
    const foundOnly = searchParams.get("foundOnly") === "1";

    const jobQuery: Record<string, unknown> = {};
    if (jobId) jobQuery._id = jobId;
    if (session.user.role !== "super_admin") {
      jobQuery.companyId = companyIdIn(session.user.companyId!);
    }

    const job = await CallerLookupJob.findOne(jobQuery).sort({ updatedAt: -1 }).lean();
    if (!job) {
      return NextResponse.json({ error: "No caller lookup job found" }, { status: 404 });
    }

    const resultQuery: Record<string, unknown> = { jobId: job._id };
    if (foundOnly) resultQuery.lookupStatus = "found";

    const results = await CallerLookupResult.find(resultQuery)
      .sort({ lookedUpAt: 1 })
      .lean();

    const wb = new ExcelJS.Workbook();
    wb.creator = "Fleet Caller Lookup";
    wb.created = new Date();

    const summary = wb.addWorksheet("Job Summary");
    summary.columns = [
      { header: "Field", key: "field", width: 22 },
      { header: "Value", key: "value", width: 48 },
    ];
    summary.addRows([
      { field: "Job ID", value: String(job._id) },
      { field: "Status", value: job.status },
      { field: "Device ID", value: job.deviceId },
      { field: "Employee", value: job.employeeName || "" },
      { field: "Series", value: job.seriesLabel },
      { field: "Prefix", value: job.seriesPrefix },
      { field: "Start Number", value: job.startNumber },
      { field: "End Number", value: job.endNumber },
      { field: "Batch Size", value: job.batchSize },
      { field: "Processed", value: job.processed },
      { field: "Successful", value: job.successful },
      { field: "Failed / empty", value: job.failed },
      { field: "Total Planned", value: job.totalPlanned },
      { field: "Lookup Provider", value: job.lookupProviderId },
      { field: "Mobile Provider", value: job.mobileProvider },
      { field: "Started At", value: job.startedAt ? new Date(job.startedAt).toISOString() : "" },
      { field: "Completed At", value: job.completedAt ? new Date(job.completedAt).toISOString() : "" },
      { field: "Exported At", value: new Date().toISOString() },
      { field: "Rows Exported", value: results.length },
    ]);
    summary.getRow(1).font = { bold: true };

    const sheet = wb.addWorksheet("Lookup Results");
    sheet.columns = [
      { header: "Phone Number", key: "phoneNumber", width: 16 },
      { header: "Caller Name", key: "callerName", width: 28 },
      { header: "Lookup Status", key: "lookupStatus", width: 14 },
      { header: "Provider", key: "provider", width: 18 },
      { header: "Lookup Provider ID", key: "lookupProviderId", width: 24 },
      { header: "Mobile Provider", key: "mobileProvider", width: 14 },
      { header: "Series Prefix", key: "seriesPrefix", width: 14 },
      { header: "Duration (ms)", key: "durationMs", width: 14 },
      { header: "Retries", key: "retryCount", width: 10 },
      { header: "Error", key: "error", width: 32 },
      { header: "Looked Up At", key: "lookedUpAt", width: 24 },
      { header: "KYC", key: "kyc", width: 40 },
      { header: "Metadata", key: "metadata", width: 40 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 13 },
    };

    for (const r of results) {
      sheet.addRow({
        phoneNumber: cell(r.phoneNumber),
        callerName: cell(r.callerName),
        lookupStatus: cell(r.lookupStatus),
        provider: cell(r.provider),
        lookupProviderId: cell(r.lookupProviderId),
        mobileProvider: cell(r.mobileProvider),
        seriesPrefix: cell(r.seriesPrefix),
        durationMs: Number(r.durationMs || 0),
        retryCount: Number(r.retryCount || 0),
        error: cell(r.error),
        lookedUpAt: r.lookedUpAt ? new Date(r.lookedUpAt).toISOString() : "",
        kyc: cell(r.kyc),
        metadata: cell(r.metadata),
      });
    }

    const buf = await wb.xlsx.writeBuffer();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `caller-lookup-${String(job._id).slice(-8)}-${stamp}.xlsx`;

    return new NextResponse(Buffer.from(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[caller-lookup/job/export]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed" },
      { status: 500 }
    );
  }
}
