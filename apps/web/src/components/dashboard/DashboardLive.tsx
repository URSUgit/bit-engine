"use client";

import { useState } from "react";
import { DollarSign, TrendingUp, Target, Layers } from "lucide-react";
import { PortfolioCard } from "./PortfolioCard";
import { SignalsFeed } from "./SignalsFeed";
import { TradingViewChart } from "@/components/charts/TradingViewChart";
import { useLivePrices } from "@/hooks/useLivePrices";
import { usePaperTrading } from "@/hooks/usePaperTrading";
import { cn } from "@/lib/utils";

const CHART_TIMEFRAMES = ["1H", "1D", "1W", "1M", "ALL"] as const;

const TF_MAP: Record<string, string> = {
  "1H": "5m",
  "1D": "15m",
  "1W": "1h",
  "1M": "4h",
  "ALL": "1D",
};

function fmtValue(v: number) {
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function DashboardLive() {
  const [chartTf, setChartTf] = useState<(typeof CHART_TIMEFRAMES)[number]>("1M");
  useLivePrices(); // keep prices warm for other components
  const { equity, totalUnrealizedPnl, livePositions, closedPositions, balance, mounted } = usePaperTrading();

  const winCount = closedPositions.filter((p) => (p.pnl ?? 0) > 0).length;
  const winRate = closedPositions.length > 0 ? (winCount / closedPositions.length) * 100 : null;
  const pnlPositive = totalUnrealizedPnl >= 0;
  const pnlSign = pnlPositive ? "+" : "";
  const trend = pnlPositive ? ("up" as const) : ("down" as const);

  return (
    <>
      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <PortfolioCard
          label="Total Equity"
          value={mounted ? fmtValue(equity) : "—"}
          change={mounted ? `${pnlSign}${fmtValue(totalUnrealizedPnl)} unrealized` : "loading…"}
          changePct={mounted ? `Balance: ${fmtValue(balance)}` : ""}
          trend={trend}
          icon={DollarSign}
          sparkline={[42, 44, 43, 45, 47, 46, 48, 49, 47, 48, 50, 48]}
        />
        <PortfolioCard
          label="Unrealized P&L"
          value={mounted ? `${pnlSign}${fmtValue(totalUnrealizedPnl)}` : "—"}
          change="paper · updates every 5s"
          changePct={mounted && equity > 0 ? `${pnlSign}${((totalUnrealizedPnl / equity) * 100).toFixed(2)}%` : ""}
          trend={mounted ? trend : "neutral"}
          icon={TrendingUp}
          sparkline={[30, 31, 30, 33, 35, 34, 36, 37, 36, 37, 38, 38]}
        />
        <PortfolioCard
          label="Win Rate"
          value={winRate !== null ? `${winRate.toFixed(1)}%` : "—"}
          change={closedPositions.length > 0 ? `${winCount}/${closedPositions.length} trades` : "No closed trades yet"}
          changePct=""
          trend={winRate !== null && winRate >= 50 ? "up" : "neutral"}
          icon={Target}
          sparkline={[60, 62, 61, 64, 65, 66, 65, 67, 68, 68, 68.4]}
        />
        <PortfolioCard
          label="Open Positions"
          value={mounted ? String(livePositions.length) : "—"}
          change={livePositions.length > 0 ? `${livePositions.filter(p => p.unrealized_pnl >= 0).length} profitable` : "No open positions"}
          trend="neutral"
          icon={Layers}
        />
      </div>

      {/* Chart + Signals */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 card-dark p-4">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Portfolio Performance</h2>
              <p className="text-xs text-slate-500">Equity curve · USD</p>
            </div>
            <div className="flex gap-1 text-xs bg-slate-900 rounded-lg p-1 border border-slate-800">
              {CHART_TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  onClick={() => setChartTf(tf)}
                  className={cn(
                    "px-2.5 py-1 rounded transition-colors font-medium",
                    tf === chartTf
                      ? "bg-slate-800 text-cyan-300 font-semibold"
                      : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
          <TradingViewChart
            height={320}
            type="area"
            timeframe={TF_MAP[chartTf] ?? "4h"}
            basePrice={mounted ? equity : 10_000}
          />
        </div>

        <div className="card-dark p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-100">Live Signal Feed</h2>
            <span className="flex items-center gap-1.5 text-[10px] text-emerald-400 uppercase tracking-widest font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          </div>
          <SignalsFeed />
        </div>
      </div>
    </>
  );
}
