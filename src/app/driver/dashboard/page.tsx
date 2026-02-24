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

export default async function DriverDashboard() {
  const session = await getServerSession(authOptions);
  
  await connectToDatabase();
  
  // Fetch the driver's profile to get the real wallet balance
  const driver = await Driver.findOne({ userId: session?.user.id });
  
  // Fetch recent expenses
  const recentExpenses = await Expense.find({ driverId: driver?._id })
    .sort({ timestamp: -1 })
    .limit(5);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-white">Hello, {session?.user.name?.split(' ')[0]} 👋</h1>
        <p className="text-slate-400 text-sm">Welcome to your driver portal.</p>
      </div>

      <Card className="bg-gradient-to-br from-indigo-900 to-slate-900 border-indigo-500/30 overflow-hidden relative">
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <Wallet className="w-24 h-24" />
        </div>
        <CardContent className="p-6 relative z-10">
          <p className="text-indigo-200 text-sm font-medium mb-1">Your Wallet Balance</p>
          <h2 className="text-4xl font-extrabold text-white tracking-tight">
            ${driver?.walletBalance?.toFixed(2) || "0.00"}
          </h2>
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
                    <p className="font-semibold text-white">${expense.amount.toFixed(2)}</p>
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
