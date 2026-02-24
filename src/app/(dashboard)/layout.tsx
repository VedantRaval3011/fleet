import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { Navbar } from "@/components/layout/Navbar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  // Drivers shouldn't access the web dashboard, route them to their mobile portal
  if (session.user.role === "driver") {
    redirect("/driver/dashboard");
  }

  return (
    <div className="flex h-screen bg-slate-950 overflow-hidden font-sans text-slate-300">
      <Sidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        <Navbar />
        <main className="flex-1 overflow-y-auto p-6 md:p-8 relative">
          {children}
        </main>
      </div>
    </div>
  );
}
