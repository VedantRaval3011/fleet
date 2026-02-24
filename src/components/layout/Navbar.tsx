"use client";

import { useSession, signOut } from "next-auth/react";
import { LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Navbar() {
  const { data: session } = useSession();

  return (
    <header className="h-16 flex items-center justify-between px-6 bg-slate-900 border-b border-slate-800 shadow-sm z-10 w-full text-slate-100">
      <div className="font-medium text-lg flex items-center gap-2">
        <span className="text-slate-400">Dashboard</span>
      </div>
      
      <div className="flex items-center gap-4">
        {session?.user && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-full border border-slate-700">
              <User className="w-4 h-4 text-indigo-400" />
              <div className="flex flex-col leading-none">
                <span className="text-sm font-medium">{session.user.name || "Admin"}</span>
                <span className="text-xs text-slate-400 uppercase tracking-wider">{session.user.role}</span>
              </div>
            </div>
            
            <Button 
              variant="default" 
              size="sm" 
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="bg-slate-800 hover:bg-rose-600 text-slate-200 border border-slate-700 hover:border-transparent transition-colors"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign out
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
