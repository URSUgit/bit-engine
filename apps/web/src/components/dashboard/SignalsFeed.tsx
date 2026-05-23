"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Pause } from "lucide-react";

interface SignalRow {
  id: string;
  asset: string;
  direction: "BUY" | "SELL" | "HOLD";
  confidence: number;
  source: string;
  tier?: string;
  time: string;
}

const directionConfig = {
  BUY:  { color: "text-emerald-400", bg: "bg-emerald-500/15", icon: ArrowUpRight },
  SELL: { color: "text-red-400",     bg: "bg-red-500/15",     icon: ArrowDownRight },
  HOLD: { color: "text-amber-400",   bg: "bg-amber-500/15",   icon: Pause },
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3600_000)}h ago`;
}

export function SignalsFeed() {
  const [signals, setSignals] = useState<SignalRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/signals");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const arr = Array.isArray(data) ? data : [];
        setSignals(
          arr.slice(0, 8).map((s: Record<string, unknown>, i: number) => ({
            id: (s.id as string) ?? `sig-${i}`,
            asset: ((s.asset as string) ?? "").replace(/-USD$/i, ""),
            direction: ((s.direction as string) ?? "hold").toUpperCase() as "BUY" | "SELL" | "HOLD",
            confidence: Math.round(((s.confidence as number) ?? 0) * 100),
            source: (s.source as string) ?? "engine",
            tier: ((s.metadata as Record<string, unknown>)?.tier as string) ?? "strong",
            time: timeAgo((s.created_at as string) ?? new Date().toISOString()),
          }))
        );
      } catch { /* keep previous */ }
    }
    poll();
    const id = setInterval(poll, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (signals.length === 0) {
    return <p className="text-xs text-slate-500 py-6 text-center">No signals yet — waiting for signal engine…</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {signals.map((s) => {
        const dir = s.direction in directionConfig ? s.direction : "HOLD";
        const cfg = directionConfig[dir];
        const DirIcon = cfg.icon;
        return (
          <div
            key={s.id}
            className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-900/40 hover:bg-slate-800/60 transition-colors"
          >
            <div className="w-9 h-9 rounded-lg bg-slate-800 border border-slate-700/50 flex items-center justify-center text-xs font-bold text-slate-200 shrink-0">
              {s.asset.slice(0, 3)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-semibold text-slate-100">{s.asset}</span>
                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5", cfg.bg, cfg.color)}>
                  <DirIcon className="w-2.5 h-2.5" />{dir}
                </span>
                {s.tier === "watch" && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-400 font-bold uppercase">watch</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span>{s.source}</span>
                <span className="text-slate-700">·</span>
                <span>{s.time}</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className={cn("text-sm font-bold number-font",
                s.confidence >= 85 ? "text-cyan-400" : s.confidence >= 70 ? "text-slate-200" : "text-slate-500"
              )}>
                {s.confidence}%
              </div>
              <p className="text-[10px] text-slate-600 uppercase tracking-wider">conf.</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
