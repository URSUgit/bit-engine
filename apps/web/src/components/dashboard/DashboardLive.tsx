"use client";

import { useMemo, useState } from "react";
import { DollarSign, TrendingUp, Target, Layers } from "lucide-react";
import { PortfolioCard } from "./PortfolioCard";
import { SignalsFeed } from "./SignalsFeed";
import { TradingViewChart } from "@/components/charts/TradingViewChart";
import { useLivePrices } from "@/hooks/useLivePrices";
import { cn } from "@/lib/utils";

const CHART_TIMEFRAMES = ["1H", "1D", "1W", "1M", "ALL"] as const;

// TradingViewChart timeframe arg per dashboard period
const TF_MAP: Record<string, string> = {
  "1H": "5m",
  "1D": "15m",
  "1W": "1h",
  "1M": "4h",
  "ALL": "1D",
};

// Open positions tracked for live P&L
const POSITIONS = [
  { sym: "ETH",  side: "long"  as const, size: 4_200,  entry: 3_420.00  },
  { sym: "BTC",  side: "long"  as const, size: 8_000,  entry: 68_200.00 },
  { sym: "SOL",  side: "short" as const, size: 2_000,  entry: 182.40    },
  { sym: "ARB",  side: "long"  as const, size: 800,    entry: 1.24      },
  { sym: "DOGE", side: "long"  as const, size: 600,    entry: 0.1820    },
  { sym: "SUI",  side: "short" as const, size: 1_200,  entry: 1.31      },
] as const;

const BASE_VALUE = 43_820; // locked capital not in live positions

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
  const live = useLivePrices();

  const { totalValue, pnlUsd, pnlPct, trend } = useMemo(() => {
    let unrealized = 0;
    for (const p of POSITIONS) {
      const price = live[p.sym]?.price ?? p.entry;
      const sign = p.side === "long" ? 1 : -1;
      unrealized += ((price / p.entry) - 1) * p.size * sign;
    }
    const total = BASE_VALUE + unrealized;
    const pct = (unrealized / BASE_VALUE) * 100;
    return {
      totalValue: total,
      pnlUsd: unrealized,
      pnlPct: pct,
      trend: pct >= 0 ? ("up" as const) : ("down" as const),
    };
  }, [live]);

  const pnlSign = pnlUsd >= 0 ? "+" : "";

  return (
    <>
      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <PortfolioCard
          label="Total Value"
          value={fmtValue(totalValue)}
          change={`${pnlSign}${fmtValue(pnlUsd)}`}
          changePct={`${pnlSign}${pnlPct.toFixed(2)}%`}
          trend={trend}
          icon={DollarSign}
          sparkline={[42, 44, 43, 45, 47, 46, 48, 49, 47, 48, 50, 48]}
        />
        <PortfolioCard
          label="Unrealized P&L"
          value={`${pnlSign}${fmtValue(pnlUsd)}`}
          change="live · updates every tick"
          changePct={`${pnlSign}${pnlPct.toFixed(2)}%`}
          trend={trend}
          icon={TrendingUp}
          sparkline={[30, 31, 30, 33, 35, 34, 36, 37, 36, 37, 38, 38]}
        />
        <PortfolioCard
          label="Win Rate"
          value="68.4%"
          change="+1.2 pts"
          changePct="vs last week"
          trend="up"
          icon={Target}
          sparkline={[60, 62, 61, 64, 65, 66, 65, 67, 68, 68, 68.4]}
        />
        <PortfolioCard
          label="Open Positions"
          value="7"
          change="2 opened today"
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
            basePrice={totalValue}
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
