"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import type { BacktestResult } from "@/lib/backtest-api";

export function RiskAnalyticsPanel({ result }: { result: BacktestResult }) {
  const m = result.metrics;

  // ── Section 1: Risk Stats ──────────────────────────────────────────────────
  const var95 = m.var_95 ?? 0;
  const var99 = m.var_99 ?? 0;
  const cvar95 = m.cvar_95 ?? 0;
  const omega = m.omega_ratio ?? 0;
  const ulcer = m.ulcer_index ?? 0;

  const ulcerColor =
    ulcer === 0
      ? "text-zinc-400"
      : ulcer < 5
      ? "text-emerald-400"
      : ulcer < 15
      ? "text-yellow-400"
      : "text-red-400";

  const omegaColor = omega === 0 ? "text-zinc-400" : omega >= 1 ? "text-emerald-400" : "text-red-400";

  // ── Section 2: Return distribution histogram ───────────────────────────────
  const rawReturns = m.daily_returns ?? [];
  const histData = buildHistogram(rawReturns, 20);

  // ── Section 3: Trading activity ────────────────────────────────────────────
  const timeInMarket = m.time_in_market_pct ?? 0;
  const avgBetween = m.avg_bars_between_trades ?? 0;
  const avgDuration = m.avg_trade_duration_bars ?? 0;

  // ── Section 4: Streak analysis ─────────────────────────────────────────────
  const maxWins = m.max_consecutive_wins ?? 0;
  const maxLosses = m.max_consecutive_losses ?? 0;

  return (
    <div className="space-y-6">
      {/* Section 1 — Risk Stats Grid */}
      <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400 mb-4">
          Risk Statistics
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* VaR 95% */}
          <div className="bg-zinc-800/60 rounded-lg p-3 relative group">
            <div className="text-xs text-zinc-500 mb-1">VaR 95%</div>
            {var95 === 0 ? (
              <div className="text-zinc-600 text-sm">—</div>
            ) : (
              <div className="text-red-400 font-mono text-lg font-semibold">
                {var95 < 0 ? "" : "−"}{Math.abs(var95).toFixed(2)}%
              </div>
            )}
            <div className="absolute invisible group-hover:visible bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-zinc-800 border border-zinc-700 rounded p-2 text-xs text-zinc-300 z-10 pointer-events-none">
              5% chance of losing more than this in a single bar
            </div>
          </div>

          {/* CVaR 95% */}
          <div className="bg-zinc-800/60 rounded-lg p-3 relative group">
            <div className="text-xs text-zinc-500 mb-1">CVaR 95%</div>
            {cvar95 === 0 ? (
              <div className="text-zinc-600 text-sm">—</div>
            ) : (
              <div className="text-red-500 font-mono text-lg font-semibold">
                {cvar95 < 0 ? "" : "−"}{Math.abs(cvar95).toFixed(2)}%
              </div>
            )}
            <div className="absolute invisible group-hover:visible bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-zinc-800 border border-zinc-700 rounded p-2 text-xs text-zinc-300 z-10 pointer-events-none">
              Expected loss when the worst 5% scenarios occur (tail risk)
            </div>
          </div>

          {/* Omega Ratio */}
          <div className="bg-zinc-800/60 rounded-lg p-3 relative group">
            <div className="text-xs text-zinc-500 mb-1">Omega Ratio</div>
            {omega === 0 ? (
              <div className="text-zinc-600 text-sm">—</div>
            ) : (
              <div className={`font-mono text-lg font-semibold ${omegaColor}`}>
                {omega >= 999 ? ">999" : omega.toFixed(2)}
              </div>
            )}
            <div className="absolute invisible group-hover:visible bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-zinc-800 border border-zinc-700 rounded p-2 text-xs text-zinc-300 z-10 pointer-events-none">
              Ratio of gains to losses. &gt;1 is profitable; higher is better.
            </div>
          </div>

          {/* Ulcer Index */}
          <div className="bg-zinc-800/60 rounded-lg p-3 relative group">
            <div className="text-xs text-zinc-500 mb-1">Ulcer Index</div>
            {ulcer === 0 ? (
              <div className="text-zinc-600 text-sm">—</div>
            ) : (
              <div className={`font-mono text-lg font-semibold ${ulcerColor}`}>
                {ulcer.toFixed(2)}%
              </div>
            )}
            <div className="absolute invisible group-hover:visible bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-zinc-800 border border-zinc-700 rounded p-2 text-xs text-zinc-300 z-10 pointer-events-none">
              Measures drawdown pain — lower is better. &lt;5%=green, &lt;15%=yellow, &gt;15%=red.
            </div>
          </div>
        </div>

        {/* VaR 99% secondary row */}
        {var99 !== 0 && (
          <div className="mt-3 text-xs text-zinc-500">
            VaR 99%:{" "}
            <span className="text-red-500 font-mono">
              {var99 < 0 ? "" : "−"}{Math.abs(var99).toFixed(2)}%
            </span>
            {" "}· Pain Index:{" "}
            <span className="text-zinc-300 font-mono">{(m.pain_index ?? 0).toFixed(2)}%</span>
          </div>
        )}
      </section>

      {/* Section 2 — Return Distribution Histogram */}
      <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400 mb-4">
          Daily Return Distribution
        </h3>
        {histData.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-zinc-600 text-sm">
            Not enough data to build histogram
          </div>
        ) : (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histData} margin={{ top: 4, right: 8, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#71717a", fontSize: 9 }}
                  interval="preserveStartEnd"
                  angle={-30}
                  textAnchor="end"
                />
                <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={32} />
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, fontSize: 11 }}
                  labelStyle={{ color: "#e4e4e7" }}
                  itemStyle={{ color: "#a1a1aa" }}
                  formatter={(v: number) => [v, "Count"]}
                />
                <ReferenceLine x="0%" stroke="#52525b" strokeDasharray="4 2" />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {histData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.midpoint < 0 ? "#ef4444" : "#22c55e"}
                      fillOpacity={0.8}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Section 3 — Trading Activity */}
      <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400 mb-4">
          Trading Activity
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-zinc-800/60 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">Time in Market</div>
            <div className="font-mono text-lg font-semibold text-zinc-200">
              {timeInMarket > 0 ? `${timeInMarket.toFixed(1)}%` : "—"}
            </div>
          </div>
          <div className="bg-zinc-800/60 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">Avg Bars Between Trades</div>
            <div className="font-mono text-lg font-semibold text-zinc-200">
              {avgBetween > 0 ? avgBetween.toFixed(1) : "—"}
            </div>
          </div>
          <div className="bg-zinc-800/60 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">Avg Trade Duration</div>
            <div className="font-mono text-lg font-semibold text-zinc-200">
              {avgDuration > 0 ? `${avgDuration.toFixed(1)} bars` : "—"}
            </div>
          </div>
        </div>
      </section>

      {/* Section 4 — Streak Analysis */}
      <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400 mb-4">
          Streak Analysis
        </h3>
        {maxWins === 0 && maxLosses === 0 ? (
          <div className="text-zinc-600 text-sm">No trade streak data available.</div>
        ) : (
          <div className="space-y-4">
            {/* Win streak */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>Longest win streak</span>
                <span className="text-emerald-400 font-semibold">{maxWins} trades</span>
              </div>
              <div className="flex gap-1 flex-wrap">
                {Array.from({ length: Math.min(maxWins, 10) }).map((_, i) => (
                  <div
                    key={i}
                    className="w-5 h-5 rounded-full bg-emerald-500/80 border border-emerald-400/50 flex items-center justify-center"
                    title={`Win ${i + 1}`}
                  />
                ))}
                {maxWins > 10 && (
                  <div className="w-5 h-5 rounded-full bg-zinc-700 border border-zinc-600 flex items-center justify-center text-[9px] text-zinc-400">
                    +{maxWins - 10}
                  </div>
                )}
              </div>
            </div>

            {/* Loss streak */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>Longest loss streak</span>
                <span className="text-red-400 font-semibold">{maxLosses} trades</span>
              </div>
              <div className="flex gap-1 flex-wrap">
                {Array.from({ length: Math.min(maxLosses, 10) }).map((_, i) => (
                  <div
                    key={i}
                    className="w-5 h-5 rounded-full bg-red-500/80 border border-red-400/50 flex items-center justify-center"
                    title={`Loss ${i + 1}`}
                  />
                ))}
                {maxLosses > 10 && (
                  <div className="w-5 h-5 rounded-full bg-zinc-700 border border-zinc-600 flex items-center justify-center text-[9px] text-zinc-400">
                    +{maxLosses - 10}
                  </div>
                )}
              </div>
            </div>

            <div className="text-xs text-zinc-500 border-t border-zinc-800 pt-3">
              Longest win streak: <span className="text-emerald-400">{maxWins} trades</span>
              {" "}|{" "}
              Longest loss streak: <span className="text-red-400">{maxLosses} trades</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Histogram builder ──────────────────────────────────────────────────────────

type HistBucket = { label: string; count: number; midpoint: number };

function buildHistogram(returns: number[], buckets: number): HistBucket[] {
  if (returns.length === 0) return [];

  const min = Math.min(...returns);
  const max = Math.max(...returns);
  if (min === max) return [];

  const width = (max - min) / buckets;
  const hist: HistBucket[] = Array.from({ length: buckets }, (_, i) => {
    const lo = min + i * width;
    const hi = lo + width;
    const mid = (lo + hi) / 2;
    const label = `${(mid * 100).toFixed(1)}%`;
    return { label, count: 0, midpoint: mid };
  });

  for (const r of returns) {
    const idx = Math.min(Math.floor((r - min) / width), buckets - 1);
    hist[idx].count++;
  }

  return hist;
}
