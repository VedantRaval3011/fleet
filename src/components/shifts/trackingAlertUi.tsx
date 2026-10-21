import { AlertOctagon, AlertTriangle, CheckCircle2, WifiOff } from "lucide-react";
import type { AlertSeverity } from "@/lib/trackingAlerts";
import { cn } from "@/lib/utils";

export const SEVERITY_STYLE: Record<
  AlertSeverity,
  { icon: React.ComponentType<{ className?: string }>; text: string; chip: string; label: string }
> = {
  critical: { icon: AlertOctagon, text: "text-rose-300", chip: "border-rose-500/40 bg-rose-500/10 text-rose-300", label: "Critical" },
  warning: { icon: AlertTriangle, text: "text-amber-300", chip: "border-amber-500/40 bg-amber-500/10 text-amber-300", label: "Warning" },
  info: { icon: WifiOff, text: "text-sky-300", chip: "border-sky-500/40 bg-sky-500/10 text-sky-300", label: "Info" },
  recovery: { icon: CheckCircle2, text: "text-emerald-300", chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", label: "Recovered" },
};

export function SeverityIcon({ severity, className }: { severity: AlertSeverity; className?: string }) {
  const s = SEVERITY_STYLE[severity];
  const Icon = s.icon;
  return <Icon className={cn("h-4 w-4 shrink-0", s.text, className)} />;
}

export function OngoingChip({ ongoing, severity }: { ongoing: boolean; severity: AlertSeverity }) {
  if (severity === "recovery") return null;
  return ongoing ? (
    <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-300">
      Ongoing
    </span>
  ) : (
    <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
      Resolved
    </span>
  );
}
