"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatINR, LEDGER_TYPE_LABEL } from "@/lib/incomeExpenseFormat";
import {
  api,
  endOfLocalDayISO,
  startOfLocalDayISO,
  type AccountRow,
  type LedgerEntryDTO,
  type Page,
} from "./apiClient";
import { Pager } from "./Pager";

const TYPE_STYLE: Record<string, string> = {
  advance: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  expense_submitted: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  expense_approved: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300",
  expense_rejected: "border-rose-500/30 bg-rose-500/10 text-rose-400",
};

interface Props {
  /** Fix the ledger to one driver (driver detail view); otherwise show a driver filter. */
  driverId?: string;
  drivers?: AccountRow[];
  /** Bump to refetch after something changed elsewhere. */
  refreshKey: number;
  pageSize?: number;
}

function Description({ e }: { e: LedgerEntryDTO }) {
  switch (e.type) {
    case "advance":
      return (
        <span>
          {e.note || "Advance allocation"}
          {e.isAdditionalAdvance && (
            <Badge variant="outline" className="ml-2 border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-400">
              additional
            </Badge>
          )}
        </span>
      );
    case "expense_submitted":
      return <span className="text-slate-400">Expense submitted for approval</span>;
    case "expense_approved":
      return (
        <span>
          Expense approved
          {e.excessAmount > 0 && (
            <span className="ml-2 text-rose-400">· {formatINR(e.excessAmount)} over balance</span>
          )}
        </span>
      );
    case "expense_rejected":
      return <span>Rejected{e.note ? `: ${e.note}` : ""}</span>;
  }
}

export function LedgerPanel({ driverId, drivers = [], refreshKey, pageSize = 20 }: Props) {
  const [type, setType] = useState("all");
  const [driverFilter, setDriverFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<LedgerEntryDTO> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const effectiveDriver = driverId ?? (driverFilter === "all" ? undefined : driverFilter);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ page: String(page), limit: String(pageSize) });
    if (effectiveDriver) qs.set("driverId", effectiveDriver);
    if (type !== "all") qs.set("type", type);
    if (from) qs.set("from", startOfLocalDayISO(from));
    if (to) qs.set("to", endOfLocalDayISO(to));
    api<Page<LedgerEntryDTO>>(`/api/income-expense/ledger?${qs}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError("");
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load the ledger."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [effectiveDriver, type, from, to, page, pageSize, refreshKey]);

  // Any filter change goes back to page 1 and shows the spinner again.
  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
    setLoading(true);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-800 p-4">
        {!driverId && (
          <div className="w-52">
            <label className="mb-1 block text-xs text-slate-500">Driver</label>
            <Select value={driverFilter} onValueChange={change(setDriverFilter)}>
              <SelectTrigger className="w-full bg-slate-950 border-slate-700 text-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                <SelectItem value="all">All drivers</SelectItem>
                {drivers.map((d) => (
                  <SelectItem key={d.driverId} value={d.driverId}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="w-52">
          <label className="mb-1 block text-xs text-slate-500">Type</label>
          <Select value={type} onValueChange={change(setType)}>
            <SelectTrigger className="w-full bg-slate-950 border-slate-700 text-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
              <SelectItem value="all">All transactions</SelectItem>
              {Object.entries(LEDGER_TYPE_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">From</label>
          <Input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => change(setFrom)(e.target.value)}
            className="h-9 w-40 bg-slate-950 border-slate-700 text-slate-200"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">To</label>
          <Input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => change(setTo)(e.target.value)}
            className="h-9 w-40 bg-slate-950 border-slate-700 text-slate-200"
          />
        </div>
      </div>

      {error && <p className="p-4 text-sm text-rose-400">{error}</p>}

      <Table>
        <TableHeader className="bg-slate-950/50">
          <TableRow className="border-slate-800">
            <TableHead className="text-slate-400">Date</TableHead>
            {!driverId && <TableHead className="text-slate-400">Driver</TableHead>}
            <TableHead className="text-slate-400">Transaction</TableHead>
            <TableHead className="text-slate-400">Details</TableHead>
            <TableHead className="text-right text-slate-400">Amount</TableHead>
            <TableHead className="text-right text-slate-400">Balance after</TableHead>
            <TableHead className="text-slate-400">Done by</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={7} className="h-32 text-center">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-indigo-500" />
              </TableCell>
            </TableRow>
          ) : !data || data.items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center text-slate-500">
                No transactions match these filters.
              </TableCell>
            </TableRow>
          ) : (
            data.items.map((e) => (
              <TableRow key={e.id} className="border-slate-800 hover:bg-slate-800/30">
                <TableCell className="whitespace-nowrap text-xs text-slate-400">{formatDateTime(e.timestamp)}</TableCell>
                {!driverId && <TableCell className="font-medium text-white">{e.driverName}</TableCell>}
                <TableCell>
                  <Badge variant="outline" className={TYPE_STYLE[e.type]}>
                    {LEDGER_TYPE_LABEL[e.type]}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-xs text-sm text-slate-300">
                  <Description e={e} />
                </TableCell>
                <TableCell
                  className={`whitespace-nowrap text-right font-mono ${
                    e.balanceEffect > 0 ? "text-emerald-400" : e.balanceEffect < 0 ? "text-rose-400" : "text-slate-400"
                  }`}
                >
                  {e.balanceEffect > 0 ? "+" : e.balanceEffect < 0 ? "−" : ""}
                  {formatINR(e.amount).replace("-", "")}
                </TableCell>
                <TableCell
                  className={`whitespace-nowrap text-right font-mono ${e.balanceAfter < 0 ? "text-rose-400" : "text-slate-200"}`}
                >
                  {formatINR(e.balanceAfter)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-slate-400">
                  {e.performedByName}
                  {e.performedByRole && <span className="ml-1 text-slate-600">({e.performedByRole})</span>}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={change(setPage)} />}
    </div>
  );
}
