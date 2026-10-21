"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  TrendingDown,
  Wallet,
  XCircle,
  Banknote,
  Scale,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatINR } from "@/lib/incomeExpenseFormat";
import { api, type AccountRow, type ExpenseDTO, type SummaryResponse } from "./apiClient";
import { AllocateAdvanceDialog } from "./AllocateAdvanceDialog";
import { DriverDetailDialog } from "./DriverDetailDialog";
import { ExpensesPanel } from "./ExpensesPanel";
import { LedgerPanel } from "./LedgerPanel";
import { ReviewDialog } from "./ReviewDialog";

type Tab = "drivers" | "approvals" | "ledger";

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
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}) {
  return (
    <Card className="flex items-start justify-between gap-3 border-slate-800 bg-slate-900 p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-400">{label}</p>
        <p className={`mt-1 truncate font-mono text-2xl font-bold ${tone}`}>{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      </div>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-800/70">
        <Icon className={`h-5 w-5 ${tone}`} />
      </div>
    </Card>
  );
}

export default function IncomeExpenseClient() {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("drivers");
  const [search, setSearch] = useState("");
  // Bumped after every change so the lists inside the tabs and dialogs refetch.
  const [refreshKey, setRefreshKey] = useState(0);

  const [allocate, setAllocate] = useState<{ driverId?: string } | null>(null);
  const [review, setReview] = useState<{ expense: ExpenseDTO; mode: "approve" | "reject" } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    api<SummaryResponse>("/api/income-expense/summary")
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
        setError("");
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  const driversById = useMemo(
    () => new Map((summary?.drivers ?? []).map((d) => [d.driverId, d])),
    [summary]
  );
  const visibleDrivers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (summary?.drivers ?? []).filter((d) => !q || d.name.toLowerCase().includes(q) || d.email.toLowerCase().includes(q));
  }, [summary, search]);

  const t = summary?.totals;
  const detail = detailId ? driversById.get(detailId) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Income &amp; Expense</h1>
          <p className="mt-1 text-sm text-slate-400">
            Driver advances, expense approvals and the full transaction ledger.
          </p>
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
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setAllocate({})}>
            <Plus className="mr-1 h-4 w-4" /> Allocate advance
          </Button>
        </div>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} className="text-emerald-400 hover:text-white" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}
      {t && t.driftedCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t.driftedCount} driver {t.driftedCount === 1 ? "balance does" : "balances do"} not match the ledger (highlighted
            below). The figures on this page come from the ledger. Run{" "}
            <code className="rounded bg-slate-900 px-1">node scripts/migrate-expense-ledger.mjs</code> to migrate older
            data, or add <code className="rounded bg-slate-900 px-1">--reconcile</code> to repair a stale balance.
          </span>
        </div>
      )}

      {loading && !summary ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
        </div>
      ) : (
        t && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                label="Advances distributed"
                value={formatINR(t.totalAdvance)}
                sub={`across ${t.driverCount} ${t.driverCount === 1 ? "driver" : "drivers"}`}
                icon={Banknote}
                tone="text-emerald-400"
              />
              <Stat
                label="Expenses submitted"
                value={formatINR(t.totalSubmitted)}
                sub={`${formatINR(t.totalRejected)} rejected`}
                icon={Wallet}
                tone="text-slate-100"
              />
              <Stat
                label="Approved"
                value={formatINR(t.totalApproved)}
                sub="confirmed by HR / admin"
                icon={CheckCircle2}
                tone="text-indigo-300"
              />
              <Stat
                label="Pending approval"
                value={formatINR(t.totalPending)}
                sub={`${t.pendingCount} ${t.pendingCount === 1 ? "expense" : "expenses"} waiting`}
                icon={Clock}
                tone="text-amber-400"
              />
              <Stat
                label="Remaining balances"
                value={formatINR(t.totalRemaining)}
                sub="unspent advances (drivers in credit)"
                icon={Scale}
                tone="text-emerald-400"
              />
              <Stat
                label="Excess spending"
                value={formatINR(t.totalExcess)}
                sub={
                  t.overdrawnCount > 0
                    ? `payable to ${t.overdrawnCount} ${t.overdrawnCount === 1 ? "driver" : "drivers"}`
                    : "no driver is overdrawn"
                }
                icon={TrendingDown}
                tone={t.totalExcess > 0 ? "text-rose-400" : "text-slate-500"}
              />
              <Stat
                label="Net position"
                value={formatINR(t.netBalance)}
                sub="advances − spent (pending + approved)"
                icon={Scale}
                tone={t.netBalance < 0 ? "text-rose-400" : "text-slate-100"}
              />
              <Stat
                label="Rejected"
                value={formatINR(t.totalRejected)}
                sub="not charged to the driver"
                icon={XCircle}
                tone="text-slate-400"
              />
            </div>

            <Card className="overflow-hidden border-slate-800 bg-slate-900 text-slate-100">
              <div className="flex gap-1 border-b border-slate-800 p-2">
                {(
                  [
                    ["drivers", "Driver accounts"],
                    ["approvals", "Approvals"],
                    ["ledger", "Transaction ledger"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                      tab === key ? "bg-indigo-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    {label}
                    {key === "approvals" && t.pendingCount > 0 && (
                      <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-slate-950">
                        {t.pendingCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {tab === "drivers" && (
                <div>
                  <div className="border-b border-slate-800 p-4">
                    <div className="relative max-w-xs">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search drivers"
                        className="h-9 border-slate-700 bg-slate-950 pl-9 text-slate-200"
                      />
                    </div>
                  </div>
                  <Table>
                    <TableHeader className="bg-slate-950/50">
                      <TableRow className="border-slate-800">
                        <TableHead className="text-slate-400">Driver</TableHead>
                        <TableHead className="text-right text-slate-400">Advance received</TableHead>
                        <TableHead className="text-right text-slate-400">Submitted</TableHead>
                        <TableHead className="text-right text-slate-400">Approved</TableHead>
                        <TableHead className="text-right text-slate-400">Pending</TableHead>
                        <TableHead className="text-right text-slate-400">Remaining balance</TableHead>
                        <TableHead className="text-right text-slate-400">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleDrivers.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="h-24 text-center text-slate-500">
                            {summary?.drivers.length ? "No drivers match your search." : "No drivers found."}
                          </TableCell>
                        </TableRow>
                      ) : (
                        visibleDrivers.map((d: AccountRow) => (
                          <TableRow
                            key={d.driverId}
                            className={`cursor-pointer border-slate-800 hover:bg-slate-800/40 ${d.drifted ? "bg-amber-500/5" : ""}`}
                            onClick={() => setDetailId(d.driverId)}
                          >
                            <TableCell>
                              <div className="font-semibold text-white">{d.name}</div>
                              <div className="flex items-center gap-2 text-xs text-slate-500">
                                {d.email}
                                {d.status !== "active" && (
                                  <Badge variant="outline" className="border-slate-600 text-[10px] text-slate-400">
                                    inactive
                                  </Badge>
                                )}
                                {d.drifted && (
                                  <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-400">
                                    stored balance {formatINR(d.cachedBalance)}
                                  </Badge>
                                )}
                              </div>
                              {d.lastActivityAt && (
                                <div className="text-[11px] text-slate-600">last activity {formatDateTime(d.lastActivityAt)}</div>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono text-emerald-400">{formatINR(d.totalAdvance)}</TableCell>
                            <TableCell className="text-right font-mono text-slate-300">{formatINR(d.totalSubmitted)}</TableCell>
                            <TableCell className="text-right font-mono text-indigo-300">{formatINR(d.totalApproved)}</TableCell>
                            <TableCell className="text-right font-mono text-amber-400">
                              {formatINR(d.totalPending)}
                              {d.pendingCount > 0 && <div className="text-[11px] text-slate-500">{d.pendingCount} waiting</div>}
                            </TableCell>
                            <TableCell className="text-right">
                              <div
                                className={`font-mono text-lg font-bold ${d.balance < 0 ? "text-rose-400" : d.balance === 0 ? "text-slate-500" : "text-emerald-400"}`}
                              >
                                {formatINR(d.balance)}
                              </div>
                              {d.excessAmount > 0 && (
                                <div className="text-[11px] text-rose-300">excess {formatINR(d.excessAmount)} · payable to driver</div>
                              )}
                              {d.excessAmount === 0 && d.balanceIfPendingApproved < 0 && (
                                <div className="text-[11px] text-amber-300">
                                  pending would overdraw by {formatINR(-d.balanceIfPendingApproved)}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  className="bg-indigo-600 text-white hover:bg-indigo-700"
                                  onClick={() => setAllocate({ driverId: d.driverId })}
                                >
                                  <Plus className="mr-1 h-4 w-4" /> Advance
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-slate-700 bg-transparent text-slate-300"
                                  onClick={() => setDetailId(d.driverId)}
                                >
                                  <History className="mr-1 h-4 w-4" /> History
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}

              {tab === "approvals" && (
                <ExpensesPanel
                  driversById={driversById}
                  refreshKey={refreshKey}
                  onReview={(expense, mode) => setReview({ expense, mode })}
                />
              )}

              {tab === "ledger" && <LedgerPanel drivers={summary?.drivers} refreshKey={refreshKey} />}
            </Card>
          </>
        )
      )}

      {allocate && (
        <AllocateAdvanceDialog
          drivers={summary?.drivers ?? []}
          initialDriverId={allocate.driverId}
          onClose={() => setAllocate(null)}
          onDone={(msg) => {
            setAllocate(null);
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
            refresh(); // also picks up "already reviewed" races
          }}
          onDone={(msg) => {
            setReview(null);
            setNotice(msg);
            refresh();
          }}
        />
      )}

      {detail && (
        <DriverDetailDialog
          account={detail}
          driversById={driversById}
          refreshKey={refreshKey}
          onClose={() => setDetailId(null)}
          onAllocate={(driverId) => setAllocate({ driverId })}
          onReview={(expense, mode) => setReview({ expense, mode })}
        />
      )}
    </div>
  );
}
