"use client";

import { AdvancedMarker, InfoWindow, Pin } from "@vis.gl/react-google-maps";
import { useState } from "react";
import { format } from "date-fns";
import MapShell from "@/components/maps/MapShell";
import { Circle } from "@/components/maps/overlays";

/** Shape this map actually reads off an expense record. */
export interface MapExpense {
  _id: { toString(): string };
  amount: number;
  category?: string;
  timestamp?: string | Date;
  location?: { lat?: number; lng?: number };
  locationAccuracy?: number;
  walletBalanceAfter?: number;
  photoUrl?: string;
  driverId?: { userId?: { name?: string } };
}

/** Green under 50m, amber to 150m, red beyond — same bands as the popup badge. */
function accuracyColor(meters: number) {
  if (meters <= 50) return "#10b981";
  if (meters <= 150) return "#f59e0b";
  return "#ef4444";
}

export default function ExpenseMapCore({ expenses }: { expenses: MapExpense[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (expenses.length === 0)
    return (
      <div className="h-[600px] w-full bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-center">
        <p className="text-slate-500 text-lg">No expenses to display on map.</p>
      </div>
    );

  const first = expenses[0]?.location;
  const defaultCenter =
    first?.lat != null && first?.lng != null
      ? { lat: first.lat, lng: first.lng }
      : { lat: 40.7128, lng: -74.006 };

  return (
    <div className="h-[600px] w-full rounded-xl overflow-hidden border border-slate-800 shadow-2xl relative z-0">
      <MapShell
        defaultCenter={defaultCenter}
        defaultZoom={15}
        className="h-full w-full"
      >
        {expenses.map((expense) => {
          if (!expense.location?.lat || !expense.location?.lng) return null;

          const id = expense._id.toString();
          const position = { lat: expense.location.lat, lng: expense.location.lng };
          const accuracyMeters = expense.locationAccuracy || 0;
          const color = accuracyColor(accuracyMeters);

          return (
            <span key={id}>
              {accuracyMeters > 0 && (
                <Circle
                  center={position}
                  radius={accuracyMeters}
                  strokeColor={color}
                  strokeWeight={2}
                  strokeOpacity={0.9}
                  fillColor={color}
                  fillOpacity={0.1}
                />
              )}

              <AdvancedMarker
                position={position}
                title={expense.driverId?.userId?.name || "Expense"}
                onClick={() => setOpenId(id)}
              >
                <Pin background="#f59e0b" borderColor="#b45309" glyphColor="#fff" />
              </AdvancedMarker>

              {openId === id && (
                <InfoWindow position={position} onCloseClick={() => setOpenId(null)}>
                  <div className="space-y-3 min-w-[200px] font-sans">
                    <div className="flex justify-between items-start gap-4">
                      <h3 className="font-bold text-slate-900">
                        {expense.driverId?.userId?.name || "Unknown Driver"}
                      </h3>
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-600 px-2 py-0.5 rounded-sm">
                        {expense.category || "Expense"}
                      </span>
                    </div>

                    <div className="text-3xl font-black text-amber-600">
                      ₹{expense.amount.toFixed(2)}
                    </div>

                    <div className="text-xs text-slate-500 font-medium">
                      {expense.timestamp && !isNaN(new Date(expense.timestamp).getTime())
                        ? format(new Date(expense.timestamp), "MMM dd, yyyy h:mm a")
                        : "Date unavailable"}
                    </div>

                    {accuracyMeters > 0 && (
                      <div
                        className={`text-xs px-2 py-1 rounded-md font-semibold ${
                          accuracyMeters <= 50
                            ? "bg-emerald-100 text-emerald-700"
                            : accuracyMeters <= 150
                              ? "bg-amber-100 text-amber-700"
                              : "bg-rose-100 text-rose-700"
                        }`}
                      >
                        📍 GPS accuracy: ±{Math.round(accuracyMeters)}m
                      </div>
                    )}

                    {expense.walletBalanceAfter !== undefined && (
                      <div className="text-xs bg-slate-100 p-2 rounded-md border border-slate-200">
                        Balance after transaction:
                        <br />
                        <strong className="text-indigo-600 text-sm">
                          ₹{expense.walletBalanceAfter.toFixed(2)}
                        </strong>
                      </div>
                    )}

                    {expense.photoUrl && (
                      <div className="pt-2 border-t border-slate-200 mt-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={expense.photoUrl}
                          alt="Receipt"
                          className="w-full h-32 object-cover rounded-md shadow-sm border border-slate-200"
                        />
                      </div>
                    )}
                  </div>
                </InfoWindow>
              )}
            </span>
          );
        })}
      </MapShell>
    </div>
  );
}
