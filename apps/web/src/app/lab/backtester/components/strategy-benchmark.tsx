"use client";

import { useState, useMemo, useCallback } from "react";
import type { BacktestResult, StrategyInfo } from "@/lib/backtest-api";
import { backtestApi } from "@/lib/backtest-api";
import { isoDaysAgo } from "./shared";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface StrategyBenchmarkProps {
  result: BacktestResult;
  symbol: string;
  interval: string;
  periodDays: number;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  positionPct: number;
  strategies: StrategyInfo[];
}

interface MetricRow {
  label: string;
  key: keyof typeof METRIC_KEYS;
  format: (v: number | null | undefined) => string;
  higherIsBetter: boolean;
}

const METRIC_KEYS = {
  total_return_pct: "total_return_pct",
  sharpe_ratio: "sharpe_ratio",
  calmar_ratio: "calmar_ratio",
  max_drawdown_pct: "max_drawdown_pct",
  win_rate_pct: "win_rate_pct",
  profit_factor: "profit_factor",
  total_trades: "total_trades",
} as const;

const METRIC_ROWS: MetricRow[] = [
  {
    label: "Total Return",
    key: "total_return_pct",
    format: (v) => (v != null ? `${v.toFixed(2)}%` : "—"),
    higherIsBetter: true,
  },
  {
    label: "Sharpe Ratio",
    key: "sharpe_ratio",
    format: (v) => (v != null ? v.toFixed(3) : "—"),
    higherIsBetter: true,
  },
  {
    label: "Calmar Ratio",
    key: "calmar_ratio",
    format: (v) => (v != null ? v.toFixed(3) : "—"),
    higherIsBetter: true,
  },
  {
    label: "Max Drawdown",
    key: "max_drawdown_pct",
    format: (v) => (v != null ? `-${v.toFixed(2)}%` : "—"),
    higherIsBetter: false,
  },
  {
    label: "Win Rate",
    key: "win_rate_pct",
    format: (v) => (v != null ? `${v.toFixed(1)}%` : "—"),
    higherIsBetter: true,
  },
  {
    label: "Profit Factor",
    key: "profit_factor",
    format: (v) => (v != null ? v.toFixed(2) : "—"),
    higherIsBetter: true,
  },
  {
    label: "Total Trades",
    key: "total_trades",
    format: (v) => (v != null ? String(Math.round(v)) : "—"),
    higherIsBetter: true,
  },
];

function getMetricValue(
  metrics: BacktestResult["metrics"] | null | undefined,
  key: keyof typeof METRIC_KEYS,
): number | null {
  if (metrics == null) return null;
  const v = metrics[key];
  return v != null ? (v as number) : null;
}

function cellClass(
  value: number | null | undefined,
  values: (number | null | undefined)[],
  higherIsBetter: boolean,
): string {
  if (value == null) return "text-zinc-500";
  const defined = values.filter((v): v is number => v != null);
  if (defined.length < 2) return "text-zinc-200";
  const best = higherIsBetter ? Math.max(...defined) : Math.min(...defined);
  const worst = higherIsBetter ? Math.min(...defined) : Math.max(...defined);
  if (value === best) return "text-cyan-400 font-semibold";
  if (value === worst) return "text-red-400";
  return "text-zinc-300";
}

function buildEquityCurve(
  strategy: BacktestResult | null,
  buyHold: BacktestResult | null,
  comparator: BacktestResult | null,
  initialCapital: number,
) {
  // Align equity curves by index position, normalized to initial capital
  const maxLen = Math.max(
    strategy?.equity_curve.length ?? 0,
    buyHold?.equity_curve.length ?? 0,
    comparator?.equity_curve.length ?? 0,
  );

  if (maxLen === 0) return [];

  return Array.from({ length: maxLen }, (_, i) => {
    const point: Record<string, number | string> = { i: i + 1 };
    if (strategy && i < strategy.equity_curve.length) {
      point.strategy = (strategy.equity_curve[i].equity / initialCapital) * 100 - 100;
    }
    if (buyHold && i < buyHold.equity_curve.length) {
      point.buyHold = (buyHold.equity_curve[i].equity / initialCapital) * 100 - 100;
    }
    if (comparator && i < comparator.equity_curve.length) {
      point.comparator = (comparator.equity_curve[i].equity / initialCapital) * 100 - 100;
    }
    return point;
  });
}

