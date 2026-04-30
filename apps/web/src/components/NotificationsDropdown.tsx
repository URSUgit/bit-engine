"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Check, TrendingUp, TrendingDown, Zap, AlertTriangle, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

type NotificationKind = "fill" | "signal" | "alert" | "system";

interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  href?: string;
}

const kindConfig: Record<NotificationKind, { icon: React.ComponentType<{ className?: string }>; bg: string; color: string }> = {
  fill:   { icon: TrendingUp,    bg: "bg-emerald-500/10",   color: "text-emerald-400" },
  signal: { icon: Activity,      bg: "bg-cyan-500/10",      color: "text-cyan-400" },
  alert:  { icon: AlertTriangle, bg: "bg-amber-500/10",     color: "text-amber-400" },
  system: { icon: Zap,           bg: "bg-violet-500/10",    color: "text-violet-400" },
};

const initialNotifications: AppNotification[] = [
  {
    id: "n1",
    kind: "fill",
    title: "Copy trade filled",
    body: "Mirrored 0xAlpha.eth → +$420 long ETH-USD @ $3,612",
    createdAt: new Date(Date.now() - 90_000).toISOString(),
    read: false,
    href: "/dashboard/positions",
  },
  {
    id: "n2",
    kind: "signal",
    title: "High-confidence signal",
    body: "FinBERT scored ETH bullish at 0.92 — narrative shift detected",
    createdAt: new Date(Date.now() - 6 * 60_000).toISOString(),
    read: false,
    href: "/dashboard/signals",
  },
  {
    id: "n3",
    kind: "alert",
    title: "Watchlist alert",
    body: "BTC crossed $68,000 — your alert triggered",
    createdAt: new Date(Date.now() - 22 * 60_000).toISOString(),
    read: false,
    href: "/dashboard/watchlists",
  },
  {
    id: "n4",
    kind: "fill",
    title: "Stop-loss triggered",
    body: "ARB-USD short closed at -4.0% (sigmatrade.eth copy)",
    createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    read: true,
    href: "/dashboard/history",
  },
  {
    id: "n5",
    kind: "system",
    title: "Welcome to Pro",
    body: "Your subscription is active. Live signals and copy trading unlocked.",
    createdAt: new Date(Date.now() - 48 * 3600_000).toISOString(),
    read: true,
    href: "/dashboard/settings/billing",
  },
];

function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

export function NotificationsDropdown() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(initialNotifications);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const unread = items.filter((n) => !n.read).length;

  const markAllRead = () => setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  const markRead = (id: string) =>
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-900 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4 text-slate-400" />
        {unread > 0 && (
          <span className="absolute top-1.5 right-2 min-w-[14px] h-3.5 rounded-full bg-cyan-500 text-[9px] font-bold text-slate-950 flex items-center justify-center px-1 number-font">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 sm:w-96 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-slate-100">Notifications</p>
              {unread > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300">
                  {unread} new
                </span>
              )}
            </div>
            <button
              onClick={markAllRead}
              disabled={unread === 0}
              className="text-[11px] text-slate-400 hover:text-cyan-400 transition-colors disabled:opacity-40 flex items-center gap-1"
            >
              <Check className="w-3 h-3" /> Mark all read
            </button>
          </div>

          <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-800/60">
            {items.length === 0 && (
              <p className="text-center text-sm text-slate-500 py-12">No notifications yet</p>
            )}
            {items.map((n) => {
              const cfg = kindConfig[n.kind];
              const Icon = cfg.icon;
              const Wrapper: React.ElementType = n.href ? Link : "div";
              return (
                <Wrapper
                  key={n.id}
                  {...(n.href ? { href: n.href } : {})}
                  onClick={() => { markRead(n.id); if (n.href) setOpen(false); }}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer block",
                    n.read ? "hover:bg-slate-800/40" : "bg-slate-800/30 hover:bg-slate-800/60"
                  )}
                >
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", cfg.bg)}>
                    <Icon className={cn("w-4 h-4", cfg.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <p className={cn("text-sm font-semibold", n.read ? "text-slate-300" : "text-slate-100")}>
                        {n.title}
                      </p>
                      <span className="text-[10px] text-slate-500 ml-auto shrink-0">{timeAgo(n.createdAt)}</span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed mt-0.5 line-clamp-2">{n.body}</p>
                  </div>
                  {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-2 shrink-0" />}
                </Wrapper>
              );
            })}
          </div>

          <div className="border-t border-slate-800 px-4 py-2 text-center">
            <Link
              href="/dashboard/settings/notifications"
              onClick={() => setOpen(false)}
              className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              Notification settings →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
