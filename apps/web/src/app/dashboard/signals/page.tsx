"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ArrowDownRight, Pause, Search, WifiOff, Inbox } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Signal } from "@bitprivat/shared-types";

const dirFilters = ["all", "buy", "sell", "hold"] as const;
const sourceFilters = ["all", "finbert", "on_chain", "twitter", "reddit", "telegram", "technical", "whale_alert"] as const;

const dirConfig = {
  buy:  { color: "text-emerald-400", bg: "bg-emerald-500/15", icon: ArrowUpRight },
  sell: { color: "text-red-400",     bg: "bg-red-500/15",     icon: ArrowDownRight },
  hold: { color: "text-amber-400",   bg: "bg-amber-500/15",   icon: Pause },
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** Small colored confidence bar */
function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const colorClass =
    value >= 0.8 ? "bg-emerald-500" :
    value >= 0.6 ? "bg-amber-500" :
    "bg-red-500";
  return (
    <div className="text-right shrink-0 min-w-[72px]">
      <div className={cn(
        "text-xl font-bold number-font",
        value >= 0.85 ? "text-cyan-400" : value >= 0.7 ? "text-slate-200" : "text-slate-500"
      )}>
        {pct}%
      </div>
      <div className="w-full h-1.5 rounded-full bg-slate-800 mt-1 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", colorClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[10px] text-slate-600 uppercase tracking-widest mt-0.5">Confidence</p>
    </div>
  );
}

export default function SignalsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<(typeof dirFilters)[number]>("all");
  const [source, setSource] = useState<(typeof sourceFilters)[number]>("all");
  const [minConfidence, setMinConfidence] = useState(0);

  const { data: signals, isLoading, isError } = useQuery<Signal[]>({
    queryKey: ["signals"],
    queryFn: () => api.signals.list(),
    initialData: [],
    refetchInterval: 30_000,
  });

  const filtered = useMemo(() => {
    return (signals ?? []).filter((s) => {
      if (search && !s.asset.toLowerCase().includes(search.toLowerCase())) return false;
      if (direction !== "all" && s.direction !== direction) return false;
      if (source !== "all" && s.source !== source) return false;
      if (s.confidence * 100 < minConfidence) return false;
      return true;
    });
  }, [signals, search, direction, source, minConfidence]);

  const buyCount = filtered.filter((s) => s.direction === "buy").length;
  const sellCount = filtered.filter((s) => s.direction === "sell").length;
  const highConf = filtered.filter((s) => s.confidence >= 0.85).length;

  return (
      <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Live Signals</h1>
          <p className="text-sm text-slate-400 mt-1">AI + on-chain + sentiment signals · auto-refreshing every 30s</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Active Signals" value={`${filtered.length}`} />
          <Stat label="Buy / Sell"     value={`${buyCount} / ${sellCount}`} />
          <Stat label="High Confidence" value={`${highConf}`} accent="text-cyan-400" />
          <Stat label="Avg Confidence" value={`${(filtered.reduce((s, x) => s + x.confidence, 0) / Math.max(filtered.length, 1) * 100).toFixed(0)}%`} />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 flex-1 min-w-[260px] max-w-md">
            <Search className="w-3.5 h-3.5 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search asset…"
              className="bg-transparent outline-none text-sm text-slate-200 placeholder:text-slate-600 w-full"
            />
          </div>
          <FilterChips label="Direction" options={dirFilters as readonly string[]} value={direction} onChange={(v) => setDirection(v as typeof direction)} />
          <FilterChips label="Source"    options={sourceFilters as readonly string[]} value={source}    onChange={(v) => setSource(v as typeof source)} />
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Min Conf</span>
            <input
              type="range"
              min={0} max={100} value={minConfidence}
              onChange={(e) => setMinConfidence(parseInt(e.target.value))}
              className="w-24 accent-cyan-500"
            />
            <span className="text-xs text-cyan-300 font-semibold number-font w-10">{minConfidence}%</span>
          </div>
        </div>

        <div className="card-dark divide-y divide-slate-800/60">
          {isLoading && (
            <div className="p-12 text-center text-sm text-slate-500 animate-pulse">Loading signals…</div>
          )}

          {!isLoading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
              {isError ? (
                <>
                  <WifiOff className="w-8 h-8 text-slate-600" />
                  <p className="text-sm font-medium text-slate-400">Signal service offline</p>
                  <p className="text-xs text-slate-600">Start the signal service to see live signals</p>
                </>
              ) : (
                <>
                  <Inbox className="w-8 h-8 text-slate-600" />
                  <p className="text-sm text-slate-500">No signals match your filters</p>
                </>
              )}
            </div>
          )}

          {!isLoading && filtered.map((s) => {
            const cfg = dirConfig[s.direction];
            const Icon = cfg.icon;
            return (
              <div key={s.id} className="flex items-start gap-4 p-4 hover:bg-slate-900/40 transition-colors">
                <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700/50 flex items-center justify-center text-xs font-bold text-slate-200 shrink-0">
                  {s.asset.slice(0, 3)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base font-semibold text-slate-100">{s.asset}</span>
                    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase flex items-center gap-0.5", cfg.bg, cfg.color)}>
                      <Icon className="w-2.5 h-2.5" />
                      {s.direction}
                    </span>
                    {!s.isActive && (
                      <span className="text-[10px] uppercase text-slate-500 font-medium">Expired</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed">{s.reasoning}</p>
                  <div className="flex items-center gap-2 mt-1.5 text-[11px] text-slate-500">
                    <span className="capitalize">{s.source.replace("_", " ")}</span>
                    <span className="text-slate-700">·</span>
                    <span>{timeAgo(s.createdAt)}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <ConfidenceBar value={s.confidence} />
                  <button
                    onClick={() => router.push(`/dashboard/positions?signal=${s.id}`)}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded bg-slate-800 text-cyan-300 border border-slate-700 hover:bg-slate-700 hover:text-cyan-200 transition-colors"
                  >
                    Paper trade →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="card-dark p-4">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</p>
      <p className={cn("text-xl font-bold number-font mt-1", accent ?? "text-slate-100")}>{value}</p>
    </div>
  );
}

function FilterChips({ label, options, value, onChange }: { label: string; options: readonly string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</span>
      <div className="flex gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={cn(
              "px-2.5 py-1 text-xs font-semibold rounded transition-colors capitalize",
              value === o ? "bg-slate-800 text-cyan-300" : "text-slate-500 hover:text-slate-300"
            )}
          >
            {o.replace("_", " ")}
          </button>
        ))}
      </div>
    </div>
  );
}
