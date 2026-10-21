import { getServerSession } from "next-auth";
import Link from "next/link";
import { ChevronRight, History, Plus, ScrollText } from "lucide-react";
import { authOptions } from "@/lib/auth";
import Driver from "@/models/Driver";
import connectToDatabase from "@/lib/db";
import { getDriverAccount, listExpenses, listWalletCredits } from "@/lib/expenseLedger";
import { buildActivity } from "@/lib/driverActivity";
import { getShiftTimezone } from "@/lib/shiftConfig";
import { ActivityFeed, WalletCard } from "../WalletUI";
import { ShiftCard } from "../ShiftCard";

export const dynamic = "force-dynamic";

const RECENT = 8;

function Action({ href, icon: Icon, label, primary }: { href: string; icon: typeof Plus; label: string; primary?: boolean }) {
  return (
    <Link href={href} className="group flex flex-col items-center gap-1.5">
      <span
        className={`flex h-14 w-14 items-center justify-center rounded-2xl transition-transform group-active:scale-95 ${
          primary
            ? "bg-emerald-500 text-white shadow-lg shadow-emerald-900/40 group-hover:bg-emerald-400"
            : "border border-slate-800 bg-slate-900 text-indigo-300 group-hover:bg-slate-800"
        }`}
      >
        <Icon className="h-6 w-6" />
      </span>
      <span className="text-xs font-medium text-slate-300">{label}</span>
    </Link>
  );
}

export default async function DriverDashboard() {
  const session = await getServerSession(authOptions);
  await connectToDatabase();

  const driver = await Driver.findOne({ userId: session?.user.id }).select("_id").lean();
  const driverId = driver ? String(driver._id) : null;

  const [account, recent, credits] = driverId
    ? await Promise.all([
        getDriverAccount(driverId),
        listExpenses({ driverId, limit: RECENT }),
        listWalletCredits(driverId, RECENT),
      ])
    : [null, { items: [] }, []];

  const activity = buildActivity(recent.items, credits).slice(0, RECENT);
  const firstName = session?.user.name?.split(" ")[0] ?? "Driver";

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-400">Hello,</p>
        <h1 className="text-2xl font-bold text-white">{firstName} 👋</h1>
      </div>

      {!account ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
          Your driver profile is not set up yet. Please contact HR.
        </div>
      ) : (
        <WalletCard
          balance={account.balance}
          totalAdvance={account.totalAdvance}
          spent={account.totalApproved + account.totalPending}
          pendingCount={account.pendingCount}
        />
      )}

      <div className="grid grid-cols-3 gap-2">
        <Action href="/driver/add-expense" icon={Plus} label="Add expense" primary />
        <Action href="/driver/history" icon={History} label="History" />
        <Action href="/driver/history?filter=pending" icon={ScrollText} label="In review" />
      </div>

      <ShiftCard />

      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-lg font-semibold text-white">Recent transactions</h2>
          <Link href="/driver/history" className="flex items-center text-sm text-indigo-400 hover:text-indigo-300">
            See all <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        <ActivityFeed items={activity} timeZone={getShiftTimezone()} empty="No transactions yet. Add your first expense." />
      </section>
    </div>
  );
}
