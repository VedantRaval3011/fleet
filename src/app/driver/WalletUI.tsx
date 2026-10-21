import Link from "next/link";
import {
  ArrowDownLeft,
  Car,
  Fuel,
  Package,
  ParkingSquare,
  Receipt,
  RotateCcw,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ActivityItem } from "@/lib/driverActivity";
import { groupByDay } from "@/lib/driverActivity";
import type { ExpenseDTO } from "@/lib/expenseLedger";

export const CATEGORY_STYLE: Record<string, { icon: LucideIcon; tone: string }> = {
  Fuel: { icon: Fuel, tone: "bg-orange-500/15 text-orange-300" },
  Toll: { icon: Car, tone: "bg-sky-500/15 text-sky-300" },
  Food: { icon: UtensilsCrossed, tone: "bg-pink-500/15 text-pink-300" },
  Parking: { icon: ParkingSquare, tone: "bg-violet-500/15 text-violet-300" },
  Maintenance: { icon: Wrench, tone: "bg-amber-500/15 text-amber-300" },
  Other: { icon: Package, tone: "bg-slate-500/20 text-slate-300" },
};

export const EXPENSE_STATUS: Record<ExpenseDTO["status"], { label: string; tone: string }> = {
  pending: { label: "Awaiting approval", tone: "bg-amber-500/10 text-amber-400 ring-amber-500/20" },
  approved: { label: "Approved", tone: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20" },
  rejected: { label: "Rejected · refunded", tone: "bg-rose-500/10 text-rose-400 ring-rose-500/20" },
};

export function expenseStatus(e: Pick<ExpenseDTO, "status" | "deductedOnSubmit">) {
  if (e.status === "rejected" && !e.deductedOnSubmit) return { ...EXPENSE_STATUS.rejected, label: "Rejected" };
  return EXPENSE_STATUS[e.status];
}

/** ₹1,200 without paise when whole, like a payments app. */
export function formatRupees(amount: number): string {
  const whole = Number.isInteger(Math.round(amount * 100) / 100);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function CategoryBadge({ category, size = "md" }: { category: string; size?: "md" | "lg" }) {
  const s = CATEGORY_STYLE[category] ?? CATEGORY_STYLE.Other;
  const Icon = s.icon;
  const box = size === "lg" ? "h-16 w-16" : "h-11 w-11";
  const icon = size === "lg" ? "h-8 w-8" : "h-5 w-5";
  return (
    <span className={`flex ${box} shrink-0 items-center justify-center rounded-full ${s.tone}`}>
      <Icon className={icon} />
    </span>
  );
}

export function StatusPill({ expense }: { expense: Pick<ExpenseDTO, "status" | "deductedOnSubmit"> }) {
  const s = expenseStatus(expense);
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${s.tone}`}>{s.label}</span>;
}

function timeOf(iso: string, timeZone: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone });
}

function ActivityRow({ item, timeZone }: { item: ActivityItem; timeZone: string }) {
  const credit = item.direction === "credit";
  const e = item.expense;
  const struck = e?.status === "rejected";

  const body = (
    <div className="flex items-center gap-3 px-4 py-3">
      {e ? (
        <CategoryBadge category={e.category} />
      ) : (
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
            item.kind === "refund" ? "bg-teal-500/15 text-teal-300" : "bg-emerald-500/15 text-emerald-300"
          }`}
        >
          {item.kind === "refund" ? <RotateCcw className="h-5 w-5" /> : <ArrowDownLeft className="h-5 w-5" />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-100">{item.title}</p>
        <p className="truncate text-xs text-slate-500">
          {timeOf(item.at, timeZone)} · {item.subtitle}
        </p>
        {e && (
          <div className="mt-1">
            <StatusPill expense={e} />
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p
          className={`font-semibold tabular-nums ${credit ? "text-emerald-400" : "text-slate-100"} ${
            struck ? "line-through decoration-slate-500" : ""
          }`}
        >
          {credit ? "+" : "−"}
          {formatRupees(item.amount)}
        </p>
        {item.balanceAfter !== null && (
          <p className={`text-[11px] tabular-nums ${item.balanceAfter < 0 ? "text-rose-400" : "text-slate-500"}`}>
            Bal {formatRupees(item.balanceAfter)}
          </p>
        )}
      </div>
    </div>
  );

  return e ? (
    <Link href={`/driver/transactions/${e.id}`} className="block transition-colors hover:bg-slate-800/50 active:bg-slate-800">
      {body}
    </Link>
  ) : (
    body
  );
}

export function ActivityFeed({
  items,
  timeZone,
  empty = "No transactions yet.",
}: {
  items: ActivityItem[];
  timeZone: string;
  empty?: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/60 py-10 text-center">
        <Receipt className="mx-auto mb-2 h-8 w-8 text-slate-600" />
        <p className="text-sm text-slate-500">{empty}</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {groupByDay(items, new Date(), timeZone).map((g) => (
        <section key={g.label}>
          <h3 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.label}</h3>
          <div className="divide-y divide-slate-800/70 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            {g.items.map((item) => (
              <ActivityRow key={item.key} item={item} timeZone={timeZone} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The big balance card at the top of the driver portal. */
export function WalletCard({
  balance,
  totalAdvance,
  spent,
  pendingCount,
}: {
  balance: number;
  totalAdvance: number;
  spent: number;
  pendingCount: number;
}) {
  const negative = balance < 0;
  return (
    <div
      className={`relative overflow-hidden rounded-3xl p-6 shadow-xl ${
        negative
          ? "bg-gradient-to-br from-rose-600 via-rose-700 to-rose-900 shadow-rose-950/40"
          : "bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-800 shadow-indigo-950/40"
      }`}
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-16 -left-6 h-40 w-40 rounded-full bg-black/10" />
      <p className="relative text-sm font-medium text-white/80">Wallet balance</p>
      <p className="relative mt-1 text-4xl font-extrabold tracking-tight text-white tabular-nums">{formatRupees(balance)}</p>
      {negative && (
        <p className="relative mt-2 text-sm text-white/90">
          You have spent {formatRupees(-balance)} more than you were given. This is owed to you and is cleared by your next
          advance.
        </p>
      )}
      <div className="relative mt-5 grid grid-cols-3 gap-2 text-white">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-white/60">Received</p>
          <p className="font-semibold tabular-nums">{formatRupees(totalAdvance)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-white/60">Spent</p>
          <p className="font-semibold tabular-nums">{formatRupees(spent)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-white/60">In review</p>
          <p className="font-semibold tabular-nums">{pendingCount}</p>
        </div>
      </div>
    </div>
  );
}