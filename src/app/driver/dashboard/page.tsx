import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlusCircle, Wallet, Receipt, ChevronRight } from "lucide-react";
import Link from "next/link";
import Driver from "@/models/Driver";
import Expense from "@/models/Expense";
import connectToDatabase from "@/lib/db";
import { format } from "date-fns";

import WalletTransaction from "@/models/WalletTransaction";

export default async function DriverDashboard() {
  const session = await getServerSession(authOptions);
  
  await connectToDatabase();
  
  // Fetch the driver's profile to get the real wallet balance
  const driver = await Driver.findOne({ userId: session?.user.id });
  
  // Fetch recent expenses
  const recentExpenses = await Expense.find({ driverId: driver?._id })
    .sort({ timestamp: -1 })
    .limit(5);

  // Calculate current month's spent amount (approved deductions)
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const monthDeductions = await WalletTransaction.aggregate([
    { 
      $match: { 
        driverId: driver?._id, 
        type: 'deduction',
        timestamp: { $gte: startOfMonth }
      } 
    },
    { $group: { _id: null, total: { $sum: "$amount" } } }
  ]);
  
  const spentThisMonth = monthDeductions[0]?.total || 0;
  const currentBalance = driver?.walletBalance || 0;
  const totalAllocated = currentBalance + spentThisMonth; // Approximation of their "budget" for visual purposes
  const spendPercentage = totalAllocated > 0 ? (spentThisMonth / totalAllocated) * 100 : 0;
  const isLowBalance = currentBalance > 0 && currentBalance < 500; // Warning threshold

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-white">Hello, {session?.user.name?.split(' ')[0]} 👋</h1>
        <p className="text-slate-400 text-sm">Welcome to your driver portal.</p>
      </div>

      <Card className={`relative overflow-hidden border ${isLowBalance ? 'bg-gradient-to-br from-rose-950 to-slate-900 border-rose-500/50' : 'bg-gradient-to-br from-indigo-900 to-slate-900 border-indigo-500/30'}`}>
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <Wallet className="w-24 h-24" />
        </div>
        <CardContent className="p-6 relative z-10 space-y-4">
          <div>
            <p className={`${isLowBalance ? 'text-rose-200' : 'text-indigo-200'} text-sm font-medium mb-1 flex items-center gap-2`}>
              Available Balance
              {isLowBalance && <span className="text-xs bg-rose-500/20 text-rose-400 px-2 py-0.5 rounded-full border border-rose-500/30">Low</span>}
            </p>
            <h2 className={`text-4xl font-extrabold tracking-tight ${isLowBalance ? 'text-rose-400' : 'text-white'}`}>
              ₹{currentBalance.toFixed(2)}
            </h2>
          </div>

          <div className="space-y-2 pt-2">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Spent this month</span>
              <span className="text-slate-300 font-medium">₹{spentThisMonth.toFixed(2)}</span>
            </div>
            <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden flex">
              <div 
                className={`h-full ${isLowBalance ? 'bg-rose-500' : 'bg-indigo-500'}`} 
                style={{ width: `${Math.min(100, Math.max(5, spendPercentage))}%` }} 
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Link href="/driver/add-expense" className="block">
        <Button className="w-full h-16 text-lg font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-900/20 rounded-xl">
          <PlusCircle className="mr-2 w-6 h-6" /> Add New Expense
        </Button>
      </Link>

      <div className="pt-4">
        <h3 className="text-lg font-semibold text-white mb-4">Recent Expenses</h3>
        {recentExpenses.length === 0 ? (
          <div className="text-center py-8 bg-slate-900 rounded-xl border border-slate-800 border-dashed">
            <Receipt className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-slate-500 text-sm">No expenses submitted yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentExpenses.map((expense) => (
              <div key={expense._id.toString()} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${
                    expense.status === 'approved' ? 'bg-emerald-500/10 text-emerald-500' :
                    expense.status === 'rejected' ? 'bg-rose-500/10 text-rose-500' :
                    'bg-amber-500/10 text-amber-500'
                  }`}>
                    <Receipt className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-white">₹{expense.amount.toFixed(2)}</p>
                    <p className="text-xs text-slate-400">{format(new Date(expense.timestamp), "MMM dd, yyyy")}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                    expense.status === 'approved' ? 'bg-emerald-500/10 text-emerald-500' :
                    expense.status === 'rejected' ? 'bg-rose-500/10 text-rose-500' :
                    'bg-amber-500/10 text-amber-500'
                  }`}>
                    {expense.status.charAt(0).toUpperCase() + expense.status.slice(1)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