export function StrategyBenchmark({
  result,
  symbol,
  interval,
  periodDays,
  initialCapital,
  commissionPct,
  slippagePct,
  positionPct,
  strategies,
}: StrategyBenchmarkProps) {
  const [selectedStrategy, setSelectedStrategy] = useState<string>(
    strategies.find((s) => s.name !== result.strategy)?.name ?? "",
  );
  const [comparatorResult, setComparatorResult] = useState<BacktestResult | null>(null);
  const [comparatorError, setComparatorError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // Buy-hold: use benchmark from result if available, else a separate field
  const buyHoldResult: BacktestResult | null = useMemo(() => {
    if (result.benchmark) return result.benchmark;
    return null;
  }, [result.benchmark]);

  const buyHoldMetrics = useMemo(
    () => result.benchmark_metrics ?? buyHoldResult?.metrics ?? null,
    [result.benchmark_metrics, buyHoldResult],
  );

  const runBuyHoldIfNeeded = useCallback(async (): Promise<BacktestResult | null> => {
    if (buyHoldResult) return buyHoldResult;
    try {
      return await backtestApi.run({
        symbol,
        strategy: "buy_hold",
        start_date: isoDaysAgo(periodDays),
        interval,
        initial_capital: initialCapital,
        commission_pct: commissionPct,
        slippage_pct: slippagePct,
        position_size_pct: positionPct,
        strategy_params: {},
      });
    } catch {
      return null;
    }
  }, [buyHoldResult, symbol, periodDays, interval, initialCapital, commissionPct, slippagePct, positionPct]);

  const [buyHoldFull, setBuyHoldFull] = useState<BacktestResult | null>(buyHoldResult);

  const handleCompare = useCallback(async () => {
    if (!selectedStrategy) return;
    setIsRunning(true);
    setComparatorError(null);
    try {
      const [comp, bh] = await Promise.all([
        backtestApi.run({
          symbol,
          strategy: selectedStrategy,
          start_date: isoDaysAgo(periodDays),
          interval,
          initial_capital: initialCapital,
          commission_pct: commissionPct,
          slippage_pct: slippagePct,
          position_size_pct: positionPct,
          strategy_params: {},
        }),
        runBuyHoldIfNeeded(),
      ]);
      setComparatorResult(comp);
      if (bh && !buyHoldFull) setBuyHoldFull(bh);
    } catch (e) {
      setComparatorError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRunning(false);
    }
  }, [selectedStrategy, symbol, periodDays, interval, initialCapital, commissionPct, slippagePct, positionPct, runBuyHoldIfNeeded, buyHoldFull]);

  const equityData = useMemo(
    () => buildEquityCurve(result, buyHoldFull, comparatorResult, initialCapital),
    [result, buyHoldFull, comparatorResult, initialCapital],
  );

  const otherStrategies = strategies.filter((s) => s.name !== result.strategy);

  return (
    <div className="space-y-5">
      {/* Strategy picker */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-zinc-500 mb-1 block">Compare against</label>
          <select
            value={selectedStrategy}
            onChange={(e) => setSelectedStrategy(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-sm focus:border-cyan-500 focus:outline-none"
          >
            <option value="">— select a strategy —</option>
            {otherStrategies.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={handleCompare}
          disabled={!selectedStrategy || isRunning}
          className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 text-sm font-semibold rounded-md transition"
        >
          {isRunning ? "Running…" : "Compare"}
        </button>
        {comparatorError && (
          <p className="w-full text-xs text-red-400 mt-1">{comparatorError}</p>
        )}
      </div>

      {/* Comparison table */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h4 className="text-sm font-semibold text-zinc-300">Metric comparison</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500 border-b border-zinc-800">
                <th className="text-left px-4 py-2">Metric</th>
                <th className="text-right px-3 py-2 text-cyan-400">
                  {result.strategy}
                </th>
                <th className="text-right px-3 py-2 text-zinc-400">
                  Buy &amp; Hold
                </th>
                <th className="text-right px-3 py-2 text-orange-400">
                  {comparatorResult ? comparatorResult.strategy : selectedStrategy || "—"}
                </th>
              </tr>
            </thead>
            <tbody>
              {METRIC_ROWS.map((row) => {
                const current = getMetricValue(result.metrics, row.key);
                const bh = getMetricValue(buyHoldMetrics, row.key);
                const comp = getMetricValue(comparatorResult?.metrics, row.key);
                const values = [current, bh, comp];
                return (
                  <tr
                    key={row.key}
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition"
                  >
                    <td className="px-4 py-2 text-zinc-400">{row.label}</td>
                    <td
                      className={`px-3 py-2 text-right ${cellClass(current, values, row.higherIsBetter)}`}
                    >
                      {row.format(current)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right ${
                        buyHoldMetrics
                          ? cellClass(bh, values, row.higherIsBetter)
                          : "text-zinc-600"
                      }`}
                    >
                      {buyHoldMetrics ? row.format(bh) : "—"}
                    </td>
                    <td
                      className={`px-3 py-2 text-right ${
                        comparatorResult
                          ? cellClass(comp, values, row.higherIsBetter)
                          : "text-zinc-600"
                      }`}
                    >
                      {comparatorResult ? row.format(comp) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-[10px] text-zinc-600 border-t border-zinc-800">
          Cyan = best in row · Red = worst in row
        </div>
      </div>

      {/* Equity curves */}
      {equityData.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-3">
            Equity curves (% return from start)
          </h4>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={equityData}
              margin={{ top: 4, right: 8, left: -10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="i" tick={false} />
              <YAxis
                tick={{ fill: "#71717a", fontSize: 10 }}
                tickFormatter={(v) => `${(v as number).toFixed(0)}%`}
              />
              <Tooltip
                contentStyle={{
                  background: "#18181b",
                  border: "1px solid #3f3f46",
                  borderRadius: 6,
                }}
                formatter={(v: number) => [`${v.toFixed(2)}%`]}
                labelFormatter={(label) => `Bar #${label}`}
              />
              <Legend
                formatter={(value) => {
                  if (value === "strategy") return result.strategy;
                  if (value === "buyHold") return "Buy & Hold";
                  if (value === "comparator")
                    return comparatorResult?.strategy ?? selectedStrategy;
                  return value;
                }}
              />
              <Line
                type="monotone"
                dataKey="strategy"
                stroke="#06b6d4"
                strokeWidth={2}
                dot={false}
                name="strategy"
              />
              {buyHoldFull && (
                <Line
                  type="monotone"
                  dataKey="buyHold"
                  stroke="#71717a"
                  strokeWidth={1.5}
                  dot={false}
                  strokeDasharray="4 2"
                  name="buyHold"
                />
              )}
              {comparatorResult && (
                <Line
                  type="monotone"
                  dataKey="comparator"
                  stroke="#f97316"
                  strokeWidth={2}
                  dot={false}
                  name="comparator"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-zinc-600 mt-1">
            Cyan = {result.strategy} · Zinc = Buy &amp; Hold · Orange = {comparatorResult?.strategy ?? "comparator"}
          </p>
        </div>
      )}

      {/* No buy-hold data notice */}
      {!buyHoldMetrics && !buyHoldFull && (
        <div className="text-xs text-zinc-500 bg-zinc-900/30 border border-zinc-800 rounded-lg p-3">
          Buy &amp; Hold benchmark not available in this result. Click &quot;Compare&quot; to fetch it alongside the selected strategy.
        </div>
      )}
    </div>
  );
}
