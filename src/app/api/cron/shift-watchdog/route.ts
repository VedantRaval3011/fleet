import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { sweepOpenShifts } from "@/lib/shiftService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET/POST /api/cron/shift-watchdog
 *
 * Marks open shifts whose phone has gone quiet as interrupted, and closes shifts
 * past their scheduled end plus grace. Every admin read and device upload runs the
 * same sweep, so this is the backstop for when nobody is looking: call it every few
 * minutes from a scheduler for timely marking (the daily Vercel cron alone only
 * guarantees a daily settle). Secured with CRON_SECRET like the other cron routes.
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const urlSecret = new URL(req.url).searchParams.get("secret");
  const headerSecret = bearer ?? req.headers.get("x-cron-secret") ?? urlSecret;

  if (cronSecret && headerSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const result = await sweepOpenShifts();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[shift-watchdog]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
