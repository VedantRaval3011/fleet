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
      <header className="sticky top-0 z-50 flex items-center justify-between px-4 py-4 bg-slate-900 border-b border-slate-800 shadow-sm">
        <Link href="/driver/dashboard" className="text-xl font-bold text-white tracking-tight">
          Driver<span className="text-indigo-500">Portal</span>
        </Link>
        <Link 
          href="/api/auth/signout" 
          className="p-2 text-slate-400 hover:text-rose-400 transition-colors rounded-full hover:bg-slate-800"
        >
          <LogOut className="w-5 h-5" />
        </Link>
      </header>

      {/* Main Content Area - Optimized for mobile scrolling */}
      <main className="flex-1 w-full max-w-md mx-auto p-4 md:p-6 pb-24">
        {children}
      </main>
    </div>
  );
}
