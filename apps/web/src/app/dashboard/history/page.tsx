"use client";

import { useMemo, useState } from "react";
import { Search, TrendingUp, TrendingDown, Download } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { mockPositions } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

interface ClosedTrade {
  id: string;
  symbol: string;
  side: "long" | "short";
  sizeUsd: number;
  leverage: number;
  entryPrice: number;
  exitPrice: number;
  pnlUsd: number;
  pnlPct: number;
  protocol: string;
  source: "manual" | "copy" | "strategy";
  trader?: string;
  durationHours: number;
  closedAt: string;
}

function generateHistory(): ClosedTrade[] {
  const sources: ClosedTrade["source"][] = ["manual", "copy", "strategy"];
  const sides: ClosedTrade["side"][] = ["long", "short"];
  const traders = ["0xAlpha.eth", "defiwhale", "polyking"];
  const protocols = ["Hyperliquid", "Polymarket", "Drift"];
  const symbols = ["ETH-USD", "BTC-USD", "SOL-USD", "ARB-USD", "AVAX-USD", "DOGE-USD", "TIA-USD"];

  let seed = 7;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const out: ClosedTrade[] = [];
  for (let i = 0; i < 35; i++) {
    const side = sides[Math.floor(rand() * 2)]!;
    const entry = 0.5 + rand() * 70_000;
    const drift = 1 + (rand() - 0.5) * 0.15;
    const exit = entry * drift;
    const size = Math.floor(500 + rand() * 9_500);
    const pnlPct = (exit / entry - 1) * 100 * (side === "long" ? 1 : -1);
    const source = sources[Math.floor(rand() * 3)]!;
    out.push({
      id: `trade-${i + 1}`,
      symbol: symbols[Math.floor(rand() * symbols.length)]!,
      side,
      sizeUsd: size,
      leverage: ([1, 2, 3, 5, 10] as const)[Math.floor(rand() * 5)]!,
      entryPrice: +entry.toFixed(4),
      exitPrice: +exit.toFixed(4),
      pnlUsd: +(size * pnlPct / 100).toFixed(2),
      pnlPct: +pnlPct.toFixed(2),
      protocol: protocols[Math.floor(rand() * 3)]!,
      source,
      trader: source === "copy" ? traders[Math.floor(rand() * 3)] : undefined,
      durationHours: +(0.5 + rand() * 96).toFixed(1),
      closedAt: new Date(Date.now() - i * 3.6e6 - rand() * 86400_000).toISOString(),
    });
  }
  return out;
}

const history = generateHistory();
const sourceFilters = ["all", "manual", "copy", "strategy"] as const;

export default function HistoryPage() {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<(typeof sourceFilters)[number]>("all");

  const filtered = useMemo(() => {
    return history.filter((t) => {
      if (search && !t.symbol.toLowerCase().includes(search.toLowerCase())) return false;
      if (source !== "all" && t.source !== source) return false;
      return true;
    });
  }, [search, source]);

  const totalPnl = filtered.reduce((s, t) => s + t.pnlUsd, 0);
  const wins = filtered.filter((t) => t.pnlUsd > 0).length;
  const winRate = filtered.length ? (wins / filtered.length) * 100 : 0;
  const totalVolume = filtered.reduce((s, t) => s + t.sizeUsd, 0);

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Trade History</h1>
            <p className="text-sm text-slate-400 mt-1">All closed positions across venues and copy sources</p>
          </div>
          <button className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 transition-colors">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Trades" value={`${filtered.length}`} />
          <Stat label="Win Rate" value={`${winRate.toFixed(1)}%`} />
          <Stat label="Total Volume" value={`$${(totalVolume / 1000).toFixed(1)}K`} />
          <Stat label="Realized P&L" value={`${totalPnl >= 0 ? "+" : "-"}$${Math.abs(totalPnl).toFixed(0)}`} positive={totalPnl >= 0} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 flex-1 min-w-[260px] max-w-md">
            <Search className="w-3.5 h-3.5 text-slate-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search asset…"
              className="bg-transparent outline-none text-sm text-slate-200 placeholder:text-slate-600 w-full" />
          </div>
          <FilterChips label="Source" options={sourceFilters as readonly string[]} value={source} onChange={(v) => setSource(v as typeof source)} />
        </div>

        <div className="card-dark overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/40 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-3 text-left">Asset</th>
                  <th className="px-4 py-3 text-left">Side</th>
                  <th className="px-4 py-3 text-right">Size</th>
                  <th className="px-4 py-3 text-right">Entry → Exit</th>
                  <th className="px-4 py-3 text-right">P&L</th>
                  <th className="px-4 py-3 text-left">Source</th>
                  <th className="px-4 py-3 text-right">Duration</th>
                  <th className="px-4 py-3 text-right">Closed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.map((t) => {
                  const isProfit = t.pnlUsd >= 0;
                  const isLong = t.side === "long";
                  return (
                    <tr key={t.id} className="hover:bg-slate-900/40 transition-colors">
                      <td className="px-4 py-3.5 font-mono text-slate-100 font-medium">{t.symbol}</td>
                      <td className="px-4 py-3.5">
                        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                          isLong ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>{t.side}</span>
                        <span className="ml-1 text-[10px] text-slate-500">{t.leverage}×</span>
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-300 number-font">${t.sizeUsd.toLocaleString()}</td>
                      <td className="px-4 py-3.5 text-right text-slate-400 number-font text-xs">
                        ${t.entryPrice.toFixed(t.entryPrice < 10 ? 4 : 2)} → ${t.exitPrice.toFixed(t.exitPrice < 10 ? 4 : 2)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className={cn("number-font font-semibold flex items-center justify-end gap-1", isProfit ? "text-emerald-400" : "text-red-400")}>
                          {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {isProfit ? "+" : "-"}${Math.abs(t.pnlUsd).toFixed(2)}
                        </div>
                        <div className="text-[10px] opacity-70 number-font">{isProfit ? "+" : ""}{t.pnlPct.toFixed(2)}%</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded",
                          t.source === "copy"     ? "bg-cyan-500/10 text-cyan-400" :
                          t.source === "strategy" ? "bg-violet-500/10 text-violet-400" :
                                                    "bg-slate-700/30 text-slate-400")}>
                          {t.source}
                        </span>
                        {t.trader && <span className="ml-2 text-[11px] text-slate-500">{t.trader}</span>}
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-400 number-font">
                        {t.durationHours < 1 ? `${(t.durationHours * 60).toFixed(0)}m`
                          : t.durationHours < 24 ? `${t.durationHours.toFixed(1)}h`
                          : `${(t.durationHours / 24).toFixed(1)}d`}
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-500 text-xs">
                        {new Date(t.closedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
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
        positive === true ? "text-emerald-400" : positive === false ? "text-red-400" : "text-slate-100")}>
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
          <button key={o} onClick={() => onChange(o)} className={cn(
            "px-2.5 py-1 text-xs font-semibold rounded transition-colors capitalize",
            value === o ? "bg-slate-800 text-cyan-300" : "text-slate-500 hover:text-slate-300"
          )}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
