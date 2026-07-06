"use client";

import { useState } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

interface RegimeStat {
  regime: string;
  bar_count: number;
  bar_pct: number;
  trade_count: number;
  win_rate: number;
  avg_pnl_pct: number;
  total_pnl: number;
  best_trade_pct: number;
  worst_trade_pct: number;
}

interface RegimeResult {
  stats: RegimeStat[];
  dominant_regime: string;
  best_regime: string;
  insight: string;
}

interface RegimeAnalysisProps {
  symbol: string;
  strategy: string;
  strategyParams: Record<string, number>;
  interval: string;
  periodDays: number;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  positionPct: number;
}

const REGIME_COLORS: Record<string, string> = {
  bull_trend: "#4ade80",
  bear_trend: "#f87171",
  ranging: "#facc15",
  high_vol: "#fb923c",
  low_vol: "#60a5fa",
};

const REGIME_LABELS: Record<string, string> = {
  bull_trend: "Bull Trend",
  bear_trend: "Bear Trend",
  ranging: "Ranging",
  high_vol: "High Volatility",
  low_vol: "Low Volatility",
};

function RegimeBadge({ regime }: { regime: string }) {
  const color = REGIME_COLORS[regime] ?? "#a1a1aa";
  const label = REGIME_LABELS[regime] ?? regime;
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: color + "22", color, border: `1px solid ${color}44` }}
    >
      {label}
    </span>
  );
}

export function RegimeAnalysis({
  symbol, strategy, strategyParams, interval, periodDays,
  initialCapital, commissionPct, slippagePct, positionPct,
}: RegimeAnalysisProps) {
  const [result, setResult] = useState<RegimeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/backtest/regime_analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          strategy,
          interval,
          period_days: periodDays,
          initial_capital: initialCapital,
          commission_pct: commissionPct / 100,
          slippage_pct: slippagePct / 100,
          position_size_pct: positionPct / 100,
          strategy_params: strategyParams,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(d.detail ?? res.statusText);
      }
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const pieData = result?.stats
    .filter((s) => s.bar_count > 0)
    .map((s) => ({ name: REGIME_LABELS[s.regime] ?? s.regime, value: s.bar_pct, regime: s.regime })) ?? [];

  const barData = result?.stats
    .filter((s) => s.trade_count > 0)
    .sort((a, b) => b.total_pnl - a.total_pnl)
    .map((s) => ({ name: REGIME_LABELS[s.regime] ?? s.regime, total_pnl: s.total_pnl, regime: s.regime })) ?? [];

  return (
    <div className="space-y-4">
      {/* Header + run button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Market Regime Analysis</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Classifies each bar as Bull/Bear/Ranging/High-Vol/Low-Vol using ADX + EMA slope + ATR
          </p>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="px-4 py-2 rounded-md text-sm font-medium bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50 transition"
        >
          {loading ? "Analysing…" : "Run Regime Analysis"}
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 p-3 rounded">
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-3 animate-pulse">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-zinc-800/50 rounded-lg" />
          ))}
        </div>
      )}

      {result && !loading && (
        <>
          {/* Insight banner */}
          <div className="bg-cyan-950/30 border border-cyan-900/50 rounded-lg p-3 flex items-start gap-2">
            <span className="text-cyan-400 mt-0.5">◈</span>
            <p className="text-sm text-cyan-200">{result.insight}</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Pie: bar distribution */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <h4 className="text-sm font-medium text-zinc-300 mb-3">Bar Distribution</h4>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, value }) => `${name} ${value.toFixed(1)}%`} labelLine={false}>
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={REGIME_COLORS[entry.regime] ?? "#a1a1aa"} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
                    formatter={(v) => [typeof v === "number" ? `${v.toFixed(1)}%` : String(v), "Bars"]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Bar: P&L per regime */}
            {barData.length > 0 && (
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
                <h4 className="text-sm font-medium text-zinc-300 mb-3">Total P&L by Regime</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={barData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#52525b" />
                    <YAxis tick={{ fontSize: 10 }} stroke="#52525b" tickFormatter={(v) => `$${v.toFixed(0)}`} />
                    <Tooltip
                      contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
                      formatter={(v) => [typeof v === "number" ? `$${v.toFixed(2)}` : String(v), "P&L"]}
                    />
                    <Bar dataKey="total_pnl" radius={[3, 3, 0, 0]}>
                      {barData.map((entry, i) => (
                        <Cell key={i} fill={entry.total_pnl >= 0 ? (REGIME_COLORS[entry.regime] ?? "#4ade80") : "#f87171"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Per-regime stats table */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/70">
                  <th className="text-left px-4 py-2 text-zinc-400 font-medium">Regime</th>
                  <th className="text-right px-4 py-2 text-zinc-400 font-medium">Bars</th>
                  <th className="text-right px-4 py-2 text-zinc-400 font-medium">Trades</th>
                  <th className="text-right px-4 py-2 text-zinc-400 font-medium">Win Rate</th>
                  <th className="text-right px-4 py-2 text-zinc-400 font-medium">Avg P&L %</th>
                  <th className="text-right px-4 py-2 text-zinc-400 font-medium">Total P&L</th>
                  <th className="text-right px-4 py-2 text-zinc-400 font-medium">Best / Worst</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {result.stats
                  .sort((a, b) => b.bar_count - a.bar_count)
                  .map((s) => (
                    <tr
                      key={s.regime}
                      className={`hover:bg-zinc-800/30 transition ${s.regime === result.best_regime ? "bg-zinc-800/20" : ""}`}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <RegimeBadge regime={s.regime} />
                          {s.regime === result.best_regime && (
                            <span className="text-xs text-cyan-400">★ Best</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-300">
                        {s.bar_count} <span className="text-zinc-500">({s.bar_pct.toFixed(1)}%)</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{s.trade_count}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${s.win_rate >= 55 ? "text-green-400" : s.win_rate >= 45 ? "text-yellow-400" : "text-red-400"}`}>
                        {s.trade_count > 0 ? `${s.win_rate.toFixed(1)}%` : "—"}
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${s.avg_pnl_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {s.trade_count > 0 ? `${s.avg_pnl_pct >= 0 ? "+" : ""}${s.avg_pnl_pct.toFixed(2)}%` : "—"}
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${s.total_pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {s.trade_count > 0 ? `$${s.total_pnl.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                        {s.trade_count > 0 ? (
                          <>
                            <span className="text-green-400">+{s.best_trade_pct.toFixed(1)}%</span>
                            {" / "}
                            <span className="text-red-400">{s.worst_trade_pct.toFixed(1)}%</span>
                          </>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!result && !loading && !error && (
        <div className="h-48 flex items-center justify-center text-zinc-500 text-sm border border-dashed border-zinc-800 rounded-lg">
          Click &ldquo;Run Regime Analysis&rdquo; to classify market conditions and see per-regime performance.
        </div>
      )}
    </div>
  );
}
