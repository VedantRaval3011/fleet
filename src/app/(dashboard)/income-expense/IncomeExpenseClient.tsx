"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Check, CheckCircle2, Clock, Loader2, MapPin, Plus, Receipt, RefreshCw, Search, Wallet, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatINR } from "@/lib/incomeExpenseFormat";
import { api, type ExpenseDTO, type LedgerEntryDTO, type Page, type SummaryResponse } from "./apiClient";
import { AllocateAdvanceDialog } from "./AllocateAdvanceDialog";
import { Pager } from "./Pager";
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
  status: TxnStatus;
  expense?: ExpenseDTO;
  balanceAfter: number | null;
}

const LIMIT = 25;

const FILTERS: { key: FeedFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "To be approved" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "advance", label: "Money added" },
];

const STATUS_LABEL: Record<TxnStatus, string> = {
  pending: "To be approved",
  approved: "Approved",
  rejected: "Rejected",
  advance: "Money added",
};

const STATUS_BADGE: Record<TxnStatus, string> = {
  pending: "border-amber-500/20 bg-amber-500/10 text-amber-500",
  approved: "border-emerald-500/20 bg-emerald-500/10 text-emerald-500",
  rejected: "border-rose-500/20 bg-rose-500/10 text-rose-500",
  advance: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
};

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
    status: "advance",
    balanceAfter: e.balanceAfter,
  };
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

