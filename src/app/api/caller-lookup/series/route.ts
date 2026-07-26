import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSeriesForProvider, MOBILE_PROVIDERS } from "@/lib/callerLookup/series";
import { seriesEndNumber, seriesStartNumber } from "@/lib/callerLookup/numbers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const provider = searchParams.get("provider") || "jio";
  const series = getSeriesForProvider(provider).map((s) => ({
    ...s,
    startNumber: seriesStartNumber(s),
    endNumber: seriesEndNumber(s),
  }));

  return NextResponse.json({
    mobileProviders: MOBILE_PROVIDERS,
    series,
  });
}
