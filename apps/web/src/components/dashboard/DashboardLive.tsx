"use client";

import { useState, useEffect } from "react";
import { DollarSign, TrendingUp, Target, Layers, Newspaper, Radio } from "lucide-react";
import { PortfolioCard } from "./PortfolioCard";
import { SignalsFeed } from "./SignalsFeed";
import { NewsFeed } from "./NewsFeed";
import { FearGreedWidget } from "./FearGreedWidget";
import { TradingViewChart, type LineBar } from "@/components/charts/TradingViewChart";
import { useLivePrices } from "@/hooks/useLivePrices";
import { usePaperTrading } from "@/hooks/usePaperTrading";
import { cn } from "@/lib/utils";

const CHART_TIMEFRAMES = ["1H", "1D", "1W", "1M"] as const;

const TF_MAP: Record<string, string> = {
  "1H": "5m",
  "1D": "15m",
  "1W": "1h",
  "1M": "4h",
};

function fmtValue(v: number) {
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type RightTab = "signals" | "news";

export function DashboardLive() {
  const [chartTf, setChartTf] = useState<(typeof CHART_TIMEFRAMES)[number]>("1M");
  const [rightTab, setRightTab] = useState<RightTab>("signals");
  const [chartData, setChartData] = useState<LineBar[] | undefined>(undefined);
  useLivePrices(); // keep prices warm for other components
  const { equity, totalUnrealizedPnl, livePositions, closedPositions, balance, mounted } = usePaperTrading();

  // Fetch real BTC klines for the dashboard chart
  useEffect(() => {
    const interval = TF_MAP[chartTf] ?? "4h";
    setChartData(undefined);
    fetch(`/api/exchange/klines?symbol=BTC&interval=${interval}&limit=200`)
      .then((r) => r.json())
      .then((res: { data?: Array<{ t: number; close: number }> }) => {
        if (res.data?.length) {
          setChartData(
            res.data.map((k) => ({ time: Math.floor(k.t / 1000) as LineBar["time"], value: k.close }))
          );
        }
      })
      .catch(() => setChartData(undefined));
  }, [chartTf]);

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

      {/* Fear & Greed + Top Movers strip */}
      <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-4">
        <FearGreedWidget />
        <div className="card-dark p-4 flex flex-col justify-between">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Market Summary</p>
          <p className="text-xs text-slate-400 leading-relaxed">
            Real-time paper trading against live Binance prices. Open positions are mark-to-market every 5 seconds.
            Win rate and P&amp;L update as trades close.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {["BTC", "ETH", "SOL", "BNB", "XRP"].map((sym) => (
              <a key={sym} href={`/dashboard/markets/${sym}`}
                className="text-xs px-2 py-1 rounded-lg bg-slate-800 text-slate-400 hover:text-cyan-300 hover:bg-slate-700 transition-colors font-medium">
                {sym} →
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Chart + Signals */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 card-dark p-4">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">BTC/USD</h2>
              <p className="text-xs text-slate-500">Live market price</p>
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
            data={chartData}
          />
        </div>

        <div className="card-dark p-4 flex flex-col">
          {/* Tab bar */}
          <div className="flex items-center gap-1 mb-4 bg-slate-900/60 rounded-lg p-1 border border-slate-800 self-start w-full">
            <button
              onClick={() => setRightTab("signals")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors",
                rightTab === "signals"
                  ? "bg-slate-800 text-cyan-300"
                  : "text-slate-500 hover:text-slate-300"
              )}
            >
              <Radio className="w-3 h-3" />
              Signals
              {rightTab === "signals" && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse ml-0.5" />
              )}
            </button>
            <button
              onClick={() => setRightTab("news")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors",
                rightTab === "news"
                  ? "bg-slate-800 text-cyan-300"
                  : "text-slate-500 hover:text-slate-300"
              )}
            >
              <Newspaper className="w-3 h-3" />
              News
            </button>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[420px]">
            {rightTab === "signals" ? <SignalsFeed /> : <NewsFeed />}
          </div>
        </div>
      </div>
    </>
  );
}
