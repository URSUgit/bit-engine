"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  backtestApi,
  type StrategyInfo,
  type PortfolioResult,
  type PortfolioRunRequest,
} from "@/lib/backtest-api";
import { isoDaysAgo } from "./shared";

// Strategy line colours — one per slot in the portfolio
const STRATEGY_COLORS = [
  "#06b6d4", // cyan
  "#f59e0b", // amber
  "#10b981", // emerald
  "#a78bfa", // violet
  "#f43f5e", // rose
  "#3b82f6", // blue
  "#f97316", // orange
  "#84cc16", // lime
  "#e879f9", // fuchsia
  "#14b8a6", // teal
];

export interface PortfolioViewProps {
  symbol: string;
  strategies: StrategyInfo[];
  periodDays: number;
  interval: string;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
}

interface AllocationEntry {
  id: number;
  strategy: string;
  pct: number;
}

export function PortfolioView({
  symbol,
  strategies,
  periodDays,
  interval,
  initialCapital,
  commissionPct,
  slippagePct,
}: PortfolioViewProps) {
  // Allocation builder state
  const [allocations, setAllocations] = useState<AllocationEntry[]>([
    { id: 1, strategy: strategies[0]?.name ?? "", pct: 50 },
    { id: 2, strategy: strategies[1]?.name ?? "", pct: 50 },
  ]);
  const [nextId, setNextId] = useState(3);
  const [pendingStrategy, setPendingStrategy] = useState(strategies[2]?.name ?? strategies[0]?.name ?? "");
  const [pendingPct, setPendingPct] = useState(0);

  // Run state
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PortfolioResult | null>(null);

  const totalPct = allocations.reduce((s, a) => s + a.pct, 0);
  const totalOk = Math.abs(totalPct - 100) <= 0.1;

  function addAllocation() {
    if (!pendingStrategy || pendingPct <= 0) return;
    setAllocations((prev) => [...prev, { id: nextId, strategy: pendingStrategy, pct: pendingPct }]);
    setNextId((n) => n + 1);
    setPendingPct(0);
  }

  function removeAllocation(id: number) {
    setAllocations((prev) => prev.filter((a) => a.id !== id));
  }

  function updatePct(id: number, pct: number) {
    setAllocations((prev) => prev.map((a) => (a.id === id ? { ...a, pct } : a)));
  }

  function updateStrategy(id: number, strategy: string) {
    setAllocations((prev) => prev.map((a) => (a.id === id ? { ...a, strategy } : a)));
  }

  async function runPortfolio() {
    if (!totalOk) {
      setError(`Allocations must sum to 100% (currently ${totalPct.toFixed(1)}%)`);
      return;
    }
    if (allocations.length < 1) {
      setError("Add at least one allocation");
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const req: PortfolioRunRequest = {
        symbol,
        allocations: allocations.map((a) => ({
          strategy: a.strategy,
          allocation_pct: a.pct,
        })),
        start_date: isoDaysAgo(periodDays),
        end_date: isoDaysAgo(0),
        interval,
        initial_capital: initialCapital,
        commission_pct: commissionPct / 100,
        slippage_pct: slippagePct / 100,
      };
      const r = await backtestApi.portfolioRun(req);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  // ── Allocation builder ────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Builder */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 space-y-4">
        <h2 className="font-semibold text-zinc-100">Portfolio Builder</h2>

        {/* Add row */}
        <div className="flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-[160px]">
            <label className="text-xs text-zinc-500 block mb-1">Strategy</label>
            <select
              value={pendingStrategy}
              onChange={(e) => setPendingStrategy(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm focus:border-cyan-500 focus:outline-none"
            >
              {strategies
                .filter((s) => s.name !== "buy_and_hold")
                .map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="w-28">
            <label className="text-xs text-zinc-500 block mb-1">Allocation %</label>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={pendingPct || ""}
              onChange={(e) => setPendingPct(Number(e.target.value))}
              placeholder="e.g. 33"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <button
            onClick={addAllocation}
            disabled={!pendingStrategy || pendingPct <= 0 || allocations.length >= 10}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 rounded-md text-sm font-medium transition"
          >
            + Add
          </button>
        </div>

        {/* Allocation list */}
        {allocations.length > 0 && (
          <div className="space-y-2">
            {allocations.map((alloc, idx) => {
              const barWidth = Math.min(100, alloc.pct);
              const color = STRATEGY_COLORS[idx % STRATEGY_COLORS.length];
              return (
                <div key={alloc.id} className="flex items-center gap-3">
                  <select
                    value={alloc.strategy}
                    onChange={(e) => updateStrategy(alloc.id, e.target.value)}
                    className="w-36 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs focus:border-cyan-500 focus:outline-none"
                  >
                    {strategies
                      .filter((s) => s.name !== "buy_and_hold")
                      .map((s) => (
                        <option key={s.name} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={alloc.pct}
                    onChange={(e) => updatePct(alloc.id, Number(e.target.value))}
                    className="w-16 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-right focus:border-cyan-500 focus:outline-none"
                  />
                  <span className="text-xs text-zinc-500 w-4">%</span>
                  <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${barWidth}%`, backgroundColor: color }}
                    />
                  </div>
                  <button
                    onClick={() => removeAllocation(alloc.id)}
                    className="text-zinc-500 hover:text-red-400 text-xs transition"
                    title="Remove"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Total indicator */}
        <div className="flex items-center justify-between pt-1 border-t border-zinc-800">
          <span className="text-sm text-zinc-400">
            Total:{" "}
            <span className={totalOk ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold"}>
              {totalPct.toFixed(1)}%
            </span>{" "}
            {totalOk ? "✓" : `(need ${(100 - totalPct).toFixed(1)}% more)`}
          </span>
          <button
            onClick={runPortfolio}
            disabled={running || !totalOk || allocations.length === 0}
            className="px-5 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-semibold rounded-md text-sm transition"
          >
            {running ? "Running…" : "Run Portfolio Backtest"}
          </button>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 p-2 rounded">
            {error}
          </div>
        )}
      </div>

      {/* Results */}
      {running && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-12 text-center text-zinc-400">
          Running {allocations.length} strategies in parallel…
        </div>
      )}

      {result && !running && (
        <PortfolioResults result={result} initialCapital={initialCapital} />
      )}
    </div>
  );
}

// ── Results display ────────────────────────────────────────────────────────────

function PortfolioResults({
  result,
  initialCapital,
}: {
  result: PortfolioResult;
  initialCapital: number;
}) {
  const cm = result.combined_metrics;

  // Build chart data — merge all equity curves into one array keyed by timestamp
  const allTs = Array.from(
    new Set([
      ...result.combined_equity_curve.map((p) => p.t),
      ...result.strategies.flatMap((s) => s.equity_curve.map((p) => p.t)),
    ])
  ).sort((a, b) => a - b);

  // Forward-fill per-strategy values at every combined timestamp
  const strategyMaps = result.strategies.map((s) => {
    const m = new Map(s.equity_curve.map((p) => [p.t, p.equity]));
    return { strategy: s.strategy, m };
  });
  const combinedMap = new Map(result.combined_equity_curve.map((p) => [p.t, p.equity]));

  const chartData = allTs.map((ts) => {
    const point: Record<string, number | string> = {
      date: new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }),
    };
    point["Portfolio"] = combinedMap.get(ts) ?? 0;
    for (const { strategy, m } of strategyMaps) {
      point[strategy] = m.get(ts) ?? 0;
    }
    return point;
  });

  // Correlation matrix display
  const strategyNames = result.strategies.map((s) => s.strategy);

  function corrColor(v: number | null): string {
    if (v === null) return "bg-zinc-800";
    if (v >= 0.8) return "bg-red-900/70";
    if (v >= 0.5) return "bg-orange-900/70";
    if (v >= 0.2) return "bg-yellow-900/70";
    if (v >= -0.2) return "bg-zinc-700";
    return "bg-emerald-900/70";
  }

  function corrTextColor(v: number | null): string {
    if (v === null) return "text-zinc-600";
    if (v >= 0.8) return "text-red-300";
    if (v >= 0.5) return "text-orange-300";
    if (v >= 0.2) return "text-yellow-300";
    if (v >= -0.2) return "text-zinc-300";
    return "text-emerald-300";
  }

  return (
    <div className="space-y-6">
      {/* Combined metrics */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5">
        <h3 className="font-semibold mb-4 text-zinc-100">Combined Portfolio Metrics</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "Total Return",
              value: `${cm.total_return_pct >= 0 ? "+" : ""}${cm.total_return_pct.toFixed(2)}%`,
              color: cm.total_return_pct >= 0 ? "text-emerald-400" : "text-red-400",
            },
            {
              label: "Sharpe Ratio",
              value: cm.sharpe_ratio.toFixed(2),
              color: cm.sharpe_ratio >= 1 ? "text-emerald-400" : cm.sharpe_ratio >= 0 ? "text-zinc-200" : "text-red-400",
            },
            {
              label: "Max Drawdown",
              value: `-${cm.max_drawdown_pct.toFixed(2)}%`,
              color: "text-red-400",
            },
            {
              label: "Final Equity",
              value: `$${cm.final_equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
              color: "text-zinc-100",
            },
            {
              label: "Initial Capital",
              value: `$${cm.initial_capital.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
              color: "text-zinc-400",
            },
            {
              label: "Diversification",
              value: `${(result.diversification_benefit * 100).toFixed(1)}%`,
              color: result.diversification_benefit > 0 ? "text-emerald-400" : "text-zinc-400",
            },
            {
              label: "Strategies",
              value: String(result.strategies.length),
              color: "text-cyan-400",
            },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-zinc-800/60 rounded p-3">
              <div className="text-xs text-zinc-500 mb-1">{label}</div>
              <div className={`text-lg font-semibold ${color}`}>{value}</div>
            </div>
          ))}
        </div>
        {result.diversification_benefit > 0 && (
          <p className="text-xs text-zinc-500 mt-3">
            The portfolio reduces volatility by{" "}
            <span className="text-emerald-400">{(result.diversification_benefit * 100).toFixed(1)}%</span>{" "}
            compared to a weighted average of individual strategy volatilities.
          </p>
        )}
      </div>

      {/* Combined equity chart */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5">
        <h3 className="font-semibold mb-4 text-zinc-100">Equity Curves</h3>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#71717a", fontSize: 11 }}
              interval="preserveStartEnd"
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#71717a", fontSize: 11 }}
              tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, fontSize: 12 }}
              labelStyle={{ color: "#a1a1aa" }}
              formatter={(value: unknown, name: unknown) => [
                `$${(value as number).toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
                name as string,
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {result.strategies.map((s, idx) => (
              <Line
                key={s.strategy}
                type="monotone"
                dataKey={s.strategy}
                stroke={STRATEGY_COLORS[idx % STRATEGY_COLORS.length]}
                strokeWidth={1.5}
                dot={false}
                strokeOpacity={0.8}
              />
            ))}
            <Line
              type="monotone"
              dataKey="Portfolio"
              stroke="#ffffff"
              strokeWidth={2.5}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Correlation matrix */}
      {strategyNames.length >= 2 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5">
          <h3 className="font-semibold mb-1 text-zinc-100">Correlation Matrix</h3>
          <p className="text-xs text-zinc-500 mb-4">
            Green = low correlation (good diversification), Red = high correlation (similar behaviour)
          </p>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="p-1.5 text-zinc-500 text-left font-normal min-w-[80px]"></th>
                  {strategyNames.map((name) => (
                    <th key={name} className="p-1.5 text-zinc-400 font-medium min-w-[80px] text-center">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {strategyNames.map((rowName) => (
                  <tr key={rowName}>
                    <td className="p-1.5 text-zinc-400 font-medium pr-3 text-right">{rowName}</td>
                    {strategyNames.map((colName) => {
                      const v = result.correlation_matrix[rowName]?.[colName] ?? null;
                      return (
                        <td key={colName} className="p-1">
                          <div
                            className={`rounded text-center py-1.5 px-2 ${corrColor(v)} ${corrTextColor(v)} font-mono`}
                          >
                            {v === null ? "—" : v === 1.0 ? "1.00" : v.toFixed(2)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-strategy breakdown table */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800">
          <h3 className="font-semibold text-zinc-100">Per-Strategy Breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide border-b border-zinc-800 bg-zinc-900/40">
                <th className="px-4 py-2">Strategy</th>
                <th className="px-4 py-2 text-right">Allocation</th>
                <th className="px-4 py-2 text-right">Capital</th>
                <th className="px-4 py-2 text-right">Return</th>
                <th className="px-4 py-2 text-right">Sharpe</th>
                <th className="px-4 py-2 text-right">Max DD</th>
                <th className="px-4 py-2 text-right">Trades</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {result.strategies.map((s, idx) => {
                const m = s.metrics;
                const totalReturn = m.total_return_pct ?? 0;
                const sharpe = m.sharpe_ratio ?? 0;
                const maxDD = m.max_drawdown_pct ?? 0;
                const trades = m.total_trades ?? 0;
                const color = STRATEGY_COLORS[idx % STRATEGY_COLORS.length];
                return (
                  <tr key={s.strategy} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
                        <span className="text-zinc-200 font-medium">{s.strategy}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-cyan-400 font-mono">
                      {s.allocation_pct.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-300 font-mono">
                      ${s.allocated_capital.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono ${totalReturn >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {totalReturn >= 0 ? "+" : ""}{totalReturn.toFixed(2)}%
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono ${sharpe >= 1 ? "text-emerald-400" : "text-zinc-300"}`}>
                      {sharpe.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-red-400 font-mono">
                      -{maxDD.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-500 font-mono">
                      {trades}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
