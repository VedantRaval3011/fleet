import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import { consumePortalTicket } from "@/lib/deviceSession";

export const dynamic = "force-dynamic";

/**
 * GET /api/driver/portal?ticket=...
 *
 * Signs the browser in as the driver who holds the handset, then opens the
 * expense page. The ticket was issued moments earlier by the app and is deleted
 * here, so a copied link does not keep working.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticket = url.searchParams.get("ticket") ?? "";
  const destination = new URL("/driver/add-expense", url.origin);

  try {
    await connectToDatabase();
    const user = await consumePortalTicket(ticket);
    const secret = process.env.NEXTAUTH_SECRET;
    if (!user || !secret) {
      return NextResponse.redirect(new URL("/login", url.origin));
    }

    const userId = String(user._id);
    const sessionToken = await encode({
      token: {
        sub: userId,
        id: userId,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.companyId ? String(user.companyId) : null,
      },
      secret,
      maxAge: 30 * 24 * 60 * 60,
    });

    // Must match the cookie next-auth reads. That name follows NEXTAUTH_URL,
    // which is https in this project, so the cookie is the __Secure- one.
    const secure = (process.env.NEXTAUTH_URL ?? url.origin).startsWith("https://");
    const response = NextResponse.redirect(destination);
    response.cookies.set(`${secure ? "__Secure-" : ""}next-auth.session-token`, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure,
      maxAge: 30 * 24 * 60 * 60,
    });
    return response;
  } catch (error) {
    console.error("GET /api/driver/portal error:", error);
    return NextResponse.redirect(new URL("/login", url.origin));
  }
}
