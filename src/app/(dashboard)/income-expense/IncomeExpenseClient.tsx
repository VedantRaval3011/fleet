"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  Car,
  Check,
  Fuel,
  Loader2,
  MapPin,
  Package,
  ParkingSquare,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  UtensilsCrossed,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { formatINR } from "@/lib/incomeExpenseFormat";
import { api, type AccountRow, type ExpenseDTO, type LedgerEntryDTO, type Page, type SummaryResponse } from "./apiClient";
import { AllocateAdvanceDialog } from "./AllocateAdvanceDialog";
import { ReviewDialog } from "./ReviewDialog";

type FeedFilter = "all" | "pending" | "approved" | "rejected" | "advance";

type TxnStatus = "pending" | "approved" | "rejected" | "advance";

interface Txn {
  key: string;
  at: string;
  title: string;
  driverName: string;
  driverId: string;
  category: string;
  amount: number;
  credit: boolean;
  struck: boolean;
  status: TxnStatus;
  expense?: ExpenseDTO;
  note?: string | null;
  balanceAfter: number | null;
}

const LIMIT = 30;

const FILTERS: { key: FeedFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "To be approved" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "advance", label: "Money added" },
];

const CATEGORY_ICON: Record<string, { icon: LucideIcon; bg: string; fg: string }> = {
  Fuel: { icon: Fuel, bg: "#fce8e6", fg: "#c5221f" },
  Toll: { icon: Car, bg: "#e8f0fe", fg: "#1a73e8" },
  Food: { icon: UtensilsCrossed, bg: "#fce8f3", fg: "#c2185b" },
  Parking: { icon: ParkingSquare, bg: "#f3e8fd", fg: "#7b1fa2" },
  Maintenance: { icon: Wrench, bg: "#fef7e0", fg: "#e37400" },
  Other: { icon: Package, bg: "#f1f3f4", fg: "#5f6368" },
  Advance: { icon: ArrowDownLeft, bg: "#e6f4ea", fg: "#137333" },
};

const STATUS_LABEL: Record<TxnStatus, string> = {
  pending: "To be approved",
  approved: "Approved",
  rejected: "Rejected",
  advance: "Money added",
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "");
  return letters.toUpperCase();
}

