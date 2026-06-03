"use client";

import { useState, useCallback, useEffect } from "react";
import { RefreshCw, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Constants ──────────────────────────────────────────────────────────────────

const COINS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "MATIC", "LINK", "ARB", "OP"] as const;
type Coin = (typeof COINS)[number];

const TIMEFRAMES = ["5m", "1h", "4h", "1d"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

const TF_LABELS: Record<Timeframe, string> = {
  "5m": "5m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1D",
};

// ── RSI computation ────────────────────────────────────────────────────────────

/**
 * Wilder's RSI(period) computed from an array of closing prices.
 * Returns null when there are not enough data points.
 */
export function computeRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;

  const deltas: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    deltas.push(closes[i] - closes[i - 1]);
  }

  // Use only the last (period * 2) deltas so recent data dominates
  const relevant = deltas.slice(-period * 2);

  // Seed average gain / loss from the first `period` deltas
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (relevant[i] > 0) avgGain += relevant[i];
    else avgLoss += Math.abs(relevant[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder smoothing for subsequent deltas
  for (let i = period; i < relevant.length; i++) {
    const gain = relevant[i] > 0 ? relevant[i] : 0;
    const loss = relevant[i] < 0 ? Math.abs(relevant[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ── Cell styling ───────────────────────────────────────────────────────────────

function rsiCellClass(rsi: number): string {
  if (rsi > 70) return "bg-red-500/80 text-white";
  if (rsi > 60) return "bg-red-500/30 text-red-300";
  if (rsi > 50) return "bg-emerald-500/20 text-emerald-300";
  if (rsi > 40) return "bg-slate-700 text-slate-400";
  if (rsi > 30) return "bg-blue-500/30 text-blue-300";
  return "bg-blue-500/80 text-white";
}

function rsiLabel(rsi: number): string {
  if (rsi > 70) return "OB";
  if (rsi < 30) return "OS";
  return "";
}

// ── Types ──────────────────────────────────────────────────────────────────────

type RsiGrid = Record<Coin, Partial<Record<Timeframe, number | null>>>;
type LoadingGrid = Record<Coin, Partial<Record<Timeframe, boolean>>>;

// ── Skeleton cell ──────────────────────────────────────────────────────────────

function SkeletonCell() {
  return (
    <div className="h-11 rounded bg-slate-800 animate-pulse" />
  );
}

// ── RSI Cell ──────────────────────────────────────────────────────────────────

function RsiCell({ rsi, loading }: { rsi: number | null | undefined; loading: boolean }) {
  if (loading) return <SkeletonCell />;

  if (rsi === null || rsi === undefined) {
    return (
      <div className="h-11 rounded bg-slate-800/60 flex items-center justify-center text-slate-600 text-xs">
        —
      </div>
    );
  }

  const label = rsiLabel(rsi);

  return (
    <div
      className={cn(
        "h-11 rounded flex flex-col items-center justify-center gap-0.5 transition-colors",
        rsiCellClass(rsi)
      )}
      title={`RSI: ${rsi.toFixed(1)}`}
    >
      <span className="text-[13px] font-bold number-font leading-none">{rsi.toFixed(0)}</span>
      {label && (
        <span className="text-[9px] font-semibold uppercase tracking-wider opacity-80 leading-none">
          {label}
        </span>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function MomentumHeatmap() {
  const [rsiGrid, setRsiGrid] = useState<RsiGrid>(() => {
    const grid = {} as RsiGrid;
    for (const coin of COINS) grid[coin] = {};
    return grid;
  });

  const [loadingGrid, setLoadingGrid] = useState<LoadingGrid>(() => {
    const grid = {} as LoadingGrid;
    for (const coin of COINS) {
      grid[coin] = {};
      for (const tf of TIMEFRAMES) grid[coin][tf] = true;
    }
    return grid;
  });

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const fetchAll = useCallback(async () => {
    setIsFetching(true);

    // Mark all cells as loading
    setLoadingGrid(() => {
      const grid = {} as LoadingGrid;
      for (const coin of COINS) {
        grid[coin] = {};
        for (const tf of TIMEFRAMES) grid[coin][tf] = true;
      }
      return grid;
    });

    const tasks: Array<{ coin: Coin; tf: Timeframe; promise: Promise<number | null> }> = [];

    for (const coin of COINS) {
      for (const tf of TIMEFRAMES) {
        const promise = fetch(`/api/exchange/klines?symbol=${coin}&interval=${tf}&limit=50`)
          .then(async (res) => {
            if (!res.ok) return null;
            const json = await res.json() as { data?: Array<{ close: number }> };
            if (!json.data || json.data.length === 0) return null;
            const closes = json.data.map((k) => Number(k.close));
            return computeRSI(closes);
          })
          .catch(() => null);
        tasks.push({ coin, tf, promise });
      }
    }

    const results = await Promise.allSettled(tasks.map((t) => t.promise));

    setRsiGrid((prev) => {
      const next = { ...prev };
      results.forEach((result, idx) => {
        const { coin, tf } = tasks[idx];
        const rsi = result.status === "fulfilled" ? result.value : null;
        next[coin] = { ...next[coin], [tf]: rsi };
      });
      return next;
    });

    setLoadingGrid(() => {
      const grid = {} as LoadingGrid;
      for (const coin of COINS) {
        grid[coin] = {};
        for (const tf of TIMEFRAMES) grid[coin][tf] = false;
      }
      return grid;
    });

    setLastUpdated(new Date());
    setIsFetching(false);
  }, []);

  useEffect(() => {
    void fetchAll();
    // Refresh every 5 minutes
    const interval = setInterval(() => void fetchAll(), 5 * 60_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  return (
    <div className="card-dark overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-bold text-slate-200 tracking-tight">Momentum Heatmap</h2>
          <span className="text-xs text-slate-500">· RSI(14) across timeframes</span>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-[11px] text-slate-600">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => void fetchAll()}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={cn("w-3 h-3", isFetching && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-2.5 border-b border-slate-800/60 bg-slate-950/30">
        <span className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">RSI scale:</span>
        {[
          { label: ">70 Overbought", cls: "bg-red-500/80 text-white" },
          { label: "60–70", cls: "bg-red-500/30 text-red-300" },
          { label: "50–60", cls: "bg-emerald-500/20 text-emerald-300" },
          { label: "40–50", cls: "bg-slate-700 text-slate-400" },
          { label: "30–40", cls: "bg-blue-500/30 text-blue-300" },
          { label: "<30 Oversold", cls: "bg-blue-500/80 text-white" },
        ].map(({ label, cls }) => (
          <span key={label} className={cn("text-[10px] font-medium px-2 py-0.5 rounded", cls)}>
            {label}
          </span>
        ))}
      </div>

      {/* Grid */}
      <div className="overflow-x-auto">
        <div className="min-w-[560px] p-4">
          {/* Timeframe header row */}
          <div className="grid gap-2" style={{ gridTemplateColumns: "72px repeat(4, 1fr)" }}>
            <div />
            {TIMEFRAMES.map((tf) => (
              <div
                key={tf}
                className="text-center text-[10px] font-bold uppercase tracking-widest text-slate-500 pb-1"
              >
                {TF_LABELS[tf]}
              </div>
            ))}

            {/* Coin rows */}
            {COINS.map((coin) => (
              <>
                {/* Coin label */}
                <div
                  key={`${coin}-label`}
                  className="flex items-center h-11 text-xs font-bold text-slate-300 uppercase tracking-wide"
                >
                  {coin}
                </div>

                {/* RSI cells */}
                {TIMEFRAMES.map((tf) => (
                  <RsiCell
                    key={`${coin}-${tf}`}
                    rsi={rsiGrid[coin][tf]}
                    loading={loadingGrid[coin][tf] ?? true}
                  />
                ))}
              </>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
