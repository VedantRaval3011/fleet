import { getServerSession } from "next-auth";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import Driver from "@/models/Driver";
import { getDriverAccount, listExpenses, listWalletCredits } from "@/lib/expenseLedger";
import { ACTIVITY_FILTERS, buildActivity, isActivityFilter } from "@/lib/driverActivity";
import { getShiftTimezone } from "@/lib/shiftConfig";
import { ActivityFeed, formatRupees } from "../WalletUI";

export const dynamic = "force-dynamic";

const PAGE = 100;

export default async function DriverHistoryPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const session = await getServerSession(authOptions);
  const { filter: rawFilter } = await searchParams;
  const filter = isActivityFilter(rawFilter) ? rawFilter : "all";
  await connectToDatabase();

  const driver = await Driver.findOne({ userId: session?.user.id }).select("_id").lean();
  const driverId = driver ? String(driver._id) : null;

  const [account, expenses, credits] = driverId
    ? await Promise.all([
        getDriverAccount(driverId),
        listExpenses({ driverId, limit: PAGE, ...(filter === "pending" ? { status: "pending" as const } : {}) }),
        listWalletCredits(driverId, PAGE),
      ])
    : [null, null, null];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/driver/dashboard" className="-ml-2 rounded-full p-2 text-slate-400 hover:bg-slate-800" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-white">Transaction history</h1>
      </div>

      {!account || !expenses || !credits ? (
        <p className="text-sm text-slate-400">Your driver profile is not set up yet. Please contact HR.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 divide-x divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900 py-3 text-center">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Received</p>
              <p className="font-semibold tabular-nums text-emerald-400">{formatRupees(account.totalAdvance)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Spent</p>
              <p className="font-semibold tabular-nums text-slate-100">
                {formatRupees(account.totalApproved + account.totalPending)}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Balance</p>
              <p className={`font-semibold tabular-nums ${account.balance < 0 ? "text-rose-400" : "text-white"}`}>
                {formatRupees(account.balance)}
              </p>
            </div>
          </div>

          <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Filter transactions">
            {ACTIVITY_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={f.key === "all" ? "/driver/history" : `/driver/history?filter=${f.key}`}
                className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium ring-1 transition-colors ${
                  filter === f.key
                    ? "bg-indigo-500 text-white ring-indigo-500"
                    : "bg-slate-900 text-slate-300 ring-slate-800 hover:bg-slate-800"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </nav>

          <ActivityFeed
            items={buildActivity(expenses.items, credits, filter)}
            timeZone={getShiftTimezone()}
            empty={filter === "pending" ? "Nothing is waiting for approval." : "No transactions in this view."}
          />
          {expenses.total > expenses.items.length && (
            <p className="text-center text-xs text-slate-500">Showing your latest {expenses.items.length} expenses.</p>
          )}
        </>
      )}
    </div>
  );
}
