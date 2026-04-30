"use client";

import { Plus, MoreHorizontal, TrendingUp, TrendingDown } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { cn } from "@/lib/utils";

interface PortfolioCard {
  id: string;
  name: string;
  description: string;
  valueUsd: number;
  pnlPct30d: number;
  positionCount: number;
  strategyType: "manual" | "copy" | "automated";
  riskLevel: "low" | "medium" | "high";
  lastTrade: string;
}

const portfolios: PortfolioCard[] = [
  { id: "p1", name: "Main Portfolio",       description: "Primary trading book — manual + select copy trades",     valueUsd: 48_320, pnlPct30d: 12.4, positionCount: 7, strategyType: "manual",    riskLevel: "medium", lastTrade: "12m ago" },
  { id: "p2", name: "Copy Aggregator",      description: "Aggregated positions from 3 elite traders",              valueUsd: 18_500, pnlPct30d: 28.7, positionCount: 12, strategyType: "copy",     riskLevel: "high",   lastTrade: "3m ago" },
  { id: "p3", name: "Mean Reversion Bot",   description: "Automated RSI + Bollinger band reversals on majors",     valueUsd:  9_800, pnlPct30d:  6.2, positionCount: 4, strategyType: "automated", riskLevel: "low",    lastTrade: "47m ago" },
  { id: "p4", name: "Polymarket Specials",  description: "Discretionary prediction-market plays",                  valueUsd:  4_200, pnlPct30d: 41.8, positionCount: 5, strategyType: "manual",    riskLevel: "high",   lastTrade: "2h ago" },
  { id: "p5", name: "Funding Harvester",    description: "Delta-neutral funding-rate harvesting on perps",         valueUsd: 24_100, pnlPct30d:  4.1, positionCount: 8, strategyType: "automated", riskLevel: "low",    lastTrade: "8m ago" },
];

const riskColors = {
  low:    "bg-emerald-500/15 text-emerald-400",
  medium: "bg-amber-500/15 text-amber-400",
  high:   "bg-red-500/15 text-red-400",
};

const strategyColors = {
  manual:    "bg-slate-700/30 text-slate-300",
  copy:      "bg-cyan-500/15 text-cyan-400",
  automated: "bg-violet-500/15 text-violet-400",
};

export default function PortfoliosPage() {
  const totalValue = portfolios.reduce((s, p) => s + p.valueUsd, 0);
  const totalPositions = portfolios.reduce((s, p) => s + p.positionCount, 0);
  const weightedPnl = portfolios.reduce((s, p) => s + p.pnlPct30d * p.valueUsd, 0) / totalValue;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Portfolios</h1>
            <p className="text-sm text-slate-400 mt-1">
              Segment your capital across strategies. Each portfolio runs an independent risk envelope.
            </p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors shadow-[0_0_20px_-5px_rgba(34,211,238,0.5)]">
            <Plus className="w-4 h-4" />
            New Portfolio
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Total Value"     value={`$${totalValue.toLocaleString()}`} />
          <Stat label="Portfolios"      value={`${portfolios.length}`} />
          <Stat label="Open Positions"  value={`${totalPositions}`} />
          <Stat label="Weighted P&L 30d" value={`+${weightedPnl.toFixed(1)}%`} accent="text-emerald-400" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {portfolios.map((p) => {
            const isProfit = p.pnlPct30d >= 0;
            const allocation = (p.valueUsd / totalValue) * 100;
            return (
              <div key={p.id} className="card-dark glow-card p-5 flex flex-col gap-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-bold text-slate-100 truncate">{p.name}</p>
                    <p className="text-xs text-slate-500 leading-relaxed mt-1 line-clamp-2">{p.description}</p>
                  </div>
                  <button className="w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors shrink-0">
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded", strategyColors[p.strategyType])}>
                    {p.strategyType}
                  </span>
                  <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded", riskColors[p.riskLevel])}>
                    {p.riskLevel} risk
                  </span>
                </div>

                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Value</p>
                    <p className="text-2xl font-bold text-slate-50 number-font mt-0.5">${p.valueUsd.toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">30d</p>
                    <p className={cn("text-base font-bold number-font flex items-center justify-end gap-1", isProfit ? "text-emerald-400" : "text-red-400")}>
                      {isProfit ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {isProfit ? "+" : ""}{p.pnlPct30d.toFixed(1)}%
                    </p>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5 text-[10px] text-slate-500 uppercase tracking-widest font-bold">
                    <span>Allocation</span>
                    <span className="number-font">{allocation.toFixed(1)}%</span>
                  </div>
                  <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500" style={{ width: `${allocation}%` }} />
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-800/60">
                  <span>{p.positionCount} positions open</span>
                  <span>last trade {p.lastTrade}</span>
                </div>
              </div>
            );
          })}

          {/* New portfolio card */}
          <button className="card-dark border-dashed flex flex-col items-center justify-center p-12 hover:border-cyan-500/30 transition-colors group min-h-[280px]">
            <div className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-3 group-hover:bg-cyan-500/20 transition-colors">
              <Plus className="w-5 h-5 text-cyan-400" />
            </div>
            <p className="text-sm font-semibold text-slate-300">New Portfolio</p>
            <p className="text-xs text-slate-500 mt-1">Start a fresh strategy book</p>
          </button>
        </div>
      </div>
    </DashboardLayout>
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
