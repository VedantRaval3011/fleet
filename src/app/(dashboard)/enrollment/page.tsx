"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Plus, QrCode, X, Copy, Check, RefreshCw } from "lucide-react";
import { format } from "date-fns";

interface EnrollmentCode {
  _id: string;
  code: string;
  employeeName?: string;
  employeeId?: string;
  role: "driver" | "employee";
  vehicle?: string;
  capabilities?: string[];
  expiresAt?: string;
  usedAt?: string;
  revoked: boolean;
  createdAt: string;
}

const defaultForm = {
  employeeName: "",
  employeeId: "",
  role: "driver" as "driver" | "employee",
  vehicle: "",
  capabilities: "",
  expiresInHours: 48,
};

export default function EnrollmentPage() {
  const [codes, setCodes] = useState<EnrollmentCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchCodes = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/enrollment-codes");
      if (res.ok) setCodes(await res.json());
    } catch {}
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { fetchCodes(); }, [fetchCodes]);

  const handleSubmit = async () => {
    setIsSubmitting(true); setError("");
    try {
      const body = {
        ...form,
        capabilities: form.capabilities ? form.capabilities.split(",").map((c) => c.trim()).filter(Boolean) : [],
      };
      const res = await fetch("/api/enrollment-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      await fetchCodes();
      setShowForm(false);
      setForm(defaultForm);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyCode = async (id: string, code: string) => {
    await navigator.clipboard.writeText(code).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getCodeStatus = (c: EnrollmentCode) => {
    if (c.revoked) return { label: "Revoked", cls: "border-slate-600 text-slate-400 bg-slate-500/10" };
    if (c.usedAt) return { label: "Used", cls: "border-emerald-500/50 text-emerald-400 bg-emerald-500/10" };
    if (c.expiresAt && new Date(c.expiresAt) < new Date()) return { label: "Expired", cls: "border-rose-500/50 text-rose-400 bg-rose-500/10" };
    return { label: "Active", cls: "border-indigo-500/50 text-indigo-400 bg-indigo-500/10" };
  };

  return (
    <div className="space-y-6">
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Generate Enrollment Code</h2>
              <button onClick={() => setShowForm(false)} className="p-2 rounded-full hover:bg-slate-800 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm text-slate-300">Employee Name</label>
                  <Input
                    placeholder="e.g. Ravi Kumar"
                    value={form.employeeName}
                    onChange={(e) => setForm((f) => ({ ...f, employeeName: e.target.value }))}
                    className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-slate-300">Employee ID</label>
                  <Input
                    placeholder="e.g. EMP001"
                    value={form.employeeId}
                    onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
                    className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm text-slate-300">Role</label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as "driver" | "employee" }))}
                    className="w-full h-10 rounded-md bg-slate-950 border border-slate-700 text-slate-200 px-3 text-sm"
                  >
                    <option value="driver">Driver</option>
                    <option value="employee">Employee</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-slate-300">Vehicle</label>
                  <Input
                    placeholder="e.g. MH12AB1234"
                    value={form.vehicle}
                    onChange={(e) => setForm((f) => ({ ...f, vehicle: e.target.value }))}
                    className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm text-slate-300">Capabilities <span className="text-slate-500">(comma-separated)</span></label>
                <Input
                  placeholder="e.g. call_logs,location"
                  value={form.capabilities}
                  onChange={(e) => setForm((f) => ({ ...f, capabilities: e.target.value }))}
                  className="bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm text-slate-300">Expires in (hours)</label>
                <Input
                  type="number"
                  value={form.expiresInHours}
                  onChange={(e) => setForm((f) => ({ ...f, expiresInHours: parseInt(e.target.value) || 48 }))}
                  className="bg-slate-950 border-slate-700 text-slate-200"
                />
              </div>
            </div>

            {error && <p className="text-sm text-rose-400">{error}</p>}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 border-slate-600 text-slate-300 bg-transparent" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white" onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <QrCode className="w-4 h-4 mr-2" />}
                Generate Code
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Device Enrollment</h1>
          <p className="text-slate-400 mt-1">Generate one-time codes to enroll driver Android devices.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="border-slate-700 text-slate-300 bg-transparent hover:bg-slate-800" onClick={fetchCodes} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={() => { setError(""); setForm(defaultForm); setShowForm(true); }}>
            <Plus className="w-4 h-4 mr-2" /> New Code
          </Button>
        </div>
      </div>

      <Card className="bg-slate-900 border-slate-800 text-slate-100">
        <Table>
          <TableHeader className="bg-slate-950/50">
            <TableRow className="border-slate-800">
              <TableHead className="text-slate-400">Code</TableHead>
              <TableHead className="text-slate-400">Employee</TableHead>
              <TableHead className="text-slate-400">Role</TableHead>
              <TableHead className="text-slate-400">Vehicle</TableHead>
              <TableHead className="text-slate-400">Status</TableHead>
              <TableHead className="text-slate-400">Expires</TableHead>
              <TableHead className="text-slate-400">Used At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-indigo-500" />
                </TableCell>
              </TableRow>
            ) : codes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2 text-slate-500">
                    <QrCode className="w-8 h-8" />
                    <p>No enrollment codes yet.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : codes.map((c) => {
              const { label, cls } = getCodeStatus(c);
              return (
                <TableRow key={c._id} className="border-slate-800 hover:bg-slate-800/40">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-indigo-300 text-lg tracking-widest">{c.code}</span>
                      <button
                        onClick={() => copyCode(c._id, c.code)}
                        className="text-slate-500 hover:text-slate-300 transition-colors"
                        title="Copy code"
                      >
                        {copiedId === c._id ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-300">
                    <div>
                      {c.employeeName && <p className="font-medium text-white">{c.employeeName}</p>}
                      {c.employeeId && <p className="text-xs text-slate-500">{c.employeeId}</p>}
                      {!c.employeeName && !c.employeeId && <span className="text-slate-600">—</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={c.role === "driver" ? "border-amber-500/50 text-amber-400 bg-amber-500/10" : "border-cyan-500/50 text-cyan-400 bg-cyan-500/10"}>
                      {c.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-400 font-mono text-sm">{c.vehicle || <span className="text-slate-600">—</span>}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cls}>{label}</Badge>
                  </TableCell>
                  <TableCell className="text-slate-400 text-xs">
                    {c.expiresAt ? format(new Date(c.expiresAt), "MMM dd, HH:mm") : "—"}
                  </TableCell>
                  <TableCell className="text-slate-400 text-xs">
                    {c.usedAt ? format(new Date(c.usedAt), "MMM dd, HH:mm") : <span className="text-slate-600">—</span>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
