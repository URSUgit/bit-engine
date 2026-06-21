"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts";
import type { BacktestResult, Trade } from "@/lib/backtest-api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WindowMetrics {
  windowIndex: number; // 1-based label (trade number at center of window)
  winRate: number;     // 0-100
  avgPnlPct: number;
  profitFactor: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeRollingWindowMetrics(
  trades: Trade[],
  windowSize = 20,
  step = 5,
): WindowMetrics[] {
  const result: WindowMetrics[] = [];
  if (trades.length < windowSize) return result;

  for (let start = 0; start + windowSize <= trades.length; start += step) {
    const slice = trades.slice(start, start + windowSize);

    const wins = slice.filter((t) => t.pnl_pct > 0).length;
    const winRate = (wins / slice.length) * 100;

    const totalPnl = slice.reduce((s, t) => s + t.pnl_pct, 0);
    const avgPnlPct = totalPnl / slice.length;

    const grossWin = slice.filter((t) => t.pnl_pct > 0).reduce((s, t) => s + t.pnl_pct, 0);
    const grossLoss = Math.abs(
      slice.filter((t) => t.pnl_pct < 0).reduce((s, t) => s + t.pnl_pct, 0),
    );
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 9.99 : 0;

    result.push({
      windowIndex: start + windowSize, // trade number at end of window
      winRate,
      avgPnlPct,
      profitFactor: Math.min(profitFactor, 9.99),
    });
  }

  return result;
}

type Trend = "Improving" | "Stable" | "Degrading";

function detectTrend(
  windows: WindowMetrics[],
  key: keyof Pick<WindowMetrics, "winRate" | "avgPnlPct" | "profitFactor">,
): Trend {
  if (windows.length < 6) return "Stable";
  const first3 = windows.slice(0, 3);
  const last3 = windows.slice(-3);
  const avgFirst = first3.reduce((s, w) => s + w[key], 0) / 3;
  const avgLast = last3.reduce((s, w) => s + w[key], 0) / 3;
  const delta = avgLast - avgFirst;
  const threshold = Math.abs(avgFirst) * 0.1; // 10% relative change
  if (delta > threshold) return "Improving";
  if (delta < -threshold) return "Degrading";
  return "Stable";
}

function overallTrend(windows: WindowMetrics[]): Trend {
  const winRateTrend = detectTrend(windows, "winRate");
  const pnlTrend = detectTrend(windows, "avgPnlPct");
  const scores: Record<Trend, number> = { Improving: 0, Stable: 0, Degrading: 0 };
  scores[winRateTrend]++;
  scores[pnlTrend]++;
  if (scores.Improving > scores.Degrading) return "Improving";
  if (scores.Degrading > scores.Improving) return "Degrading";
  return "Stable";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface SparklineProps {
  data: WindowMetrics[];
  dataKey: keyof Pick<WindowMetrics, "winRate" | "avgPnlPct" | "profitFactor">;
  color: string;
  label: string;
  formatter: (v: number) => string;
}

function Sparkline({ data, dataKey, color, label, formatter }: SparklineProps) {
  const values = data.map((d) => d[dataKey] as number);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const latest = values[values.length - 1];

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>
        <span className="text-xs font-mono text-zinc-300">{formatter(latest)}</span>
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
          <XAxis dataKey="windowIndex" hide />
          <YAxis
            domain={[minVal * 0.95, maxVal * 1.05]}
            tick={{ fontSize: 9, fill: "#71717a" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: unknown) => {
              const n = typeof v === "number" ? v : Number(v);
              return formatter(n);
            }}
            width={38}
            tickCount={3}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function BenchmarkTracker({ result }: { result: BacktestResult }) {
  const { trades } = result;

  const windows = useMemo(
    () => computeRollingWindowMetrics(trades, 20, 5),
    [trades],
  );

  const trend = useMemo(() => overallTrend(windows), [windows]);

  const trendColor =
    trend === "Improving"
      ? "text-emerald-400"
      : trend === "Degrading"
      ? "text-red-400"
      : "text-amber-400";

  const trendIcon =
    trend === "Improving" ? "↑" : trend === "Degrading" ? "↓" : "→";

  if (trades.length < 20) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-300 mb-3">
          Benchmark Tracker
        </h3>
        <p className="text-zinc-500 text-sm text-center py-6">
          Need at least 20 trades to compute rolling metrics (currently {trades.length}).
        </p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">
          Benchmark Tracker
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">20-trade rolling windows · step 5</span>
          <span className={`text-sm font-semibold ${trendColor}`}>
            {trendIcon} Performance is {trend}
          </span>
        </div>
      </div>

      {windows.length === 0 ? (
        <p className="text-zinc-500 text-sm text-center py-4">
          Not enough trades for rolling windows.
        </p>
      ) : (
        <div className="space-y-3 divide-y divide-zinc-800">
          {/* Win Rate sparkline */}
          <div className="pt-0">
            <Sparkline
              data={windows}
              dataKey="winRate"
              color="#4ade80"
              label="Rolling Win Rate %"
              formatter={(v) => `${v.toFixed(1)}%`}
            />
          </div>

          {/* Avg P&L % sparkline */}
          <div className="pt-3">
            <Sparkline
              data={windows}
              dataKey="avgPnlPct"
              color="#4ade80"
              label="Rolling Avg P&L %"
              formatter={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`}
            />
          </div>

          {/* Profit Factor sparkline */}
          <div className="pt-3">
            <Sparkline
              data={windows}
              dataKey="profitFactor"
              color="#f59e0b"
              label="Rolling Profit Factor"
              formatter={(v) => v.toFixed(2)}
            />
          </div>
        </div>
      )}

      {/* Footer summary */}
      <div className="border-t border-zinc-800 pt-3 flex flex-wrap gap-4 text-xs text-zinc-500">
        <span>Windows: {windows.length}</span>
        <span>Trades analyzed: {trades.length}</span>
        <span>
          Latest win rate:{" "}
          <span className="text-zinc-300">
            {windows.length > 0 ? `${windows[windows.length - 1].winRate.toFixed(1)}%` : "—"}
          </span>
        </span>
        <span>
          Latest profit factor:{" "}
          <span className="text-zinc-300">
            {windows.length > 0 ? windows[windows.length - 1].profitFactor.toFixed(2) : "—"}
          </span>
        </span>
      </div>
    </div>
  );
}
