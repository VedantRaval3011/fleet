import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    providers: [
      {
        id: "android-call-log-cache",
        label: "Android Contacts + CallLog.CACHED_NAME",
        description:
          "Runs on the selected Android device and reads names already available in contacts or CallLog.Calls.CACHED_NAME.",
        supportsNameLookup: true,
      },
    ],
    defaultProviderId: "android-call-log-cache",
  });
}
