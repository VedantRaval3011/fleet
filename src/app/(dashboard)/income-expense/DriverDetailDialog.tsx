"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatINR } from "@/lib/incomeExpenseFormat";
import type { AccountRow, ExpenseDTO } from "./apiClient";
import { ExpensesPanel } from "./ExpensesPanel";
import { LedgerPanel } from "./LedgerPanel";

interface Props {
  account: AccountRow;
  driversById: Map<string, AccountRow>;
  refreshKey: number;
  onClose: () => void;
  onAllocate: (driverId: string) => void;
  onReview: (expense: ExpenseDTO, mode: "approve" | "reject") => void;
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 font-mono text-base font-bold ${tone ?? "text-slate-100"}`}>{value}</p>
    </div>
  );
}

export function DriverDetailDialog({ account, driversById, refreshKey, onClose, onAllocate, onReview }: Props) {
  const [view, setView] = useState<"ledger" | "expenses">("ledger");
  const overdrawn = account.excessAmount > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-slate-900 border-slate-800 text-slate-100 sm:max-w-5xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-3 pr-6">
            <div>
              <DialogTitle className="text-xl">{account.name}</DialogTitle>
              <DialogDescription className="text-slate-400">{account.email}</DialogDescription>
            </div>
            <Button className="bg-indigo-600 text-white hover:bg-indigo-700" onClick={() => onAllocate(account.driverId)}>
              <Plus className="mr-1 h-4 w-4" /> Allocate advance
            </Button>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Figure label="Advance received" value={formatINR(account.totalAdvance)} tone="text-emerald-400" />
          <Figure label="Submitted" value={formatINR(account.totalSubmitted)} />
          <Figure label="Approved" value={formatINR(account.totalApproved)} tone="text-indigo-300" />
          <Figure label="Pending" value={formatINR(account.totalPending)} tone="text-amber-400" />
          <Figure label="Rejected" value={formatINR(account.totalRejected)} tone="text-slate-400" />
          <Figure
            label={overdrawn ? "Balance (overdrawn)" : "Remaining balance"}
            value={formatINR(account.balance)}
            tone={overdrawn ? "text-rose-400" : "text-emerald-400"}
          />
        </div>

        {overdrawn && (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
            Spending exceeds the advances by <span className="font-bold">{formatINR(account.excessAmount)}</span>.
            This is an outstanding amount payable to the driver; allocating another advance offsets it.
          </p>
        )}

        <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1 w-fit">
          {(["ledger", "expenses"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                view === v ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {v === "ledger" ? "Transaction history" : "Expenses"}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-800">
          {view === "ledger" ? (
            <LedgerPanel driverId={account.driverId} refreshKey={refreshKey} pageSize={10} />
          ) : (
            <ExpensesPanel
              driverId={account.driverId}
              driversById={driversById}
              refreshKey={refreshKey}
              initialStatus="all"
              pageSize={8}
              onReview={onReview}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
