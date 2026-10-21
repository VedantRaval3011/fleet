"use client";

import { useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatINR } from "@/lib/incomeExpenseFormat";
import { api, newIdempotencyKey, type AccountRow, type LedgerEntryDTO } from "./apiClient";

const QUICK_AMOUNTS = [1000, 5000, 10000];

interface Props {
  drivers: AccountRow[];
  initialDriverId?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}

/**
 * Mounted only while open (the parent renders it conditionally), so every open
 * gets fresh state and a fresh idempotency key.
 */
export function AllocateAdvanceDialog({ drivers, initialDriverId, onClose, onDone }: Props) {
  const [driverId, setDriverId] = useState(initialDriverId ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Stable for this dialog's lifetime: retrying after a network error cannot create a second advance.
  const keyRef = useRef(newIdempotencyKey());

  const driver = drivers.find((d) => d.driverId === driverId);
  const parsed = Number(amount);
  const validAmount = amount.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
  const newBalance = driver && validAmount ? Math.round((driver.balance + parsed) * 100) / 100 : null;

  async function submit() {
    if (!driver) return setError("Choose a driver.");
    if (!validAmount) return setError("Enter a valid positive amount.");
    setSubmitting(true);
    setError("");
    try {
      const res = await api<{ entry: LedgerEntryDTO; balance: number; duplicate: boolean }>(
        "/api/income-expense/advances",
        {
          method: "POST",
          body: JSON.stringify({
            driverId,
            amount: parsed,
            note: note.trim() || undefined,
            idempotencyKey: keyRef.current,
          }),
        }
      );
      onDone(
        `${res.entry.isAdditionalAdvance ? "Additional advance" : "Advance"} of ${formatINR(res.entry.amount)} allocated to ${driver.name}. New balance ${formatINR(res.balance)}.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not allocate the advance.");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Allocate advance</DialogTitle>
          <DialogDescription className="text-slate-400">
            Recorded as its own ledger entry. Earlier advances and expenses are never changed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-slate-300">Driver</Label>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger className="w-full bg-slate-950 border-slate-700 text-slate-200">
                <SelectValue placeholder="Select a driver" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                {drivers.map((d) => (
                  <SelectItem key={d.driverId} value={d.driverId}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {driver && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Current balance</span>
                <span className={driver.balance < 0 ? "font-semibold text-rose-400" : "font-semibold text-slate-100"}>
                  {formatINR(driver.balance)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Advances received so far</span>
                <span className="text-slate-300">
                  {formatINR(driver.totalAdvance)} ({driver.advanceCount})
                </span>
              </div>
              {driver.excessAmount > 0 && (
                <p className="pt-1 text-xs text-amber-300">
                  This driver is overdrawn by {formatINR(driver.excessAmount)} (payable to the driver). A new advance
                  offsets it first.
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-slate-300">Amount (₹)</Label>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="e.g. 5000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-11 bg-slate-950 border-slate-700 text-lg font-semibold text-emerald-400"
            />
            <div className="flex gap-2 pt-1">
              {QUICK_AMOUNTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setAmount(String(q))}
                  className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800"
                >
                  {formatINR(q).replace(".00", "")}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-slate-300">
              Note <span className="text-slate-500">(optional)</span>
            </Label>
            <Input
              maxLength={500}
              placeholder="e.g. Weekly allowance"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="bg-slate-950 border-slate-700 text-slate-200"
            />
          </div>

          {newBalance !== null && (
            <div
              className={`rounded-lg border p-3 text-sm ${
                newBalance < 0
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
              }`}
            >
              New balance will be <span className="font-bold">{formatINR(newBalance)}</span>
              {newBalance < 0 && " (still overdrawn)"}
            </div>
          )}

          {error && <p className="text-sm text-rose-400">{error}</p>}

          <div className="flex gap-3 pt-1">
            <Button
              variant="outline"
              className="flex-1 border-slate-600 bg-transparent text-slate-300"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
              onClick={submit}
              disabled={submitting || !driver || !validAmount}
            >
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Allocate {validAmount ? formatINR(parsed) : ""}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
