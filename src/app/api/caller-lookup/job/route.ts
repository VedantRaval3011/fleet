import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import CallerLookupResult from "@/models/CallerLookupResult";
import CallerLookupLog from "@/models/CallerLookupLog";
import CallerLookupJob from "@/models/CallerLookupJob";
import DeviceEnrollment from "@/models/DeviceEnrollment";
import { findSeries } from "@/lib/callerLookup/series";
import { companyIdIn } from "@/lib/companyIdQuery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireAdminSession() {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role === "driver") {
    return null;
  }
  return session;
}

function serializeJob(job: Record<string, unknown>) {
  const processed = Number(job.processed || 0);
  const totalPlanned = Number(job.totalPlanned || 0);
  const remaining = Math.max(0, totalPlanned - processed);
  const progressPct = totalPlanned ? (processed / totalPlanned) * 100 : 0;
  const startedAt = job.startedAt ? new Date(String(job.startedAt)).getTime() : 0;
  const elapsedSeconds = startedAt ? Math.max(1, (Date.now() - startedAt) / 1000) : 0;
  const speedPerSec = elapsedSeconds ? processed / elapsedSeconds : 0;
  return {
    ...job,
    id: String(job._id),
    remaining,
    progressPct,
    speedPerSec,
    avgLookupMs: processed ? Number(job.totalLookupDurationMs || 0) / processed : 0,
    etaSeconds: speedPerSec ? remaining / speedPerSec : null,
  };
}

export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const query: Record<string, unknown> = {};
    if (searchParams.get("jobId")) query._id = searchParams.get("jobId");
    if (session.user.role !== "super_admin") {
      query.companyId = companyIdIn(session.user.companyId!);
    }
    const job = await CallerLookupJob.findOne(query).sort({ updatedAt: -1 }).lean();
    if (!job) {
      return NextResponse.json({ job: null, results: [], logs: [] });
    }

    const [results, logs] = await Promise.all([
      CallerLookupResult.find({ jobId: job._id })
        .sort({ lookedUpAt: -1 })
        .limit(100)
        .lean(),
      CallerLookupLog.find({ jobId: job._id }).sort({ createdAt: -1 }).limit(150).lean(),
    ]);

    return NextResponse.json({
      job: serializeJob(job as unknown as Record<string, unknown>),
      results,
      logs,
    });
  } catch (err) {
    console.error("[caller-lookup/job GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load job" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    await connectToDatabase();
    const deviceId = String(body.deviceId || "");
    const series = findSeries(String(body.seriesId || ""));
    if (!deviceId) {
      return NextResponse.json({ error: "Select an Android device" }, { status: 400 });
    }
    if (!series) {
      return NextResponse.json({ error: "Invalid number series" }, { status: 400 });
    }

    const deviceQuery: Record<string, unknown> = { deviceId, revoked: { $ne: true } };
    if (session.user.role !== "super_admin" && session.user.companyId) {
      deviceQuery.companyId = companyIdIn(session.user.companyId);
    }
    const device = await DeviceEnrollment.findOne(deviceQuery).lean();
    if (!device) {
      return NextResponse.json(
        { error: `Enrolled device "${deviceId}" not found (check enrollment is active and not revoked)` },
        { status: 404 }
      );
    }

    const backendUrl = process.env.BACKEND_URL?.trim().replace(/\/$/, "");
    const apiKey = process.env.BACKEND_API_KEY || process.env.API_KEY || "";
    if (!backendUrl || !apiKey) {
      return NextResponse.json(
        { error: "BACKEND_URL and BACKEND_API_KEY must be configured" },
        { status: 503 }
      );
    }
    const response = await fetch(`${backendUrl}/api/caller-lookup/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        deviceId,
        companyId:
          session.user.companyId ||
          (device as unknown as Record<string, unknown>).companyId ||
          null,
        createdBy: session.user.id || session.user.email || undefined,
        mobileProvider: String(body.mobileProvider || "jio"),
        seriesId: series.id,
        seriesPrefix: series.prefix,
        seriesLabel: series.label,
        startNumber: body.startNumber || undefined,
        endNumber: body.endNumber || undefined,
        batchSize: Number(body.batchSize ?? 200),
        delayMs: Number(body.delayMs ?? 200),
        workers: Number(body.workers ?? 1),
        lookupProviderId: String(body.lookupProviderId || "android-call-log-cache"),
        maxRetries: Number(body.maxRetries ?? 2),
      }),
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const backendError = String(data.error || "").trim();
      const message =
        response.status === 401 || response.status === 403
          ? backendError ||
            "Backend rejected credentials — check BACKEND_API_KEY matches the Express API_KEY"
          : response.status === 404
            ? backendError ||
              "Backend has no caller-lookup job API — redeploy Express with callerLookupRoutes"
            : backendError || `Backend rejected the Android lookup job (${response.status})`;
      return NextResponse.json({ error: message }, { status: response.status });
    }
    const job = data.job as Record<string, unknown>;
    return NextResponse.json(
      { job: serializeJob(job), fcmSent: Boolean(data.fcmSent) },
      { status: 201 }
    );
  } catch (err) {
    console.error("[caller-lookup/job POST]", err);
    const message = err instanceof Error ? err.message : "Failed to start job";
    const isNetwork =
      /fetch failed|ECONNREFUSED|ENOTFOUND|network|timeout/i.test(message);
    return NextResponse.json(
      {
        error: isNetwork
          ? `Network error reaching backend (${process.env.BACKEND_URL || "BACKEND_URL unset"}): ${message}`
          : message,
      },
      { status: 400 }
    );
  }
}
