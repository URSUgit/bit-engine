"use client";

import { useState, useCallback } from "react";
import { backtestApi, type StrategyInfo, type Metrics } from "@/lib/backtest-api";
import { isoDaysAgo } from "./shared";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MatrixCell {
  strategy: string;
  symbol: string;
  metrics: Metrics | null;
  error: boolean;
  loading: boolean;
}

type MetricKey = "sharpe_ratio" | "total_return_pct" | "max_drawdown_pct" | "win_rate_pct" | "profit_factor" | "calmar_ratio";

const METRIC_OPTIONS: { key: MetricKey; label: string; higherIsBetter: boolean }[] = [
  { key: "sharpe_ratio", label: "Sharpe", higherIsBetter: true },
  { key: "total_return_pct", label: "Return %", higherIsBetter: true },
  { key: "calmar_ratio", label: "Calmar", higherIsBetter: true },
  { key: "win_rate_pct", label: "Win Rate %", higherIsBetter: true },
  { key: "profit_factor", label: "Profit Factor", higherIsBetter: true },
  { key: "max_drawdown_pct", label: "Max DD %", higherIsBetter: false },
];

const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "ADAUSDT"];

// ── Color helpers ─────────────────────────────────────────────────────────────

function colorize(val: number, min: number, max: number, higherIsBetter: boolean): string {
  if (min === max) return "bg-zinc-800 text-zinc-400";
  const norm = (val - min) / (max - min);
  const score = higherIsBetter ? norm : 1 - norm;

  if (score >= 0.8) return "bg-emerald-700/80 text-emerald-100";
  if (score >= 0.6) return "bg-emerald-800/60 text-emerald-200";
  if (score >= 0.4) return "bg-zinc-700/60 text-zinc-200";
  if (score >= 0.2) return "bg-red-900/50 text-red-200";
  return "bg-red-800/80 text-red-100";
}

