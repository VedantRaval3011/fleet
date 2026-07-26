import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import CallerLookupJob from "@/models/CallerLookupJob";
import { companyIdIn } from "@/lib/companyIdQuery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const jobId = String(body.jobId || "");
    const action = String(body.action || "") as "pause" | "resume" | "stop";
    if (!jobId || !["pause", "resume", "stop"].includes(action)) {
      return NextResponse.json({ error: "jobId and action are required" }, { status: 400 });
    }

    await connectToDatabase();
    const query: Record<string, unknown> = { _id: jobId };
    if (session.user.role !== "super_admin") {
      query.companyId = companyIdIn(session.user.companyId!);
    }
    const existing = await CallerLookupJob.findOne(query).lean();
    if (!existing) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const backendUrl = process.env.BACKEND_URL?.trim().replace(/\/$/, "");
    const apiKey = process.env.BACKEND_API_KEY || process.env.API_KEY || "";
    if (!backendUrl || !apiKey) {
      return NextResponse.json(
        { error: "BACKEND_URL and BACKEND_API_KEY must be configured" },
        { status: 503 }
      );
    }
    const response = await fetch(
      `${backendUrl}/api/caller-lookup/jobs/${jobId}/control`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify({ action }),
        cache: "no-store",
      }
    );
    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
  } catch (err) {
    console.error("[caller-lookup/job/control]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Control failed" },
      { status: 400 }
    );
  }
}
