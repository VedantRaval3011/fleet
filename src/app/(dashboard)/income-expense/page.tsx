import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canManageIncomeExpense } from "@/lib/expenseMath";
import IncomeExpenseClient from "./IncomeExpenseClient";

export const dynamic = "force-dynamic";

export default async function IncomeExpensePage() {
  const session = await getServerSession(authOptions);

  // The API enforces this too; checking here just avoids showing a broken page.
  if (!canManageIncomeExpense(session?.user?.role)) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        You do not have permission to view Income &amp; Expense.
      </div>
    );
  }

  return <IncomeExpenseClient />;
}
