"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, ExternalLink, TrendingUp, TrendingDown } from "lucide-react";
import { TradingViewChart } from "@/components/charts/TradingViewChart";
import { mockTraders, mockPositions } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export default function TraderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const trader = useMemo(() => mockTraders.find((t) => t.id === id) ?? mockTraders[0], [id]);
  const [following, setFollowing] = useState(false);

  if (!trader) return null;

  // Simulate this trader's recent positions
  const traderPositions = mockPositions.slice(0, 6).map((p, i) => ({ ...p, id: `${trader.id}-pos-${i}` }));
  const totalPnL = traderPositions.reduce((s, p) => s + p.unrealizedPnl, 0);

  return (
      <div className="flex flex-col gap-5 p-6 max-w-[1600px] mx-auto">
        <Link href="/dashboard/leaderboard" className="text-slate-500 hover:text-slate-300 transition-colors w-fit text-sm flex items-center gap-1.5">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to leaderboard
        </Link>

        {/* Header card */}
        <div className="card-dark p-6">
          <div className="flex items-start gap-5 flex-wrap">
            <div className={cn("w-20 h-20 rounded-full bg-gradient-to-br flex items-center justify-center text-3xl font-bold text-white shrink-0", trader.avatarColor)}>
              {(trader.handle?.[0] ?? "?").toUpperCase()}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <h1 className="text-2xl font-bold text-slate-50 tracking-tight">{trader.handle}</h1>
                {trader.badge === "elite" && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950">ELITE</span>
                )}
                {trader.badge === "verified" && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-400">✓ VERIFIED</span>
                )}
                <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded",
                  trader.riskLevel === "low" ? "bg-emerald-500/15 text-emerald-400" :
                  trader.riskLevel === "medium" ? "bg-amber-500/15 text-amber-400" :
                                                  "bg-red-500/15 text-red-400")}>
                  {trader.riskLevel} risk
                </span>
              </div>
              <a
                href={`https://etherscan.io/address/${trader.walletAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-slate-500 hover:text-cyan-400 transition-colors inline-flex items-center gap-1"
              >
                {trader.walletAddress.slice(0, 10)}…{trader.walletAddress.slice(-8)}
                <ExternalLink className="w-3 h-3" />
              </a>
              <p className="text-sm text-slate-400 mt-3 max-w-xl">
                Active since {new Date(trader.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long" })}
                {" · "}
                Trading on <span className="capitalize text-slate-300">{trader.protocols.join(", ")}</span>
                {" · "}
                <span className="text-slate-300 font-semibold number-font">{trader.followerCount.toLocaleString()}</span> followers
              </p>
            </div>

            <button
              onClick={() => setFollowing((f) => !f)}
              className={cn(
                "px-5 py-2.5 rounded-lg font-semibold text-sm transition-colors flex items-center gap-2",
                following
                  ? "bg-slate-800 text-slate-300 border border-slate-700 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30"
                  : "bg-cyan-500 text-slate-950 hover:bg-cyan-400 shadow-[0_0_20px_-5px_rgba(34,211,238,0.5)]"
              )}
            >
              {following ? <><Check className="w-4 h-4" /> Following</> : <><ArrowUpRight className="w-4 h-4" /> Follow & Copy</>}
            </button>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Metric label="ROI 30d"    value={`${(trader.stats?.roi30d ?? 0) >= 0 ? "+" : ""}${(trader.stats?.roi30d ?? 0).toFixed(1)}%`} positive={(trader.stats?.roi30d ?? 0) >= 0} />
          <Metric label="ROI 90d"    value={`${(trader.stats?.roi90d ?? 0) >= 0 ? "+" : ""}${(trader.stats?.roi90d ?? 0).toFixed(0)}%`} />
          <Metric label="All-time"   value={`${(trader.stats?.roiAllTime ?? 0).toFixed(0)}%`} />
          <Metric label="Sharpe"     value={(trader.stats?.sharpeRatio ?? 0).toFixed(2)} />
          <Metric label="Win Rate"   value={`${(trader.stats?.winRatePct ?? 0).toFixed(1)}%`} />
          <Metric label="Max DD"     value={`-${(trader.stats?.maxDrawdownPct ?? 0).toFixed(1)}%`} positive={false} />
          <Metric label="Total Trades" value={`${(trader.stats?.totalTrades ?? 0).toLocaleString()}`} />
          <Metric label="Avg Hold"   value={`${(trader.stats?.avgTradeDurationHours ?? 0).toFixed(1)}h`} />
          <Metric label="P&L 30d"    value={`${(trader.stats?.pnlUsd30d ?? 0) >= 0 ? "+" : "-"}$${Math.abs(trader.stats?.pnlUsd30d ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} positive={(trader.stats?.pnlUsd30d ?? 0) >= 0} />
        </div>

        {/* Equity + recent trades */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 card-dark p-5">
            <h2 className="text-sm font-semibold text-slate-100 mb-4">Equity Curve · 90d</h2>
            <TradingViewChart height={320} />
          </div>

          <div className="card-dark p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-100">Open Positions</h2>
              <span className={cn("text-xs font-semibold number-font", totalPnL >= 0 ? "text-emerald-400" : "text-red-400")}>
                {totalPnL >= 0 ? "+" : ""}${totalPnL.toFixed(0)}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {traderPositions.map((p) => {
                const isLong = p.side === "long";
                const isProfit = p.unrealizedPnl >= 0;
                return (
                  <div key={p.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-900/50">
                    <div className="w-8 h-8 rounded-md bg-slate-800 border border-slate-700/50 flex items-center justify-center text-[10px] font-bold text-slate-300 shrink-0">
                      {p.symbol.slice(0, 3)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-slate-100">{p.symbol}</p>
                        <span className={cn("text-[9px] font-bold px-1 py-0.5 rounded uppercase",
                          isLong ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>
                          {p.side}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 number-font">${p.sizeUsd.toLocaleString()} · {p.leverage}× · {p.protocol}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={cn("text-xs font-semibold number-font flex items-center gap-1 justify-end", isProfit ? "text-emerald-400" : "text-red-400")}>
                        {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {isProfit ? "+" : "-"}${Math.abs(p.unrealizedPnl).toFixed(0)}
                      </div>
                      <p className="text-[9px] text-slate-600 number-font">{p.unrealizedPnlPct.toFixed(1)}%</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
  );
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="card-dark p-3">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</p>
      <p className={cn("text-base font-bold number-font mt-1",
        positive === true ? "text-emerald-400" : positive === false ? "text-red-400" : "text-slate-100")}>
        {value}
      </p>
    </div>
  );
}
