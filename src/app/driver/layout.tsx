import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { LogOut } from "lucide-react";
import Link from "next/link";
import { Providers } from "@/components/Providers";

export default async function DriverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  // Purely restrict this layout to drivers
  if (session.user.role !== "driver") {
    redirect("/"); // Kick admins back to the admin dashboard
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* Mobile-friendly top nav */}
      <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
          <Link href="/driver/dashboard" className="flex items-center gap-2 text-lg font-bold tracking-tight text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 text-sm font-bold text-white">
              {(session.user.name ?? "D").charAt(0).toUpperCase()}
            </span>
            Fleet<span className="-ml-1.5 text-indigo-400">Wallet</span>
          </Link>
          <Link
            href="/api/auth/signout"
            aria-label="Sign out"
            className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-rose-400"
          >
            <LogOut className="h-5 w-5" />
          </Link>
        </div>
      </header>

      {/* Main Content Area - Optimized for mobile scrolling */}
      <main className="flex-1 w-full max-w-md mx-auto p-4 md:p-6 pb-24">
        {children}
      </main>
    </div>
  );
}
