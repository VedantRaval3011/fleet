"use client";

import { AlertTriangle, CheckCircle2, Square, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Props {
  status: "ACTIVE" | "INTERRUPTED" | "ENDED";
  currentCause?: string | null;
  currentCauseLabel?: string | null;
  connectivityLost?: boolean;
}

/**
 * One status vocabulary everywhere. "Not reporting" (the server stopped hearing from
 * the phone, cause unknown) is deliberately a different badge from a device-reported
 * failure such as a revoked permission - they call for different follow-ups.
 */
export function ShiftStatusBadge({ status, currentCause, currentCauseLabel, connectivityLost }: Props) {
  if (status === "ENDED") {
    return (
      <Badge className="border-slate-500/40 bg-slate-500/15 text-slate-300">
        <Square /> Ended
      </Badge>
    );
  }
  if (status === "INTERRUPTED") {
    const notReporting = currentCause === "NO_SIGNAL_FROM_DEVICE";
    return (
      <Badge
        className={
          notReporting
            ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
            : "border-rose-500/40 bg-rose-500/15 text-rose-300"
        }
        title={currentCauseLabel ?? undefined}
      >
        <AlertTriangle /> {notReporting ? "Not reporting" : "Tracking interrupted"}
      </Badge>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge className="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
        <CheckCircle2 /> On shift
      </Badge>
      {connectivityLost && (
        <Badge className="border-sky-500/40 bg-sky-500/15 text-sky-300" title="Offline, but still recording locally">
          <WifiOff /> Offline
        </Badge>
      )}
    </span>
  );
}
