"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { api } from "@/lib/api";
import { mockPositions } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, X, Edit3 } from "lucide-react";

const statusFilters = ["open", "closed", "all"] as const;
const sideFilters   = ["all", "long", "short"] as const;
const venueFilters  = ["all", "hyperliquid", "polymarket", "drift"] as const;

export default function PositionsPage() {
  const [status, setStatus] = useState<(typeof statusFilters)[number]>("open");
  const [side, setSide]     = useState<(typeof sideFilters)[number]>("all");
  const [venue, setVenue]   = useState<(typeof venueFilters)[number]>("all");

  const { data: positions } = useQuery({
    queryKey: ["positions"],
    queryFn: () => api.portfolio.positions(),
    initialData: mockPositions,
    refetchInterval: 10_000,
  });

  const filtered = useMemo(() => {
    return ((positions ?? []) as typeof mockPositions).filter((p) => {
      if (side !== "all" && p.side !== side) return false;
      if (venue !== "all" && p.protocol !== venue) return false;
      return true;
    });
  }, [positions, side, venue]);

  const totalPnl = filtered.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const totalSize = filtered.reduce((sum, p) => sum + p.sizeUsd, 0);
  const winners = filtered.filter((p) => p.unrealizedPnl > 0).length;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Positions</h1>
          <p className="text-sm text-slate-400 mt-1">All open and closed positions across venues</p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Open" value={`${filtered.length}`} />
          <Stat label="Total Size" value={`$${totalSize.toLocaleString()}`} />
          <Stat label="Unrealized P&L" value={`${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`} positive={totalPnl >= 0} />
          <Stat label="Winners / Losers" value={`${winners} / ${filtered.length - winners}`} />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <FilterChips label="Status" options={statusFilters as readonly string[]} value={status} onChange={(v) => setStatus(v as typeof status)} />
          <FilterChips label="Side"   options={sideFilters as readonly string[]}   value={side}   onChange={(v) => setSide(v as typeof side)} />
          <FilterChips label="Venue"  options={venueFilters as readonly string[]}  value={venue}  onChange={(v) => setVenue(v as typeof venue)} />
        </div>

        <div className="card-dark overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/40 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-3 text-left">Asset</th>
                  <th className="px-4 py-3 text-left">Side</th>
                  <th className="px-4 py-3 text-right">Size</th>
                  <th className="px-4 py-3 text-right">Lev</th>
                  <th className="px-4 py-3 text-right">Entry</th>
                  <th className="px-4 py-3 text-right">Current</th>
                  <th className="px-4 py-3 text-right">P&L</th>
                  <th className="px-4 py-3 text-left">Source</th>
                  <th className="px-4 py-3 text-left">Venue</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.map((p) => {
                  const isLong = p.side === "long";
                  const isProfit = p.unrealizedPnl >= 0;
                  return (
                    <tr key={p.id} className="hover:bg-slate-900/40 transition-colors">
                      <td className="px-4 py-3.5 font-mono font-medium text-slate-100">{p.symbol}</td>
                      <td className="px-4 py-3.5">
                        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide",
                          isLong ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>
                          {p.side}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-300 number-font">${p.sizeUsd.toLocaleString()}</td>
                      <td className="px-4 py-3.5 text-right">
                        <span className="text-[10px] text-slate-400 font-mono px-1.5 py-0.5 rounded bg-slate-800">{p.leverage}x</span>
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-400 number-font">${p.entryPrice.toFixed(p.entryPrice < 10 ? 4 : 2)}</td>
                      <td className="px-4 py-3.5 text-right text-slate-200 number-font">${p.currentPrice.toFixed(p.currentPrice < 10 ? 4 : 2)}</td>
                      <td className="px-4 py-3.5 text-right">
                        <div className={cn("number-font font-semibold flex items-center justify-end gap-1", isProfit ? "text-emerald-400" : "text-red-400")}>
                          {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {isProfit ? "+" : ""}${Math.abs(p.unrealizedPnl).toFixed(2)}
                        </div>
                        <div className="text-[10px] opacity-70 number-font">
                          {isProfit ? "+" : ""}{p.unrealizedPnlPct.toFixed(2)}%
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {p.isCopied ? (
                          <span className="text-[10px] font-bold uppercase text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded">Copied</span>
                        ) : (
                          <span className="text-[10px] text-slate-500 uppercase">Manual</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-500 capitalize">{p.protocol}</td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="inline-flex gap-1">
                          <button className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors" title="Edit stop-loss">
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors" title="Close position">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Stat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="card-dark p-4">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</p>
      <p className={cn("text-xl font-bold number-font mt-1",
        positive === true ? "text-emerald-400" : positive === false ? "text-red-400" : "text-slate-100"
      )}>
        {value}
      </p>
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
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
