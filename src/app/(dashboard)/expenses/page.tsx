"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Check, X, MapPin, Receipt, Wallet, Activity, CheckCircle2, Clock } from "lucide-react";
import { format } from "date-fns";
import ExpenseMap from "@/components/ExpenseMap";

interface ExpenseItem {
  _id: string;
  driverId: {
    userId: { name: string; email: string; };
    walletBalance: number;
  };
  amount: number;
  category?: string;
  timestamp: string;
  location: { lat: number, lng: number };
  photoUrl?: string;
  status: "pending" | "approved" | "rejected";
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");

  useEffect(() => {
    fetchExpenses();
  }, []);

  const fetchExpenses = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/expenses");
      if (res.ok) setExpenses(await res.json());
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAction = async (expenseId: string, status: "approved" | "rejected") => {
    setProcessingId(expenseId);
    try {
      const res = await fetch("/api/expenses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expenseId, status })
      });
      if (res.ok) {
        setExpenses(expenses.map(e => {
          if (e._id === expenseId) {
            // Optimistically update wallet balance if approved
            const updatedBalance = status === "approved" 
              ? (e.driverId?.walletBalance || 0) - e.amount 
              : e.driverId?.walletBalance;
              
            return {
              ...e,
              status,
              driverId: { ...e.driverId, walletBalance: updatedBalance }
            };
          }
          return e;
        }));
      }
    } catch (error) {
      console.error(error);
    } finally {
      setProcessingId(null);
    }
  };

  const filteredExpenses = expenses.filter(e => statusFilter === "all" || e.status === statusFilter);

  const stats = {
    pendingAmount: expenses.filter(e => e.status === "pending").reduce((sum, e) => sum + e.amount, 0),
    approvedAmount: expenses.filter(e => e.status === "approved").reduce((sum, e) => sum + e.amount, 0),
    pendingCount: expenses.filter(e => e.status === "pending").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-white">Expense Management</h1>
        
        <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1">
          <button
            onClick={() => setViewMode("list")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              viewMode === "list" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            List View
          </button>
          <button
            onClick={() => setViewMode("map")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              viewMode === "map" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Map View
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-slate-900 border-slate-800 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-400">Total Pending</p>
            <p className="text-2xl font-bold text-amber-400">₹{stats.pendingAmount.toFixed(2)}</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
            <Clock className="w-5 h-5 text-amber-500" />
          </div>
        </Card>
        <Card className="bg-slate-900 border-slate-800 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-400">Total Approved</p>
            <p className="text-2xl font-bold text-emerald-400">₹{stats.approvedAmount.toFixed(2)}</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          </div>
        </Card>
        <Card className="bg-slate-900 border-slate-800 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-400">Pending Requests</p>
            <p className="text-2xl font-bold text-white">{stats.pendingCount}</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center">
            <Activity className="w-5 h-5 text-indigo-500" />
          </div>
        </Card>
      </div>

      <Card className="bg-slate-900 border-slate-800 text-slate-100 flex flex-col overflow-hidden">
        {viewMode === "list" ? (
          <>
            <div className="border-b border-slate-800 p-4 flex items-center gap-2 overflow-x-auto">
              {(["all", "pending", "approved", "rejected"] as const).map(filter => (
                <button
                  key={filter}
                  onClick={() => setStatusFilter(filter)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium capitalize whitespace-nowrap transition-colors ${
                    statusFilter === filter 
                      ? "bg-slate-800 text-white" 
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>

            <Table>
              <TableHeader className="bg-slate-950/50">
                <TableRow className="border-slate-800">
                  <TableHead className="text-slate-400">Driver & Balance</TableHead>
                  <TableHead className="text-slate-400">Expense Detail</TableHead>
                  <TableHead className="text-slate-400">Location/Receipt</TableHead>
                  <TableHead className="text-slate-400">Status</TableHead>
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
                ) : filteredExpenses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                      No expenses found in this filter.
                    </TableCell>
                  </TableRow>
                ) : filteredExpenses.map((expense: ExpenseItem) => (
                  <TableRow key={expense._id} className="border-slate-800 hover:bg-slate-800/30">
                    <TableCell>
                      <div className="font-semibold text-white">
                        {expense.driverId?.userId?.name || "Unknown"}
                      </div>
                      <div className="flex items-center text-xs mt-1 gap-1" title="Current Driver Wallet Balance">
                        <Wallet className="w-3 h-3 text-slate-500" />
                        <span className={(expense.driverId?.walletBalance || 0) < expense.amount ? "text-rose-400 font-medium" : "text-amber-400/80"}>
                          ₹{(expense.driverId?.walletBalance || 0).toFixed(2)}
                        </span>
                      </div>
                    </TableCell>
                    
                    <TableCell>
                      <div className="text-amber-400 font-mono text-lg font-bold">
                        ₹{expense.amount.toFixed(2)}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {expense.category && (
                          <Badge variant="outline" className="text-[10px] h-5 border-slate-700 text-slate-300">
                            {expense.category}
                          </Badge>
                        )}
                        <span className="text-xs text-slate-500">
                          {expense.timestamp && !isNaN(new Date(expense.timestamp).getTime()) 
                            ? format(new Date(expense.timestamp), "MMM dd, HH:mm") 
                            : "N/A"}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="flex flex-col gap-1.5">
                        <a href={`https://maps.google.com/?q=${expense.location.lat},${expense.location.lng}`} target="_blank" rel="noreferrer" className="flex items-center text-xs text-sky-400 hover:text-sky-300 w-fit px-2 py-1 rounded-md bg-sky-500/10">
                          <MapPin className="w-3 h-3 mr-1" /> View Map
                        </a>
                        {expense.photoUrl && (
                          <a href={expense.photoUrl} target="_blank" rel="noreferrer" className="flex items-center text-xs text-indigo-400 hover:text-indigo-300 w-fit px-2 py-1 rounded-md bg-indigo-500/10">
                            <Receipt className="w-3 h-3 mr-1" /> Receipt
                          </a>
                        )}
                      </div>
                    </TableCell>

                    <TableCell>
                      {expense.status === "pending" && <Badge className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20">Pending</Badge>}
                      {expense.status === "approved" && <Badge className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20">Approved</Badge>}
                      {expense.status === "rejected" && <Badge className="bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 border-rose-500/20">Rejected</Badge>}
                    </TableCell>

                    <TableCell className="text-right">
                      {expense.status === "pending" ? (
                        <div className="flex justify-end gap-2">
                          <Button 
                            size="sm" 
                            className="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-500 border border-emerald-500/30"
                            disabled={processingId === expense._id}
                            onClick={() => handleAction(expense._id, "approved")}
                            title="Approve & Deduct from Wallet"
                          >
                            {processingId === expense._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                            Approve
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="border-rose-500/30 text-rose-500 hover:bg-rose-500/10"
                            disabled={processingId === expense._id}
                            onClick={() => handleAction(expense._id, "rejected")}
                          >
                            {processingId === expense._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500 font-medium bg-slate-800/50 px-3 py-1.5 rounded-md">Processed</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        ) : (
          <div className="p-4 bg-slate-950/50 min-h-[600px] rounded-xl overflow-hidden m-4 border border-slate-800 relative z-0">
            <ExpenseMap expenses={filteredExpenses} />
          </div>
        )}
      </Card>
    </div>
  );
}
