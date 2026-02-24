"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import ExpenseMap from "@/components/ExpenseMap";

export default function LiveMapPage() {
  const [locations, setLocations] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchLiveLocations();
  }, []);

  const fetchLiveLocations = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/live-map");
      if (res.ok) {
        const data = await res.json();
        setLocations(data);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
           <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Live Driver Map</h1>
           <p className="text-slate-400">Viewing the last known location of your active drivers based on their most recent submissions.</p>
        </div>
        <button
           onClick={fetchLiveLocations}
           className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-md border border-slate-700 transition-colors flex items-center gap-2"
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Refresh Locations
        </button>
      </div>

      <Card className="bg-slate-900 border-slate-800 text-slate-100 p-1">
        {isLoading && locations.length === 0 ? (
           <div className="h-[600px] w-full flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
           </div>
        ) : (
           <ExpenseMap expenses={locations} />
        )}
      </Card>
    </div>
  );
}