function Stat({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: ComponentType<{ className?: string }>;
  tone: string;
}) {
  return (
    <Card className="flex items-center justify-between border-slate-800 bg-slate-900 p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-400">{label}</p>
        <p className={`mt-1 truncate font-mono text-2xl font-bold ${tone}`}>{value}</p>
        {sub && <p className="mt-0.5 truncate text-xs text-slate-500">{sub}</p>}
      </div>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-800/70">
        <Icon className={`h-5 w-5 ${tone}`} />
      </div>
    </Card>
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
  const [feedError, setFeedError] = useState("");

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
    fetchFeed(page, filter, selectedId)
      .then((data) => {
        if (feedGen.current !== gen) return;
        setExpenses(data.expenses);
        setAdvances(data.advances);
        setExpenseTotal(data.expenseTotal);
        setAdvanceTotal(data.advanceTotal);
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
  }, [filter, selectedId, page, refreshKey]);

  const driversById = useMemo(
    () => new Map((summary?.drivers ?? []).map((d) => [d.driverId, d])),
    [summary]
  );
  const drivers = useMemo(
    () => (summary?.drivers ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [summary]
  );

  const selected = selectedId ? driversById.get(selectedId) : undefined;
  const totals = summary?.totals;
  const available = selected ? selected.balance : totals?.netBalance ?? 0;
  const approved = selected ? selected.totalApproved : totals?.totalApproved ?? 0;
  const toApprove = selected ? selected.totalPending : totals?.totalPending ?? 0;
  const figure = summaryLoading && !summary ? "—" : null;

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

  const tableTotal =
    filter === "advance" ? advanceTotal : filter === "all" ? Math.max(expenseTotal, advanceTotal) : expenseTotal;

  const availableSub = selected
    ? selected.excessAmount > 0
      ? "Overdrawn · payable to this driver"
      : selected.name
    : totals && totals.totalExcess > 0
      ? `${formatINR(totals.totalExcess)} payable to overdrawn drivers`
      : `Across ${totals?.driverCount ?? 0} ${(totals?.driverCount ?? 0) === 1 ? "driver" : "drivers"}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Expenses</h1>
          <p className="mt-1 text-sm text-slate-400">Available balance, approvals, and every transaction.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="border-slate-700 bg-transparent text-slate-300"
            onClick={refresh}
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setAllocateFor(selectedId ?? undefined)}>
            <Plus className="mr-1 h-4 w-4" /> Add money
          </Button>
        </div>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="text-emerald-400 hover:text-white" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {summaryError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{summaryError}</div>
      )}
      {totals && totals.driftedCount > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          {totals.driftedCount} driver {totals.driftedCount === 1 ? "balance does" : "balances do"} not match the ledger.
          Figures here come from the ledger.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="Available balance"
          value={figure ?? formatINR(available)}
          sub={availableSub}
          icon={Wallet}
          tone={available < 0 ? "text-rose-400" : "text-emerald-400"}
        />
        <Stat
          label="Approved"
          value={figure ?? formatINR(approved)}
          sub="Confirmed by HR / admin"
          icon={CheckCircle2}
          tone="text-emerald-400"
        />
        <Stat
          label="To be approved"
          value={figure ?? formatINR(toApprove)}
          sub={`${(selected ? selected.pendingCount : totals?.pendingCount) ?? 0} waiting`}
          icon={Clock}
          tone="text-amber-400"
        />
      </div>

      <Card className="overflow-hidden border-slate-800 bg-slate-900 text-slate-100">
        <div className="flex flex-col gap-3 border-b border-slate-800 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 overflow-x-auto">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => {
                  setFilter(f.key);
                  setPage(1);
                }}
                className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  filter === f.key ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                }`}
              >
                {f.label}
                {f.key === "pending" && (totals?.pendingCount ?? 0) > 0 && (
                  <span className="ml-1.5 text-xs text-amber-400">{totals?.pendingCount}</span>
                )}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              value={selectedId ?? "all"}
              onValueChange={(id) => {
                setSelectedId(id === "all" ? null : id);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full border-slate-700 bg-slate-950 text-slate-200 sm:w-52">
                <SelectValue placeholder="All drivers" />
              </SelectTrigger>
              <SelectContent className="border-slate-800 bg-slate-900 text-slate-200">
                <SelectItem value="all">All drivers</SelectItem>
                {drivers.map((d) => (
                  <SelectItem key={d.driverId} value={d.driverId}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative sm:w-64">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search this page"
                aria-label="Search transactions"
                className="h-9 border-slate-700 bg-slate-950 pl-9 text-slate-200"
              />
            </div>
          </div>
        </div>

        {feedError && <p className="px-4 pt-4 text-sm text-rose-400">{feedError}</p>}

        <Table>
          <TableHeader className="bg-slate-950/50">
            <TableRow className="border-slate-800">
              <TableHead className="text-slate-400">Date</TableHead>
              <TableHead className="text-slate-400">Driver</TableHead>
              <TableHead className="text-slate-400">Transaction</TableHead>
              <TableHead className="text-slate-400">Status</TableHead>
              <TableHead className="text-right text-slate-400">Amount</TableHead>
              <TableHead className="text-right text-slate-400">Balance after</TableHead>
              <TableHead className="text-right text-slate-400">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {feedLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-indigo-500" />
                </TableCell>
              </TableRow>
            ) : txns.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-slate-500">
                  {search.trim() ? "No transactions on this page match that search." : "No transactions in this view."}
                </TableCell>
              </TableRow>
            ) : (
              txns.map((txn) => (
                <TableRow key={txn.key} className="border-slate-800 align-top hover:bg-slate-800/30">
                  <TableCell className="whitespace-nowrap text-xs text-slate-400">{formatDateTime(txn.at)}</TableCell>
                  <TableCell className="font-medium text-white">{txn.driverName}</TableCell>
                  <TableCell className="max-w-xs">
                    <div className="text-sm text-slate-200">{txn.title}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="h-5 border-slate-700 text-[10px] text-slate-300">
                        {txn.category}
                      </Badge>
                      {txn.expense && (
                        <a
                          href={txn.expense.receiptUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center rounded-md bg-indigo-500/10 px-2 py-1 text-xs text-indigo-400 hover:text-indigo-300"
                        >
                          <Receipt className="mr-1 h-3 w-3" /> Receipt
                        </a>
                      )}
                      {txn.expense?.location && (
                        <a
                          href={`https://maps.google.com/?q=${txn.expense.location.lat},${txn.expense.location.lng}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center rounded-md bg-sky-500/10 px-2 py-1 text-xs text-sky-400 hover:text-sky-300"
                        >
                          <MapPin className="mr-1 h-3 w-3" /> Location
                        </a>
                      )}
                    </div>
                    {txn.expense?.status === "rejected" && txn.expense.rejectionReason && (
                      <p className="mt-1.5 text-xs text-rose-300">Reason: {txn.expense.rejectionReason}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_BADGE[txn.status]}>
                      {STATUS_LABEL[txn.status]}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={`whitespace-nowrap text-right font-mono text-base font-bold ${
                      txn.credit ? "text-emerald-400" : txn.status === "rejected" ? "text-slate-500 line-through" : "text-amber-400"
                    }`}
                  >
                    {txn.credit ? "+" : "−"}
                    {formatINR(txn.amount)}
                  </TableCell>
                  <TableCell
                    className={`whitespace-nowrap text-right font-mono ${
                      txn.balanceAfter === null ? "text-slate-600" : txn.balanceAfter < 0 ? "text-rose-400" : "text-slate-200"
                    }`}
                  >
                    {txn.balanceAfter === null ? "—" : formatINR(txn.balanceAfter)}
                  </TableCell>
                  <TableCell className="text-right">
                    {txn.status === "pending" && txn.expense ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          className="border border-emerald-500/30 bg-emerald-600/20 text-emerald-500 hover:bg-emerald-600/30"
                          onClick={() => setReview({ expense: txn.expense!, mode: "approve" })}
                        >
                          <Check className="mr-1 h-4 w-4" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-rose-500/30 text-rose-500 hover:bg-rose-500/10"
                          onClick={() => setReview({ expense: txn.expense!, mode: "reject" })}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {!search.trim() && (
          <Pager page={page} limit={LIMIT} total={tableTotal} onPage={(p) => setPage(p)} />
        )}
      </Card>

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
