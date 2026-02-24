"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Map, Navigation, CreditCard, Phone, UserCog, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

const sidebarNavItems = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "Drivers", href: "/drivers", icon: Users },
  { title: "Live Map", href: "/live-map", icon: Map },
  { title: "Trips", href: "/trips", icon: Navigation },
  { title: "Expenses", href: "/expenses", icon: CreditCard },
  { title: "Call Logs", href: "/call-logs", icon: Phone },
  { title: "User Management", href: "/users", icon: UserCog },
  { title: "Reports", href: "/reports", icon: FileText },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col w-64 h-full bg-slate-900 border-r border-slate-800 text-slate-300">
      <div className="flex items-center justify-center h-16 border-b border-slate-800 font-bold text-xl tracking-tight text-white">
        FleetSaaS
      </div>
      <div className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1 px-3">
          {sidebarNavItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));
            const Icon = item.icon;
            
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 transition-all",
                    isActive 
                      ? "bg-indigo-600 font-medium text-white shadow-sm"
                      : "hover:bg-slate-800 hover:text-white"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {item.title}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="p-4 border-t border-slate-800 text-xs text-slate-500 text-center">
        © 2026 Admin Panel
      </div>
    </nav>
  );
}
