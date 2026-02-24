"use client";

import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { format } from "date-fns";

// Fix for default marker icons in Leaflet with Next.js/Webpack
const DefaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

export default function ExpenseMapCore({ expenses }: { expenses: any[] }) {
  if (expenses.length === 0) return (
     <div className="h-[600px] w-full bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-center">
        <p className="text-slate-500 text-lg">No expenses to display on map.</p>
     </div>
  );

  const defaultCenter = expenses[0]?.location ? [expenses[0].location.lat, expenses[0].location.lng] : [40.7128, -74.0060];

  return (
    <div className="h-[600px] w-full rounded-xl overflow-hidden border border-slate-800 shadow-2xl relative z-0">
      <MapContainer 
        center={defaultCenter as [number, number]} 
        zoom={15} 
        style={{ height: "100%", width: "100%", zIndex: 0 }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {expenses.map((expense) => {
          if (!expense.location?.lat || !expense.location?.lng) return null;
          
          const accuracyMeters = expense.locationAccuracy || 0;
          
          return (
            <span key={expense._id.toString()}>
              {/* Accuracy radius circle */}
              {accuracyMeters > 0 && (
                <Circle 
                  center={[expense.location.lat, expense.location.lng]}
                  radius={accuracyMeters}
                  pathOptions={{
                    color: accuracyMeters <= 50 ? '#10b981' : accuracyMeters <= 150 ? '#f59e0b' : '#ef4444',
                    fillColor: accuracyMeters <= 50 ? '#10b981' : accuracyMeters <= 150 ? '#f59e0b' : '#ef4444',
                    fillOpacity: 0.1,
                    weight: 2,
                    dashArray: '5, 5'
                  }}
                />
              )}
              <Marker position={[expense.location.lat, expense.location.lng]}>
                <Popup className="custom-popup rounded-2xl overflow-hidden">
                  <div className="space-y-3 min-w-[200px] font-sans">
                    <div className="flex justify-between items-start gap-4">
                      <h3 className="font-bold text-slate-900">{expense.driverId?.userId?.name || "Unknown Driver"}</h3>
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-600 px-2 py-0.5 rounded-sm">
                        {expense.category || "Expense"}
                      </span>
                    </div>
                    
                    <div className="text-3xl font-black text-amber-600">
                      ${expense.amount.toFixed(2)}
                    </div>
                    
                    <div className="text-xs text-slate-500 font-medium">
                      {format(new Date(expense.timestamp), "MMM dd, yyyy h:mm a")}
                    </div>

                    {accuracyMeters > 0 && (
                      <div className={`text-xs px-2 py-1 rounded-md font-semibold ${
                        accuracyMeters <= 50 ? 'bg-emerald-100 text-emerald-700' : 
                        accuracyMeters <= 150 ? 'bg-amber-100 text-amber-700' : 
                        'bg-rose-100 text-rose-700'
                      }`}>
                        📍 GPS accuracy: ±{Math.round(accuracyMeters)}m
                      </div>
                    )}

                    {expense.walletBalanceAfter !== undefined && (
                      <div className="text-xs bg-slate-100 p-2 rounded-md border border-slate-200">
                        Balance after transaction:<br/>
                        <strong className="text-indigo-600 text-sm">${expense.walletBalanceAfter.toFixed(2)}</strong>
                      </div>
                    )}

                    {expense.photoUrl && (
                      <div className="pt-2 border-t border-slate-200 mt-2">
                         {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={expense.photoUrl} alt="Receipt" className="w-full h-32 object-cover rounded-md shadow-sm border border-slate-200" />
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            </span>
          );
        })}
      </MapContainer>
    </div>
  );
}
