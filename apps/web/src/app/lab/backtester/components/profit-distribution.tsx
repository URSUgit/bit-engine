"use client";

import { useMemo } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Line,
  ComposedChart,
} from "recharts";

const NUM_BINS = 20;

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function stdDev(arr: number[], mu?: number): number {
  if (arr.length < 2) return 0;
  const m = mu ?? mean(arr);
  const variance = arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function skewness(arr: number[], mu: number, sigma: number): number {
  if (arr.length < 3 || sigma === 0) return 0;
  const n = arr.length;
  const s3 = arr.reduce((s, x) => s + ((x - mu) / sigma) ** 3, 0);
  return (n / ((n - 1) * (n - 2))) * s3;
}

function kurtosis(arr: number[], mu: number, sigma: number): number {
  if (arr.length < 4 || sigma === 0) return 0;
  const n = arr.length;
  const s4 = arr.reduce((s, x) => s + ((x - mu) / sigma) ** 4, 0);
  return (
    ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * s4 -
    (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
  );
}

function normalPDF(x: number, mu: number, sigma: number): number {
  if (sigma === 0) return 0;
  return (
    (1 / (sigma * Math.sqrt(2 * Math.PI))) *
    Math.exp(-0.5 * ((x - mu) / sigma) ** 2)
  );
}

interface BinData {
  binCenter: number;
  count: number;
  normalExpected: number;
  label: string;
}

export function ProfitDistribution({ result }: { result: BacktestResult }) {
  const pnlPcts = useMemo(
    () => result.trades.map((t) => t.pnl_pct),
    [result.trades],
  );

  const stats = useMemo(() => {
    if (pnlPcts.length === 0) {
      return { mean: 0, median: 0, std: 0, skew: 0, kurt: 0 };
    }
    const mu = mean(pnlPcts);
    const med = median(pnlPcts);
    const sig = stdDev(pnlPcts, mu);
    const skew = skewness(pnlPcts, mu, sig);
    const kurt = kurtosis(pnlPcts, mu, sig);
    return { mean: mu, median: med, std: sig, skew, kurt };
  }, [pnlPcts]);

  const tailRisk = useMemo(
    () => ({
      above5: pnlPcts.filter((p) => p > 5).length,
      below5: pnlPcts.filter((p) => p < -5).length,
      above10: pnlPcts.filter((p) => p > 10).length,
      below10: pnlPcts.filter((p) => p < -10).length,
    }),
    [pnlPcts],
  );

  const histogram = useMemo((): BinData[] => {
    if (pnlPcts.length === 0) return [];

    const minVal = Math.min(...pnlPcts);
    const maxVal = Math.max(...pnlPcts);
    const range = maxVal - minVal || 1;
    const binWidth = range / NUM_BINS;

    const bins: BinData[] = Array.from({ length: NUM_BINS }, (_, i) => {
      const low = minVal + i * binWidth;
      const high = low + binWidth;
      const center = (low + high) / 2;
      return {
        binCenter: center,
        count: 0,
        normalExpected: 0,
        label: center.toFixed(1) + "%",
      };
    });

    for (const p of pnlPcts) {
      const idx = Math.min(
        Math.floor(((p - minVal) / range) * NUM_BINS),
        NUM_BINS - 1,
      );
      bins[idx].count++;
    }

    // Compute normal PDF scaled to same area as histogram
    // area of histogram = N * binWidth; PDF integrates to 1 so scale by N * binWidth
    const scale = pnlPcts.length * binWidth;
    for (const bin of bins) {
      bin.normalExpected = normalPDF(bin.binCenter, stats.mean, stats.std) * scale;
    }

    return bins;
  }, [pnlPcts, stats.mean, stats.std]);

  if (pnlPcts.length === 0) {
    return (
      <div className="text-center text-zinc-500 py-10">No trades to analyze.</div>
    );
  }

  const statCards = [
    { label: "Mean P&L", value: `${stats.mean.toFixed(2)}%`, color: stats.mean >= 0 ? "text-emerald-400" : "text-red-400" },
    { label: "Median P&L", value: `${stats.median.toFixed(2)}%`, color: stats.median >= 0 ? "text-emerald-400" : "text-red-400" },
    { label: "Std Dev", value: `${stats.std.toFixed(2)}%`, color: "text-zinc-200" },
    { label: "Skewness", value: stats.skew.toFixed(3), color: stats.skew > 0 ? "text-emerald-400" : stats.skew < 0 ? "text-orange-400" : "text-zinc-200" },
    { label: "Kurtosis", value: stats.kurt.toFixed(3), color: Math.abs(stats.kurt) > 1 ? "text-yellow-400" : "text-zinc-200" },
  ];

  return (
    <div className="space-y-5">
      {/* Stats panel */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3"
          >
            <div className="text-xs text-zinc-500 mb-1">{card.label}</div>
            <div className={`text-lg font-bold ${card.color}`}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Histogram with normal overlay */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-3">
          P&amp;L distribution — {NUM_BINS} bins with normal overlay
        </h4>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart
            data={histogram}
            margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="label"
              tick={{ fill: "#71717a", fontSize: 10 }}
              interval={Math.floor(NUM_BINS / 5)}
            />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} />
            <Tooltip
              contentStyle={{
                background: "#18181b",
                border: "1px solid #3f3f46",
                borderRadius: 6,
              }}
              formatter={(value: number, name: string) => [
                name === "count"
                  ? `${value} trade${value !== 1 ? "s" : ""}`
                  : value.toFixed(2),
                name === "count" ? "Trades" : "Normal expected",
              ]}
            />
            <ReferenceLine
              x={stats.mean.toFixed(1) + "%"}
              stroke="#06b6d4"
              strokeDasharray="4 2"
              label={{ value: "Mean", fill: "#06b6d4", fontSize: 10, position: "top" }}
            />
            <Bar dataKey="count" radius={[2, 2, 0, 0]}>
              {histogram.map((bin, i) => (
                <Cell
                  key={i}
                  fill={bin.binCenter >= 0 ? "#22c55e" : "#ef4444"}
                  fillOpacity={0.75}
                />
              ))}
            </Bar>
            <Line
              type="monotone"
              dataKey="normalExpected"
              stroke="#a78bfa"
              strokeWidth={2}
              dot={false}
              name="normalExpected"
            />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-zinc-600 mt-1">
          Purple line = normal distribution with same mean &amp; std dev. Green bars = profitable, red bars = losing.
        </p>
      </div>

      {/* Tail risk */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-3">Tail risk</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "Trades > +5%",
              value: tailRisk.above5,
              pct: ((tailRisk.above5 / pnlPcts.length) * 100).toFixed(1),
              color: "text-emerald-400",
            },
            {
              label: "Trades < -5%",
              value: tailRisk.below5,
              pct: ((tailRisk.below5 / pnlPcts.length) * 100).toFixed(1),
              color: "text-red-400",
            },
            {
              label: "Trades > +10%",
              value: tailRisk.above10,
              pct: ((tailRisk.above10 / pnlPcts.length) * 100).toFixed(1),
              color: "text-emerald-300",
            },
            {
              label: "Trades < -10%",
              value: tailRisk.below10,
              pct: ((tailRisk.below10 / pnlPcts.length) * 100).toFixed(1),
              color: "text-red-300",
            },
          ].map((item) => (
            <div
              key={item.label}
              className="text-center bg-zinc-950/50 border border-zinc-800 rounded-lg p-3"
            >
              <div className="text-xs text-zinc-500 mb-1">{item.label}</div>
              <div className={`text-xl font-bold ${item.color}`}>{item.value}</div>
              <div className="text-xs text-zinc-500">{item.pct}% of trades</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
