"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, ExternalLink, TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { TradingViewChart } from "@/components/charts/TradingViewChart";
import { cn } from "@/lib/utils";
import type { TraderEntry } from "@/app/api/market/traders/route";
import { usePaperTrading } from "@/hooks/usePaperTrading";

const AVATAR_COLORS = [
  "from-cyan-500 to-blue-600",
  "from-violet-500 to-purple-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-pink-500 to-rose-600",
];

function fmtUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export default function TraderDetailPage() {
  const params = useParams<{ id: string }>();
  const rank = parseInt(params?.id ?? "1", 10);
  const [trader, setTrader] = useState<TraderEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const { livePositions } = usePaperTrading();

  useEffect(() => {
    fetch("/api/market/traders?limit=100")
      .then((r) => r.json())
      .then((res: { data?: TraderEntry[] }) => {
        const list = res.data ?? [];
        const found = list.find((t) => t.rank === rank) ?? list[0] ?? null;
        setTrader(found);
      })
      .catch(() => setTrader(null))
      .finally(() => setLoading(false));
  }, [rank]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
      </div>
    );
  }

  if (!trader) {
    return (
      <div className="p-6">
        <Link href="/dashboard/leaderboard" className="text-slate-500 hover:text-slate-300 text-sm flex items-center gap-1.5 w-fit">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to leaderboard
        </Link>
        <p className="mt-8 text-slate-500 text-center">Trader not found.</p>
      </div>
    );
  }

  const avatarColor = AVATAR_COLORS[(trader.rank - 1) % AVATAR_COLORS.length] as string;

  return (
    <div className="flex flex-col gap-5 p-6 max-w-[1600px] mx-auto">
      <Link href="/dashboard/leaderboard" className="text-slate-500 hover:text-slate-300 transition-colors w-fit text-sm flex items-center gap-1.5">
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to leaderboard
      </Link>

      {/* Header card */}
      <div className="card-dark p-6">
        <div className="flex items-start gap-5 flex-wrap">
          <div className={cn("w-20 h-20 rounded-full bg-gradient-to-br flex items-center justify-center text-3xl font-bold text-white shrink-0", avatarColor)}>
            {(trader.handle?.[0] ?? "?").toUpperCase()}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-50 tracking-tight">{trader.handle}</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                Rank #{trader.rank}
              </span>
              {trader.source === "hyperliquid" && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-400">
                  Hyperliquid
                </span>
              )}
            </div>
            <a
              href={`https://hyperliquid.xyz/stats/${trader.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-slate-500 hover:text-cyan-400 transition-colors inline-flex items-center gap-1"
            >
              {trader.address.slice(0, 10)}…{trader.address.slice(-8)}
              <ExternalLink className="w-3 h-3" />
            </a>
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
            {following ? <><Check className="w-4 h-4" /> Following</> : <><ArrowUpRight className="w-4 h-4" /> Follow &amp; Copy</>}
          </button>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Metric label="ROI 30d"   value={`${trader.roi_30d >= 0 ? "+" : ""}${trader.roi_30d.toFixed(1)}%`}   positive={trader.roi_30d >= 0} />
        <Metric label="ROI 7d"    value={`${trader.roi_7d >= 0 ? "+" : ""}${trader.roi_7d.toFixed(1)}%`}     positive={trader.roi_7d >= 0} />
        <Metric label="P&L 30d"   value={fmtUsd(trader.pnl_30d)}                                             positive={trader.pnl_30d >= 0} />
        <Metric label="Volume 30d" value={fmtUsd(trader.volume_30d)} />
        <Metric label="Win Rate"  value={`${trader.win_rate.toFixed(1)}%`} />
        <Metric label="Account"   value={fmtUsd(trader.account_value)} />
      </div>

      {/* Equity + positions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card-dark p-5">
          <h2 className="text-sm font-semibold text-slate-100 mb-4">Equity Curve · 90d</h2>
          <TradingViewChart height={320} />
        </div>

        <div className="card-dark p-5">
          <h2 className="text-sm font-semibold text-slate-100 mb-4">Your Open Positions</h2>
          {livePositions.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">No open positions</p>
          ) : (
            <div className="flex flex-col gap-2">
              {livePositions.slice(0, 6).map((p) => {
                const isLong = p.side === "long";
                const isProfit = p.unrealized_pnl >= 0;
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
                      <p className="text-[10px] text-slate-500 number-font">${p.size_usd.toLocaleString()} · {p.leverage}×</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={cn("text-xs font-semibold number-font flex items-center gap-1 justify-end", isProfit ? "text-emerald-400" : "text-red-400")}>
                        {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {isProfit ? "+" : "-"}${Math.abs(p.unrealized_pnl).toFixed(0)}
                      </div>
                      <p className="text-[9px] text-slate-600 number-font">{p.unrealized_pnl_pct.toFixed(1)}%</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