function timeOf(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function dayKey(d: Date) {
  return d.toLocaleDateString("en-CA");
}

function dayLabel(iso: string, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  const k = dayKey(d);
  if (k === dayKey(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (k === dayKey(yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function groupTxns(items: Txn[]) {
  const groups: { label: string; items: Txn[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.at);
    const last = groups[groups.length - 1];
    if (!last || last.label !== label) groups.push({ label, items: [item] });
    else last.items.push(item);
  }
  return groups;
}

function expenseTxn(e: ExpenseDTO): Txn {
  return {
    key: `e:${e.id}`,
    at: e.submittedAt,
    title: e.description || e.category,
    driverName: e.driverName,
    driverId: e.driverId,
    category: e.category,
    amount: e.amount,
    credit: false,
    struck: e.status === "rejected",
    status: e.status,
    expense: e,
    balanceAfter: e.walletBalanceAfter,
  };
}

function advanceTxn(e: LedgerEntryDTO): Txn {
  return {
    key: `a:${e.id}`,
    at: e.timestamp,
    title: e.note || "Money added",
    driverName: e.driverName,
    driverId: e.driverId,
    category: "Advance",
    amount: e.amount,
    credit: true,
    struck: false,
    status: "advance",
    note: e.note,
    balanceAfter: e.balanceAfter,
  };
}

function dedupe<T>(items: T[], idOf: (item: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const id = idOf(item);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

async function fetchFeed(page: number, filter: FeedFilter, driverId: string | null) {
  const drv = driverId ? `&driverId=${encodeURIComponent(driverId)}` : "";
  if (filter === "advance") {
    const advances = await api<Page<LedgerEntryDTO>>(
      `/api/income-expense/ledger?type=advance&page=${page}&limit=${LIMIT}${drv}`
    );
    return { expenses: [] as ExpenseDTO[], advances: advances.items, expenseTotal: 0, advanceTotal: advances.total };
  }
  const status = filter === "all" ? "all" : filter;
  const expensesPromise = api<Page<ExpenseDTO>>(
    `/api/income-expense/expenses?status=${status}&page=${page}&limit=${LIMIT}${drv}`
  );
  const advancesPromise =
    filter === "all"
      ? api<Page<LedgerEntryDTO>>(`/api/income-expense/ledger?type=advance&page=${page}&limit=${LIMIT}${drv}`)
      : Promise.resolve(null);
  const [expenses, advances] = await Promise.all([expensesPromise, advancesPromise]);
  return {
    expenses: expenses.items,
    advances: advances?.items ?? [],
    expenseTotal: expenses.total,
    advanceTotal: advances?.total ?? 0,
  };
}

function Mark({ category }: { category: string }) {
  const style = CATEGORY_ICON[category] ?? CATEGORY_ICON.Other;
  const Icon = style.icon;
  return (
    <span
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: style.bg, color: style.fg }}
    >
      <Icon className="h-5 w-5" aria-hidden />
    </span>
  );
}

export default function IncomeExpenseClient() {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [filter, setFilter] = useState<FeedFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [expenses, setExpenses] = useState<ExpenseDTO[]>([]);
  const [advances, setAdvances] = useState<LedgerEntryDTO[]>([]);
  const [page, setPage] = useState(1);
  const [expenseTotal, setExpenseTotal] = useState(0);
  const [advanceTotal, setAdvanceTotal] = useState(0);
  const [feedLoading, setFeedLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const [allocateFor, setAllocateFor] = useState<string | undefined | null>(null);
  const [review, setReview] = useState<{ expense: ExpenseDTO; mode: "approve" | "reject" } | null>(null);
  const feedGen = useRef(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    api<SummaryResponse>("/api/income-expense/summary")
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
        setSummaryError("");
      })
      .catch((e) => !cancelled && setSummaryError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => !cancelled && setSummaryLoading(false));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const gen = ++feedGen.current;
    setFeedLoading(true);
    setFeedError("");
    setOpenKey(null);
    fetchFeed(1, filter, selectedId)
      .then((data) => {
        if (feedGen.current !== gen) return;
        setExpenses(data.expenses);
        setAdvances(data.advances);
        setExpenseTotal(data.expenseTotal);
        setAdvanceTotal(data.advanceTotal);
        setPage(1);
      })
      .catch((e) => {
        if (feedGen.current !== gen) return;
        setFeedError(e instanceof Error ? e.message : "Failed to load transactions.");
        setExpenses([]);
        setAdvances([]);
      })
      .finally(() => {
        if (feedGen.current === gen) setFeedLoading(false);
      });
  }, [filter, selectedId, refreshKey]);

  const driversById = useMemo(
    () => new Map((summary?.drivers ?? []).map((d) => [d.driverId, d])),
    [summary]
  );

  const selected = selectedId ? driversById.get(selectedId) : undefined;
  const totals = summary?.totals;

  const available = selected ? selected.balance : totals?.netBalance ?? 0;
  const approved = selected ? selected.totalApproved : totals?.totalApproved ?? 0;
  const toApprove = selected ? selected.totalPending : totals?.totalPending ?? 0;

  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (summary?.drivers ?? [])
      .filter((d) => !q || d.name.toLowerCase().includes(q) || d.email.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => b.pendingCount - a.pendingCount || a.name.localeCompare(b.name));
  }, [summary, search]);

  const txns = useMemo(() => {
    const q = search.trim().toLowerCase();
    const merged = [...expenses.map(expenseTxn), ...advances.map(advanceTxn)].sort(
      (a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key)
    );
    if (!q) return merged;
    return merged.filter((t) =>
      `${t.title} ${t.driverName} ${t.category} ${STATUS_LABEL[t.status]}`.toLowerCase().includes(q)
    );
  }, [expenses, advances, search]);

  const hasMore =
    filter === "advance"
      ? page * LIMIT < advanceTotal
      : page * LIMIT < expenseTotal || (filter === "all" && page * LIMIT < advanceTotal);

  async function loadMore() {
    const next = page + 1;
    const gen = feedGen.current;
    setLoadingMore(true);
    setFeedError("");
    try {
      const data = await fetchFeed(next, filter, selectedId);
      if (feedGen.current !== gen) return;
      setExpenses((prev) => dedupe([...prev, ...data.expenses], (e) => e.id));
      setAdvances((prev) => dedupe([...prev, ...data.advances], (e) => e.id));
      setExpenseTotal(data.expenseTotal);
      setAdvanceTotal(data.advanceTotal);
      setPage(next);
    } catch (e) {
      setFeedError(e instanceof Error ? e.message : "Failed to load more transactions.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="-m-4 min-h-full bg-[#f8f9fa] px-4 py-5 text-[#202124] sm:-m-6 sm:px-6 md:-m-8">
      <div className="mx-auto max-w-lg">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-[22px] font-medium tracking-tight">Expenses</h1>
          <button
            type="button"
            onClick={refresh}
            className="rounded-full p-2 text-[#5f6368] hover:bg-[#e8eaed]"
            aria-label="Refresh"
          >
            <RefreshCw className="h-5 w-5" />
          </button>
        </div>

        {notice && (
          <div className="mb-3 flex items-start justify-between gap-3 rounded-2xl bg-[#e6f4ea] px-4 py-3 text-sm text-[#137333]">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice("")} aria-label="Dismiss" className="text-[#137333]">
              ×
            </button>
          </div>
        )}
        {summaryError && (
          <div className="mb-3 rounded-2xl bg-[#fce8e6] px-4 py-3 text-sm text-[#c5221f]">{summaryError}</div>
        )}
        {totals && totals.driftedCount > 0 && (
          <div className="mb-3 rounded-2xl bg-[#fef7e0] px-4 py-3 text-sm text-[#b06000]">
            {totals.driftedCount} driver {totals.driftedCount === 1 ? "balance does" : "balances do"} not match the
            ledger. Figures here come from the ledger.
          </div>
        )}

        <section className="overflow-hidden rounded-[28px] bg-gradient-to-br from-[#1a73e8] to-[#174ea6] p-6 text-white shadow-lg shadow-[#1a73e8]/20">
          <p className="text-sm text-white/80">{selected ? selected.name : "Available balance"}</p>
          <p className="mt-1 text-4xl font-medium tracking-tight tabular-nums">
            {summaryLoading && !summary ? "—" : formatINR(available)}
          </p>
          <p className="mt-1 text-sm text-white/75">
            {selected
              ? selected.excessAmount > 0
                ? "Overdrawn · payable to this driver"
                : "Available to spend"
              : totals && totals.totalExcess > 0
                ? `Across ${totals.driverCount} drivers · ${formatINR(totals.totalExcess)} payable to overdrawn drivers`
                : `Across ${totals?.driverCount ?? 0} ${(totals?.driverCount ?? 0) === 1 ? "driver" : "drivers"}`}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/20 pt-4">
            <div>
              <p className="text-xs text-white/70">Approved</p>
              <p className="mt-0.5 text-lg font-medium tabular-nums">{summaryLoading && !summary ? "—" : formatINR(approved)}</p>
            </div>
            <div>
              <p className="text-xs text-white/70">To be approved</p>
              <p className="mt-0.5 text-lg font-medium tabular-nums">{summaryLoading && !summary ? "—" : formatINR(toApprove)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAllocateFor(selectedId ?? undefined)}
            className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-medium text-[#1a73e8] hover:bg-[#e8f0fe]"
          >
            <Plus className="h-4 w-4" />
            Add money
          </button>
        </section>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5f6368]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search transactions or drivers"
            aria-label="Search transactions or drivers"
            className="h-11 w-full rounded-full border-0 bg-white pl-10 pr-4 text-sm text-[#202124] shadow-sm outline-none ring-1 ring-[#dadce0] placeholder:text-[#80868b] focus:ring-2 focus:ring-[#1a73e8]"
          />
        </div>

        <div className="mt-4 flex gap-3 overflow-x-auto pb-1" aria-label="Drivers">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            aria-pressed={selectedId === null}
            className="flex w-16 shrink-0 flex-col items-center gap-1"
          >
            <span
              className={`flex h-12 w-12 items-center justify-center rounded-full text-sm font-medium ${
                selectedId === null ? "bg-[#1a73e8] text-white" : "bg-white text-[#1a73e8] ring-1 ring-[#dadce0]"
              }`}
            >
              All
            </span>
            <span className="w-full truncate text-center text-[11px] text-[#5f6368]">Everyone</span>
          </button>
          {people.map((d: AccountRow) => {
            const on = selectedId === d.driverId;
            return (
              <button
                key={d.driverId}
                type="button"
                onClick={() => setSelectedId(on ? null : d.driverId)}
                aria-pressed={on}
                className="flex w-16 shrink-0 flex-col items-center gap-1"
                title={d.name}
              >
                <span
                  className={`relative flex h-12 w-12 items-center justify-center rounded-full text-sm font-medium ${
                    on ? "bg-[#1a73e8] text-white" : "bg-white text-[#1a73e8] ring-1 ring-[#dadce0]"
                  }`}
                >
                  {initials(d.name)}
                  {d.pendingCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#e37400] px-1 text-[10px] font-medium text-white">
                      {d.pendingCount}
                    </span>
                  )}
                </span>
                <span className="w-full truncate text-center text-[11px] text-[#3c4043]">{d.name}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Transaction filter">
          {FILTERS.map((f) => {
            const on = filter === f.key;
            const count = f.key === "pending" ? totals?.pendingCount ?? 0 : 0;
            return (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setFilter(f.key)}
                className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium ${
                  on ? "bg-[#e8f0fe] text-[#1967d2]" : "bg-white text-[#3c4043] ring-1 ring-[#dadce0]"
                }`}
              >
                {f.label}
                {count > 0 && <span className="ml-1.5 text-xs">{count}</span>}
              </button>
            );
          })}
        </div>

        <section className="mt-4" aria-label="Transactions">
          {feedError && <p className="mb-2 text-sm text-[#c5221f]">{feedError}</p>}
          {feedLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-[#1a73e8]" />
            </div>
          ) : txns.length === 0 ? (
            <div className="rounded-3xl bg-white px-6 py-12 text-center shadow-sm">
              <Receipt className="mx-auto h-8 w-8 text-[#dadce0]" />
              <p className="mt-2 text-sm text-[#5f6368]">
                {search.trim() ? "No transactions match that search." : "No transactions yet."}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {groupTxns(txns).map((group) => (
                <div key={group.label}>
                  <h2 className="mb-1.5 px-1 text-xs font-medium uppercase tracking-wide text-[#5f6368]">{group.label}</h2>
                  <ul className="overflow-hidden rounded-3xl bg-white shadow-sm">
                    {group.items.map((txn, index) => {
                      const open = openKey === txn.key;
                      const pending = txn.status === "pending" && txn.expense;
                      return (
                        <li key={txn.key} className={index > 0 ? "border-t border-[#f1f3f4]" : ""}>
                          <button
                            type="button"
                            onClick={() => setOpenKey(open ? null : txn.key)}
                            aria-expanded={open}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#f8f9fa]"
                          >
                            <Mark category={txn.category} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[15px] font-medium text-[#202124]">{txn.title}</span>
                              <span className="mt-0.5 block truncate text-xs text-[#5f6368]">
                                {txn.driverName} · {timeOf(txn.at)}
                                {txn.status !== "advance" ? ` · ${STATUS_LABEL[txn.status]}` : ""}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span
                                className={`block text-[15px] font-medium tabular-nums ${
                                  txn.credit ? "text-[#137333]" : "text-[#202124]"
                                } ${txn.struck ? "line-through text-[#80868b]" : ""}`}
                              >
                                {txn.credit ? "+" : "−"}
                                {formatINR(txn.amount)}
                              </span>
                              {txn.balanceAfter !== null && (
                                <span
                                  className={`mt-0.5 block text-[11px] tabular-nums ${
                                    txn.balanceAfter < 0 ? "text-[#c5221f]" : "text-[#80868b]"
                                  }`}
                                >
                                  Bal {formatINR(txn.balanceAfter)}
                                </span>
                              )}
                            </span>
                          </button>
                          {open && (
                            <div className="space-y-3 bg-[#f8f9fa] px-4 py-3 text-sm text-[#3c4043]">
                              <p>
                                {txn.category}
                                {txn.status === "advance" && txn.note ? ` · ${txn.note}` : ""}
                              </p>
                              {txn.expense?.status === "rejected" && txn.expense.rejectionReason && (
                                <p className="text-[#c5221f]">Rejected: {txn.expense.rejectionReason}</p>
                              )}
                              {txn.expense && (
                                <div className="flex flex-wrap items-center gap-3">
                                  <a
                                    href={txn.expense.receiptUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-[#1a73e8]"
                                  >
                                    <Receipt className="h-4 w-4" />
                                    Receipt
                                  </a>
                                  {txn.expense.location && (
                                    <a
                                      href={`https://maps.google.com/?q=${txn.expense.location.lat},${txn.expense.location.lng}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 text-[#1a73e8]"
                                    >
                                      <MapPin className="h-4 w-4" />
                                      Location
                                    </a>
                                  )}
                                </div>
                              )}
                              {pending && (
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setReview({ expense: txn.expense!, mode: "approve" })}
                                    className="inline-flex items-center gap-1 rounded-full bg-[#1a73e8] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#174ea6]"
                                  >
                                    <Check className="h-4 w-4" />
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setReview({ expense: txn.expense!, mode: "reject" })}
                                    className="inline-flex items-center gap-1 rounded-full px-4 py-1.5 text-sm font-medium text-[#c5221f] hover:bg-[#fce8e6]"
                                  >
                                    <X className="h-4 w-4" />
                                    Decline
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {hasMore && !search.trim() && (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="flex w-full items-center justify-center gap-2 py-2 text-sm font-medium text-[#1a73e8] disabled:opacity-60"
                >
                  {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                  Show older transactions
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {allocateFor !== null && (
        <AllocateAdvanceDialog
          drivers={summary?.drivers ?? []}
          initialDriverId={allocateFor}
          onClose={() => setAllocateFor(null)}
          onDone={(msg) => {
            setAllocateFor(null);
            setNotice(msg);
            refresh();
          }}
        />
      )}

      {review && (
        <ReviewDialog
          expense={review.expense}
          mode={review.mode}
          driverBalance={driversById.get(review.expense.driverId)?.balance ?? 0}
          onClose={() => {
            setReview(null);
            refresh();
          }}
          onDone={(msg) => {
            setReview(null);
            setNotice(msg);
            refresh();
          }}
        />
      )}
    </div>
  );
}
