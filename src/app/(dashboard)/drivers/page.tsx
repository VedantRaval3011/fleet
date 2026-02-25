"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Wallet, Plus, X, TrendingUp } from "lucide-react";

interface Driver {
  _id: string;
  userId: { name: string; email: string };
  status: "active" | "inactive";
  walletBalance: number;
}

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Top-up modal state
  const [topUpDriver, setTopUpDriver] = useState<Driver | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpNote, setTopUpNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [topUpError, setTopUpError] = useState("");

  useEffect(() => {
    fetchDrivers();
  }, []);

  const fetchDrivers = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/drivers");
      if (res.ok) setDrivers(await res.json());
    } catch {}
    finally { setIsLoading(false); }
  };

  const openTopUp = (driver: Driver) => {
    setTopUpDriver(driver);
    setTopUpAmount("");
    setTopUpNote("");
    setTopUpError("");
  };

  const handleTopUp = async () => {
    const amount = parseFloat(topUpAmount);
    if (!topUpDriver || isNaN(amount) || amount <= 0) {
      setTopUpError("Please enter a valid positive amount.");
      return;
    }
    setIsSubmitting(true);
    setTopUpError("");
    try {
      const res = await fetch("/api/drivers/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: topUpDriver._id, amount, note: topUpNote || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Top-up failed");

      // Update balance in local state
      setDrivers(prev => prev.map(d =>
        d._id === topUpDriver._id ? { ...d, walletBalance: data.newBalance } : d
      ));
      setTopUpDriver(null);
    } catch (err: any) {
      setTopUpError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalBalance = drivers.reduce((sum, d) => sum + d.walletBalance, 0);

  return (
    <div className="space-y-6">
      {/* Top-Up Modal */}
      {topUpDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Add Balance</h2>
                <p className="text-sm text-slate-400 mt-0.5">{topUpDriver.userId.name}</p>
              </div>
              <button
                onClick={() => setTopUpDriver(null)}
                className="p-2 rounded-full hover:bg-slate-800 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-800/60 rounded-xl p-3 flex items-center gap-3">
              <Wallet className="w-5 h-5 text-indigo-400 shrink-0" />
              <div>
                <p className="text-xs text-slate-400">Current Balance</p>
                <p className="text-xl font-bold text-amber-400">
                  ₹{topUpDriver.walletBalance.toFixed(2)}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300">Amount to Add (₹)</Label>
                <Input
                  type="number"
                  placeholder="e.g. 5000"
                  value={topUpAmount}
                  onChange={e => setTopUpAmount(e.target.value)}
                  className="h-12 text-xl font-bold bg-slate-950 border-slate-700 text-emerald-400 placeholder:text-slate-600"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Note <span className="text-slate-500">(optional)</span></Label>
                <Input
                  placeholder="e.g. Weekly allowance"
                  value={topUpNote}
                  onChange={e => setTopUpNote(e.target.value)}
                  className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                />
              </div>
            </div>

            {topUpAmount && !isNaN(parseFloat(topUpAmount)) && parseFloat(topUpAmount) > 0 && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-sm text-emerald-400">
                New balance will be: <span className="font-bold">
                  ₹{(topUpDriver.walletBalance + parseFloat(topUpAmount)).toFixed(2)}
                </span>
              </div>
            )}

            {topUpError && (
              <p className="text-sm text-rose-400">{topUpError}</p>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 border-slate-600 text-slate-300 bg-transparent"
                onClick={() => setTopUpDriver(null)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                onClick={handleTopUp}
                disabled={isSubmitting}
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                Add ₹{topUpAmount || "0"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-white">Driver Management</h1>
        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-indigo-400" />
          <span className="text-sm text-slate-400">Total allocated:</span>
          <span className="font-bold text-amber-400">₹{totalBalance.toFixed(2)}</span>
        </div>
      </div>

      <Card className="bg-slate-900 border-slate-800 text-slate-100">
        <Table>
          <TableHeader className="bg-slate-950/50">
            <TableRow className="border-slate-800">
              <TableHead className="text-slate-400">Driver Name</TableHead>
              <TableHead className="text-slate-400">Email</TableHead>
              <TableHead className="text-slate-400">Status</TableHead>
              <TableHead className="text-slate-400">Wallet Balance</TableHead>
              <TableHead className="text-slate-400 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-indigo-500" />
                </TableCell>
              </TableRow>
            ) : drivers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                  No drivers found.
                </TableCell>
              </TableRow>
            ) : drivers.map(driver => (
              <TableRow key={driver._id} className="border-slate-800 hover:bg-slate-800/40 transition-colors">
                <TableCell className="font-semibold text-white">{driver.userId?.name}</TableCell>
                <TableCell className="text-slate-400">{driver.userId?.email}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={driver.status === "active"
                      ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
                      : "border-rose-500/50 text-rose-400 bg-rose-500/10"}
                  >
                    {driver.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-slate-500" />
                    <span className={`font-mono font-bold text-lg ${driver.walletBalance > 0 ? "text-amber-400" : "text-slate-500"}`}>
                      ₹{driver.walletBalance.toFixed(2)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white"
                    onClick={() => openTopUp(driver)}
                  >
                    <Plus className="w-4 h-4 mr-1" /> Top Up
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
