"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OngoingChip, SeverityIcon } from "@/components/shifts/trackingAlertUi";
import { formatAgo } from "@/lib/shiftFormat";
import type { TrackingAlertDTO, TrackingAlertsResult } from "@/lib/trackingAlertService";
import { cn } from "@/lib/utils";

const POLL_MS = 20_000;
const SEEN_KEY = "trackingAlerts:lastSeen";
const TOAST_MS = 10_000;

const isProblem = (a: TrackingAlertDTO) => a.severity === "critical" || a.severity === "warning";

function readSeen(): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function describe(a: TrackingAlertDTO): string {
  const who = a.driver.employeeId ? `${a.driver.name} (${a.driver.employeeId})` : a.driver.name;
  return `${who}${a.vehicle ? ` · ${a.vehicle}` : ""}`;
}

function notifyDesktop(a: TrackingAlertDTO) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    // `tag` collapses the same alert across several open dashboard tabs.
    const n = new Notification(`${a.title} — ${a.driver.name}`, {
      body: `${describe(a)}\n${new Date(a.occurredAt).toLocaleTimeString()} · ${a.current.causeLabel ?? a.current.status}`,
      tag: a.id,
    });
    n.onclick = () => {
      window.focus();
      window.location.href = "/tracking-alerts";
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

/** Navbar bell for HR/admin: polls tracking alerts and raises in-app and desktop notifications. */
export function TrackingAlertBell() {
  const [alerts, setAlerts] = useState<TrackingAlertDTO[]>([]);
  const [ongoing, setOngoing] = useState(0);
  const [seen, setSeen] = useState(readSeen);
  const [toast, setToast] = useState<TrackingAlertDTO | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );
  const [failed, setFailed] = useState(false);
  // Newest receivedAt already announced in this tab; null until the first poll sets a baseline.
  const announcedRef = useRef<number | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/tracking-alerts?limit=15", { cache: "no-store" });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const data = (await res.json()) as TrackingAlertsResult;
      setFailed(false);
      setAlerts(data.alerts);
      setOngoing(data.counts.ongoingCritical + data.counts.ongoingWarning);

      const newest = data.alerts.reduce((m, a) => Math.max(m, Date.parse(a.receivedAt)), 0);
      const since = announcedRef.current;
      if (since !== null) {
        const fresh = data.alerts.filter((a) => isProblem(a) && Date.parse(a.receivedAt) > since);
        if (fresh.length > 0) {
          setToast(fresh[0]);
          fresh.slice(0, 3).forEach(notifyDesktop);
        }
      }
      announcedRef.current = Math.max(since ?? 0, newest);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void poll(), 0);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const unread = alerts.filter((a) => isProblem(a) && Date.parse(a.receivedAt) > seen).length;

  const markSeen = () => {
    const newest = alerts.reduce((m, a) => Math.max(m, Date.parse(a.receivedAt)), seen);
    setSeen(newest);
    try {
      localStorage.setItem(SEEN_KEY, String(newest));
    } catch {
      /* ignore */
    }
  };

  const enableDesktop = async () => {
    if (typeof Notification === "undefined") return;
    setPermission(await Notification.requestPermission());
  };

  return (
    <>
      <Popover onOpenChange={(open) => open && markSeen()}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="relative rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            aria-label={`Tracking alerts${unread ? `, ${unread} new` : ""}`}
            title={ongoing ? `${ongoing} driver(s) with a tracking problem right now` : "Tracking alerts"}
          >
            <Bell className={cn("h-5 w-5", ongoing > 0 && "text-amber-300")} />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-1rem)] border-slate-700 bg-slate-900 p-0 text-slate-200">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Tracking alerts</p>
              <p className="text-xs text-slate-400">
                {ongoing > 0 ? `${ongoing} driver(s) with a problem right now` : "No ongoing tracking problems"}
              </p>
            </div>
            <Link href="/tracking-alerts" className="text-xs font-medium text-indigo-300 hover:text-indigo-200">
              View all
            </Link>
          </div>
          <ul className="max-h-96 divide-y divide-slate-800 overflow-y-auto">
            {failed && alerts.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">Could not load alerts.</li>}
            {!failed && alerts.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">No alerts yet.</li>}
            {alerts.map((a) => (
              <li key={a.id} className="flex gap-3 px-4 py-3">
                <SeverityIcon severity={a.severity} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{a.title}</p>
                    <OngoingChip ongoing={a.ongoing} severity={a.severity} />
                  </div>
                  <p className="truncate text-xs text-slate-400">{describe(a)}</p>
                  <p className="text-[11px] text-slate-500">{formatAgo(a.occurredAt)}</p>
                </div>
              </li>
            ))}
          </ul>
          {permission !== "granted" && permission !== "unsupported" && (
            <div className="border-t border-slate-800 px-4 py-3">
              {permission === "denied" ? (
                <p className="flex items-center gap-2 text-xs text-slate-500">
                  <BellOff className="h-3.5 w-3.5" /> Desktop notifications are blocked for this site in the browser.
                </p>
              ) : (
                <button type="button" onClick={enableDesktop} className="text-xs font-medium text-indigo-300 hover:text-indigo-200">
                  Enable desktop notifications
                </button>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>

      {toast && (
        <div
          role="alert"
          className="fixed right-4 top-20 z-50 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-slate-700 bg-slate-900 p-4 text-slate-200 shadow-xl"
        >
          <div className="flex items-start gap-3">
            <SeverityIcon severity={toast.severity} className="mt-0.5 h-5 w-5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{toast.title}</p>
              <p className="truncate text-xs text-slate-300">{describe(toast)}</p>
              <p className="mt-1 text-xs text-slate-400">
                {new Date(toast.occurredAt).toLocaleTimeString()} · now: {toast.current.causeLabel ?? toast.current.status}
              </p>
              <Link href="/tracking-alerts" onClick={() => setToast(null)} className="mt-2 inline-block text-xs font-medium text-indigo-300 hover:text-indigo-200">
                Open tracking alerts
              </Link>
            </div>
            <button type="button" onClick={() => setToast(null)} className="text-slate-500 hover:text-slate-200" aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
