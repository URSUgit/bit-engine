"use client";

import { useMemo } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, ReferenceLine, Area, Legend,
} from "recharts";

function trendSlope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - mx) * ((ys[i] ?? 0) - my), 0);
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return den === 0 ? 0 : num / den;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - mx) * ((ys[i] ?? 0) - my), 0);
  const dx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0));
  const dy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
  return dx === 0 || dy === 0 ? 0 : num / (dx * dy);
}

const N_PERIODS = 8;

export function PerformanceDecay({ result }: { result: BacktestResult }) {
  const { trades, metrics } = result;

  const periods = useMemo(() => {
    if (trades.length < N_PERIODS * 3) return [];
    const perPeriod = Math.floor(trades.length / N_PERIODS);
    return Array.from({ length: N_PERIODS }, (_, i) => {
      const slice = trades.slice(i * perPeriod, (i + 1) * perPeriod);
      const wins = slice.filter((t) => t.pnl_pct > 0);
      const losses = slice.filter((t) => t.pnl_pct <= 0);
      const totalPnl = slice.reduce((s, t) => s + t.pnl_pct, 0);
      const mean = totalPnl / slice.length;
      const std = Math.sqrt(slice.reduce((s, t) => s + (t.pnl_pct - mean) ** 2, 0) / Math.max(1, slice.length - 1));
      const grossWin = wins.reduce((s, t) => s + t.pnl_pct, 0);
      const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl_pct, 0));
      const entryDate = slice[0]?.entry_time?.slice(0, 10) ?? "";
      return {
        period: i + 1,
        label: `P${i + 1}`,
        entryDate,
        count: slice.length,
        winRate: (wins.length / slice.length) * 100,
        totalPnl,
        avgPnl: mean,
        sharpe: std > 0 ? (mean / std) * Math.sqrt(252) : 0,
        profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 9.99 : 0,
      };
    });
  }, [trades]);

  const decayStats = useMemo(() => {
    if (periods.length < 3) return null;
    const xs = periods.map((p) => p.period);
    const winRates = periods.map((p) => p.winRate);
    const avgPnls = periods.map((p) => p.avgPnl);
    const sharpes = periods.map((p) => p.sharpe);
    return {
      winRateSlope: trendSlope(xs, winRates),
      winRateR: pearson(xs, winRates),
      avgPnlSlope: trendSlope(xs, avgPnls),
      avgPnlR: pearson(xs, avgPnls),
      sharpeSlope: trendSlope(xs, sharpes),
      sharpeR: pearson(xs, sharpes),
    };
  }, [periods]);

  const decayVerdict = useMemo(() => {
    if (!decayStats) return null;
    const score = [
      decayStats.winRateR,
      decayStats.avgPnlR,
      decayStats.sharpeR,
    ].reduce((s, r) => s + r, 0) / 3;
    if (score < -0.5) return { label: "Strong Decay", color: "text-red-400", bg: "bg-red-950/30 border-red-800/40" };
    if (score < -0.2) return { label: "Moderate Decay", color: "text-amber-400", bg: "bg-amber-950/20 border-amber-800/30" };
    if (score < 0.2) return { label: "Stable Edge", color: "text-zinc-300", bg: "bg-zinc-800/40 border-zinc-700/40" };
    return { label: "Improving Edge", color: "text-emerald-400", bg: "bg-emerald-950/20 border-emerald-800/30" };
  }, [decayStats]);

  if (trades.length < N_PERIODS * 3) {
    return (
      <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">
        Need at least {N_PERIODS * 3} trades for decay analysis.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Verdict banner */}
      {decayVerdict && (
        <div className={`border rounded-lg p-4 ${decayVerdict.bg}`}>
          <div className="flex items-start gap-3">
            <div>
              <div className={`text-base font-bold ${decayVerdict.color}`}>{decayVerdict.label}</div>
              {decayStats && (
                <div className="text-xs text-zinc-400 mt-1">
                  Win rate trend: {decayStats.winRateR > 0 ? "↑" : "↓"} (r={decayStats.winRateR.toFixed(2)}) ·{" "}
                  Avg PnL trend: {decayStats.avgPnlR > 0 ? "↑" : "↓"} (r={decayStats.avgPnlR.toFixed(2)}) ·{" "}
                  Sharpe trend: {decayStats.sharpeR > 0 ? "↑" : "↓"} (r={decayStats.sharpeR.toFixed(2)})
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Period metrics table */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 overflow-x-auto">
        <h4 className="text-sm font-semibold text-zinc-300 mb-3">Performance by Time Period ({Math.floor(trades.length / N_PERIODS)} trades each)</h4>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-500 border-b border-zinc-800">
              <th className="text-left pb-2 font-normal">Period</th>
              <th className="text-right pb-2 font-normal">From</th>
              <th className="text-right pb-2 font-normal">Trades</th>
              <th className="text-right pb-2 font-normal">Win Rate</th>
              <th className="text-right pb-2 font-normal">Total PnL</th>
              <th className="text-right pb-2 font-normal">Avg PnL</th>
              <th className="text-right pb-2 font-normal">Sharpe</th>
              <th className="text-right pb-2 font-normal">PF</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p, i) => {
              const isDecreasing = i > 0 && (periods[i - 1]?.avgPnl ?? 0) > p.avgPnl;
              return (
                <tr key={p.period} className="border-b border-zinc-800/50">
                  <td className="py-1.5 text-zinc-400 font-mono">{p.label}</td>
                  <td className="py-1.5 text-right text-zinc-500 font-mono text-[10px]">{p.entryDate}</td>
                  <td className="py-1.5 text-right text-zinc-400">{p.count}</td>
                  <td className={`py-1.5 text-right font-mono ${isDecreasing ? "text-amber-400" : "text-emerald-400"}`}>
                    {p.winRate.toFixed(1)}%
                  </td>
                  <td className={`py-1.5 text-right font-mono ${p.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {p.totalPnl >= 0 ? "+" : ""}{p.totalPnl.toFixed(2)}%
                  </td>
                  <td className={`py-1.5 text-right font-mono ${p.avgPnl >= 0 ? "text-zinc-300" : "text-red-400"}`}>
                    {p.avgPnl >= 0 ? "+" : ""}{p.avgPnl.toFixed(3)}%
                  </td>
                  <td className={`py-1.5 text-right font-mono ${p.sharpe >= 1 ? "text-emerald-400" : p.sharpe >= 0 ? "text-amber-400" : "text-red-400"}`}>
                    {p.sharpe.toFixed(2)}
                  </td>
                  <td className={`py-1.5 text-right font-mono ${p.profitFactor >= 1 ? "text-zinc-300" : "text-red-400"}`}>
                    {Math.min(p.profitFactor, 9.99).toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Win rate + avg PnL over periods */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">Win Rate & Avg PnL Over Time</h4>
        <p className="text-[10px] text-zinc-600 mb-3">Downward trend in both metrics indicates edge decay.</p>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={periods} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 11 }} />
            <YAxis yAxisId="left" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} domain={["auto", "auto"]} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(2)}%`} />
            <Area yAxisId="left" type="monotone" dataKey="winRate" name="Win Rate" stroke="#22c55e" fill="#22c55e20" strokeWidth={2} isAnimationActive={false} />
            <Line yAxisId="right" type="monotone" dataKey="avgPnl" name="Avg PnL/Trade" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4, fill: "#f59e0b" }} isAnimationActive={false} />
            <ReferenceLine yAxisId="right" y={0} stroke="#52525b" />
            <Tooltip
              content={({ payload, label }) => {
                if (!payload?.length) return null;
                const p = periods.find((x) => x.label === label);
                return (
                  <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: "#a1a1aa", marginBottom: 4 }}>{label} ({p?.entryDate})</div>
                    {payload.map((item, i) => {
                      const v = typeof item.value === "number" ? item.value : Number(item.value ?? 0);
                      return (
                        <div key={i} style={{ color: item.color }}>
                          {String(item.name)}: {v >= 0 ? "+" : ""}{v.toFixed(2)}%
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Sharpe and Profit Factor over periods */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">Sharpe Ratio & Profit Factor Over Time</h4>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={periods} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 11 }} />
            <YAxis yAxisId="left" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => Number(v).toFixed(1)} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => Number(v).toFixed(2)} />
            <ReferenceLine yAxisId="left" y={0} stroke="#52525b" />
            <ReferenceLine yAxisId="right" y={1} stroke="#52525b" strokeDasharray="3 3" />
            <Bar yAxisId="left" dataKey="sharpe" name="Sharpe" fill="#06b6d4" fillOpacity={0.7} isAnimationActive={false} />
            <Line yAxisId="right" type="monotone" dataKey="profitFactor" name="Profit Factor" stroke="#a78bfa" strokeWidth={2} dot={{ r: 3, fill: "#a78bfa" }} isAnimationActive={false} />
            <Tooltip
              content={({ payload, label }) => {
                if (!payload?.length) return null;
                return (
                  <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: "#a1a1aa", marginBottom: 4 }}>{label}</div>
                    {payload.map((item, i) => {
                      const v = typeof item.value === "number" ? item.value : Number(item.value ?? 0);
                      return (
                        <div key={i} style={{ color: item.color }}>
                          {String(item.name)}: {v.toFixed(2)}
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Interpretation */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-2 text-xs text-zinc-400">
        <h4 className="text-sm font-semibold text-zinc-300">Interpreting Performance Decay</h4>
        <p>
          <strong className="text-zinc-300">Strong decay (r &lt; -0.5):</strong> The strategy's edge is systematically
          eroding over the backtest window. This often means the alpha is being arbitraged away or market conditions
          changed. Consider walk-forward testing and shorter live trading windows.
        </p>
        <p>
          <strong className="text-zinc-300">Stable (|r| &lt; 0.2):</strong> Performance is consistent across periods.
          Normal sampling variation. The edge appears durable.
        </p>
        <p>
          <strong className="text-zinc-300">Note:</strong> These periods are equal in trade count, not calendar time.
          Strategies that trade more in volatile periods may show apparent decay as volatility normalizes.
        </p>
      </div>
    </div>
  );
}
