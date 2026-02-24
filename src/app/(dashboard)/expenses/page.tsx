"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Check, X, MapPin, Receipt } from "lucide-react";
import { format } from "date-fns";
import ExpenseMap from "@/components/ExpenseMap";

interface ExpenseItem {
  _id: string;
  driverId: {
    userId: {
      name: string;
      email: string;
    }
  };
  amount: number;
  category?: string;
  timestamp: string;
  location: { lat: number, lng: number };
  photoUrl?: string;
  status: "pending" | "approved" | "rejected";
  walletBalanceAfter?: number;
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "map">("list");

  useEffect(() => {
    fetchExpenses();
  }, []);

  const fetchExpenses = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/expenses");
      if (res.ok) {
        const data = await res.json();
        setExpenses(data);
      }
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
        setExpenses(expenses.map((e: ExpenseItem) => e._id === expenseId ? { ...e, status } : e));
      }
    } catch (error) {
      console.error(error);
    } finally {
      setProcessingId(null);
    }
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

      <Card className="bg-slate-900 border-slate-800 text-slate-100">
        {viewMode === "list" ? (
        <Table>
          <TableHeader className="bg-slate-950/50">
            <TableRow className="border-slate-800">
              <TableHead className="text-slate-400">Driver</TableHead>
              <TableHead className="text-slate-400">Amount</TableHead>
              <TableHead className="text-slate-400">Date</TableHead>
              <TableHead className="text-slate-400">Location/Receipt</TableHead>
              <TableHead className="text-slate-400">Status</TableHead>
              <TableHead className="text-slate-400 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-indigo-500" />
                </TableCell>
              </TableRow>
            ) : expenses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-slate-500">
                  No expenses found.
                </TableCell>
              </TableRow>
            ) : expenses.map((expense: ExpenseItem) => (
              <TableRow key={expense._id} className="border-slate-800">
                <TableCell className="font-medium text-white">
                  {expense.driverId?.userId?.name || "Unknown"}
                </TableCell>
                <TableCell className="text-amber-400 font-mono text-lg">
                  ${expense.amount.toFixed(2)}
                </TableCell>
                <TableCell className="text-slate-400">
                  {expense.timestamp && !isNaN(new Date(expense.timestamp).getTime()) 
                    ? format(new Date(expense.timestamp), "MMM dd, yyyy HH:mm") 
                    : "N/A"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <a href={`https://maps.google.com/?q=${expense.location.lat},${expense.location.lng}`} target="_blank" rel="noreferrer" className="flex items-center text-xs text-sky-400 hover:text-sky-300">
                      <MapPin className="w-3 h-3 mr-1" /> View Map
                    </a>
                    {expense.photoUrl && (
                      <a href={expense.photoUrl} target="_blank" rel="noreferrer" className="flex items-center text-xs text-indigo-400 hover:text-indigo-300">
                        <Receipt className="w-3 h-3 mr-1" /> View Receipt
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
                        variant="outline" 
                        className="border-emerald-500/50 text-emerald-500 hover:bg-emerald-500/10"
                        disabled={processingId === expense._id}
                        onClick={() => handleAction(expense._id, "approved")}
                      >
                        {processingId === expense._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="border-rose-500/50 text-rose-500 hover:bg-rose-500/10"
                        disabled={processingId === expense._id}
                        onClick={() => handleAction(expense._id, "rejected")}
                      >
                        {processingId === expense._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">Processed</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        ) : (
          <div className="p-4">
            <ExpenseMap expenses={expenses} />
          </div>
        )}
      </Card>
    </div>
  );
}