function fmt(key: MetricKey, val: number): string {
  switch (key) {
    case "sharpe_ratio": return val.toFixed(2);
    case "calmar_ratio": return val.toFixed(2);
    case "profit_factor": return val.toFixed(2);
    case "total_return_pct": return `${val.toFixed(1)}%`;
    case "win_rate_pct": return `${val.toFixed(0)}%`;
    case "max_drawdown_pct": return `-${val.toFixed(1)}%`;
    default: return val.toFixed(2);
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export interface StrategyMatrixProps {
  strategies: StrategyInfo[];
  interval: string;
  periodDays: number;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  positionPct: number;
  onSelectPair?: (strategy: string, symbol: string) => void;
}

export function StrategyMatrix({
  strategies, interval, periodDays, initialCapital,
  commissionPct, slippagePct, positionPct, onSelectPair,
}: StrategyMatrixProps) {
  const [symbolsInput, setSymbolsInput] = useState(DEFAULT_SYMBOLS.join(", "));
  const [metric, setMetric] = useState<MetricKey>("sharpe_ratio");
  const [cells, setCells] = useState<Map<string, MatrixCell>>(new Map());
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);

  const symbols = symbolsInput.split(",").map((s) => s.trim()).filter(Boolean);
  const activeStrategies = strategies.filter((s) => s.name !== "buy_hold" && s.name !== "oracle_scalper");

  const key = (strategy: string, symbol: string) => `${strategy}::${symbol}`;

  async function runMatrix() {
    if (running) return;
    setRunning(true);
    setCells(new Map());
    setDone(0);

    const startDate = isoDaysAgo(periodDays);
    const endDate = new Date().toISOString().split("T")[0]!;

    const pairs: { strategy: string; symbol: string }[] = [];
    for (const s of activeStrategies) {
      for (const sym of symbols) {
        pairs.push({ strategy: s.name, symbol: sym });
      }
    }
    setTotal(pairs.length);

    // Initialize all cells as loading
    const initialMap = new Map<string, MatrixCell>();
    for (const p of pairs) {
      initialMap.set(key(p.strategy, p.symbol), {
        strategy: p.strategy, symbol: p.symbol,
        metrics: null, error: false, loading: true,
      });
    }
    setCells(new Map(initialMap));

    // Run in batches of 5 concurrent
    const BATCH = 5;
    let completed = 0;

    for (let i = 0; i < pairs.length; i += BATCH) {
      const batch = pairs.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async ({ strategy, symbol }) => {
          try {
            const result = await backtestApi.run({
              symbol,
              strategy,
              start_date: startDate,
              end_date: endDate,
              interval,
              initial_capital: initialCapital,
              commission_pct: commissionPct / 100,
              slippage_pct: slippagePct / 100,
              position_size_pct: positionPct / 100,
              strategy_params: {},
            });
            setCells((prev) => {
              const next = new Map(prev);
              next.set(key(strategy, symbol), {
                strategy, symbol,
                metrics: result.metrics,
                error: false, loading: false,
              });
              return next;
            });
          } catch {
            setCells((prev) => {
              const next = new Map(prev);
              next.set(key(strategy, symbol), {
                strategy, symbol,
                metrics: null,
                error: true, loading: false,
              });
              return next;
            });
          }
          completed++;
          setDone(completed);
        }),
      );
    }

    setRunning(false);
  }

  // Compute min/max for colorization
  const allVals = Array.from(cells.values())
    .filter((c) => c.metrics !== null)
    .map((c) => c.metrics![metric]);
  const minVal = allVals.length ? Math.min(...allVals) : 0;
  const maxVal = allVals.length ? Math.max(...allVals) : 1;

  const metricOpt = METRIC_OPTIONS.find((m) => m.key === metric)!;

  // Find best cell
  const bestCell = allVals.length
    ? Array.from(cells.values()).filter((c) => c.metrics !== null).reduce((best, c) => {
        const cv = c.metrics![metric];
        const bv = best?.metrics?.[metric] ?? (metricOpt.higherIsBetter ? -Infinity : Infinity);
        return metricOpt.higherIsBetter ? (cv > bv ? c : best) : (cv < bv ? c : best);
      }, null as MatrixCell | null)
    : null;

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-zinc-200 mb-3">Strategy × Symbol Matrix</h3>
        <p className="text-xs text-zinc-500 mb-4">
          Run all strategies across multiple symbols simultaneously. Click any cell to deep-dive.
        </p>

        <div className="flex flex-wrap gap-3 mb-4">
          <div className="flex-1 min-w-[280px]">
            <label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
              Symbols (comma-separated)
            </label>
            <input
              value={symbolsInput}
              onChange={(e) => setSymbolsInput(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 focus:border-cyan-500 outline-none"
              placeholder="BTCUSDT, ETHUSDT, SOLUSDT..."
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
              Metric
            </label>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as MetricKey)}
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:border-cyan-500 outline-none"
            >
              {METRIC_OPTIONS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={runMatrix}
              disabled={running || symbols.length === 0}
              className="px-4 py-2 bg-cyan-500 text-zinc-950 rounded-lg text-sm font-bold hover:bg-cyan-400 transition disabled:opacity-60 flex items-center gap-2"
            >
              {running ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin" />
                  {done}/{total}
                </>
              ) : "Run Matrix"}
            </button>
          </div>
        </div>

        {/* Best pair banner */}
        {bestCell && !running && (
          <div
            className="mb-4 bg-cyan-900/20 border border-cyan-700/40 rounded-lg px-4 py-2 flex items-center gap-3 cursor-pointer hover:border-cyan-500/60 transition"
            onClick={() => onSelectPair?.(bestCell.strategy, bestCell.symbol)}
          >
            <span className="text-cyan-400 font-bold text-lg">★</span>
            <div>
              <div className="text-xs text-zinc-400">Best combination by {metricOpt.label}</div>
              <div className="font-semibold text-zinc-100">
                {bestCell.strategy} × {bestCell.symbol}
                <span className="ml-2 text-cyan-300 font-mono">
                  {fmt(metric, bestCell.metrics![metric])}
                </span>
              </div>
            </div>
            <div className="ml-auto text-xs text-cyan-400 hover:underline">Deep dive →</div>
          </div>
        )}

        {/* Matrix grid */}
        {cells.size > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-separate border-spacing-0.5">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left text-zinc-500 font-normal w-36">Strategy</th>
                  {symbols.map((sym) => (
                    <th key={sym} className="px-2 py-1 text-center text-zinc-400 font-mono font-normal">
                      {sym.replace("USDT", "")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeStrategies.map((strat) => (
                  <tr key={strat.name}>
                    <td className="px-2 py-1 text-zinc-400 font-mono text-[11px] whitespace-nowrap pr-3">
                      {strat.name}
                    </td>
                    {symbols.map((sym) => {
                      const c = cells.get(key(strat.name, sym));
                      if (!c || c.loading) {
                        return (
                          <td key={sym} className="px-1 py-0.5">
                            <div className="bg-zinc-800 rounded h-6 w-full animate-pulse" />
                          </td>
                        );
                      }
                      if (c.error || !c.metrics) {
                        return (
                          <td key={sym} className="px-1 py-0.5">
                            <div className="bg-zinc-900/50 border border-zinc-800 rounded h-6 w-full flex items-center justify-center text-zinc-600">
                              —
                            </div>
                          </td>
                        );
                      }
                      const val = c.metrics[metric];
                      const colorClass = colorize(val, minVal, maxVal, metricOpt.higherIsBetter);
                      return (
                        <td
                          key={sym}
                          className="px-1 py-0.5 cursor-pointer"
                          onClick={() => onSelectPair?.(strat.name, sym)}
                          title={`${strat.name} × ${sym}: ${fmt(metric, val)}`}
                        >
                          <div
                            className={`rounded h-6 flex items-center justify-center font-mono font-semibold text-[11px] hover:ring-1 hover:ring-cyan-400 transition ${colorClass}`}
                          >
                            {fmt(metric, val)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {cells.size === 0 && !running && (
          <div className="text-center text-zinc-500 py-12 text-sm">
            Click <strong>Run Matrix</strong> to compare all {activeStrategies.length} strategies across {symbols.length} symbols.
          </div>
        )}

        {/* Legend */}
        {cells.size > 0 && (
          <div className="flex items-center gap-3 mt-3 text-[11px] text-zinc-500">
            <span>Color scale:</span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-emerald-700/80 inline-block" /> Best
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-zinc-700/60 inline-block" /> Mid
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-red-800/80 inline-block" /> Worst
            </span>
            <span className="ml-auto">Click any cell to run full backtest on that pair</span>
          </div>
        )}
      </div>
    </div>
  );
}
