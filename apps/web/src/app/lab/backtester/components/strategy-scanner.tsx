"use client";

import { useState } from "react";
import { backtestApi, type BacktestResult, type StrategyInfo } from "@/lib/backtest-api";
import { isoDaysAgo } from "./shared";

interface ScanEntry {
  strategy: string;
  result: BacktestResult | null;
  error: string | null;
}

interface StrategyScannerViewProps {
  symbol: string;
  strategies: StrategyInfo[];
  periodDays: number;
  interval: string;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  onSelectStrategy: (name: string) => void;
}

export function StrategyScannerView({
  symbol,
  strategies,
  periodDays,
  interval,
  initialCapital,
  commissionPct,
  slippagePct,
  onSelectStrategy,
}: StrategyScannerViewProps) {
  const [scanResults, setScanResults] = useState<ScanEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [doneCount, setDoneCount] = useState(0);

  async function runScan() {
    if (strategies.length === 0) return;
    setScanning(true);
    setScanResults([]);
    setDoneCount(0);

    const total = strategies.length;
    let done = 0;

    const tasks = strategies.map(async (strat) => {
      // Build default params from schema
      const strategyParams: Record<string, number> = {};
      Object.entries(strat.params_schema).forEach(([k, v]) => {
        strategyParams[k] = typeof v.default === "boolean" ? (v.default ? 1 : 0) : v.default;
      });

      try {
        const result = await backtestApi.run({
          symbol,
          strategy: strat.name,
          start_date: isoDaysAgo(periodDays),
          end_date: isoDaysAgo(0),
          interval,
          initial_capital: initialCapital,
          commission_pct: commissionPct / 100,
          slippage_pct: slippagePct / 100,
          position_size_pct: 1.0,
          strategy_params: strategyParams,
        });
        done++;
        setDoneCount(done);
        return { strategy: strat.name, result, error: null } as ScanEntry;
      } catch (e) {
        done++;
        setDoneCount(done);
        return {
          strategy: strat.name,
          result: null,
          error: e instanceof Error ? e.message : String(e),
        } as ScanEntry;
      }
    });

    const settled = await Promise.allSettled(tasks);
    const entries: ScanEntry[] = settled.map((s, i) =>
      s.status === "fulfilled"
        ? s.value
        : { strategy: strategies[i].name, result: null, error: "Unexpected error" },
    );

    // Sort by total_return_pct descending (errors last)
    entries.sort((a, b) => {
      const ra = a.result?.metrics.total_return_pct ?? -Infinity;
      const rb = b.result?.metrics.total_return_pct ?? -Infinity;
      return rb - ra;
    });

    setScanResults(entries);
    setScanning(false);
  }

  const successCount = scanResults.filter((r) => r.result !== null).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Strategy Scanner</h2>
            <p className="text-sm text-zinc-500 mt-0.5">
              Run all {strategies.length} strategies on <span className="text-zinc-300 font-medium">{symbol}</span>{" "}
              with default parameters and rank by return.
            </p>
          </div>
          <button
            onClick={runScan}
            disabled={scanning || strategies.length === 0}
            className="px-5 py-2.5 rounded-md bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-semibold text-sm transition whitespace-nowrap"
          >
            {scanning ? `Scanning… ${doneCount}/${strategies.length}` : "Scan All Strategies"}
          </button>
        </div>

        {/* Progress bar */}
        {scanning && (
          <div className="mt-4 space-y-2">
            <div className="relative h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
                style={{
                  width: `${strategies.length > 0 ? (doneCount / strategies.length) * 100 : 0}%`,
                  background: "linear-gradient(90deg, #06b6d4, #3b82f6)",
                  boxShadow: "0 0 8px rgba(6,182,212,0.6)",
                }}
              />
            </div>
            <p className="text-xs text-zinc-500">
              {doneCount} of {strategies.length} strategies complete
            </p>
          </div>
        )}
      </div>

      {/* Empty state */}
      {!scanning && scanResults.length === 0 && strategies.length === 0 && (
        <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-lg p-12 text-center">
          <h3 className="text-xl font-medium text-zinc-300 mb-2">No strategies loaded</h3>
          <p className="text-sm text-zinc-500">Strategies will appear once the signal service is connected.</p>
        </div>
      )}

      {!scanning && scanResults.length === 0 && strategies.length > 0 && (
        <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-lg p-12 text-center">
          <h3 className="text-xl font-medium text-zinc-300 mb-2">Find the best strategy</h3>
          <p className="text-sm text-zinc-500 max-w-md mx-auto">
            Runs all {strategies.length} strategies in parallel with their default parameters on{" "}
            {symbol} and ranks them by total return.
          </p>
        </div>
      )}

      {/* Results table */}
      {scanResults.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <h3 className="font-semibold text-zinc-200">
              Results — {successCount} of {scanResults.length} succeeded
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide border-b border-zinc-800">
                  <th className="py-2 px-3">#</th>
                  <th className="py-2 px-3">Strategy</th>
                  <th className="py-2 px-3 text-right">Return %</th>
                  <th className="py-2 px-3 text-right">Sharpe</th>
                  <th className="py-2 px-3 text-right">Sortino</th>
                  <th className="py-2 px-3 text-right">Max DD</th>
                  <th className="py-2 px-3 text-right">Win Rate</th>
                  <th className="py-2 px-3 text-right">Trades</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {scanResults.map((entry, idx) => {
                  const m = entry.result?.metrics;
                  const isTop = idx === 0 && m != null;
                  const isPositive = (m?.total_return_pct ?? 0) >= 0;

                  return (
                    <tr
                      key={entry.strategy}
                      className={`border-b border-zinc-800/60 transition-colors ${
                        isTop
                          ? "bg-amber-500/5 hover:bg-amber-500/10"
                          : "hover:bg-zinc-800/30"
                      }`}
                    >
                      {/* Rank */}
                      <td className="py-2 px-3">
                        {isTop ? (
                          <span className="text-amber-400 font-bold text-xs">1st</span>
                        ) : (
                          <span className="text-zinc-500 text-xs">{idx + 1}</span>
                        )}
                      </td>

                      {/* Strategy name */}
                      <td className="py-2 px-3">
                        <span className={`font-medium ${isTop ? "text-amber-300" : "text-zinc-200"}`}>
                          {entry.strategy}
                        </span>
                      </td>

                      {/* Return */}
                      <td className={`py-2 px-3 text-right font-semibold tabular-nums ${
                        entry.error ? "text-zinc-500" :
                        isPositive ? "text-emerald-400" : "text-red-400"
                      }`}>
                        {entry.error
                          ? <span className="text-xs text-red-500 font-normal">Error</span>
                          : `${isPositive ? "+" : ""}${m!.total_return_pct.toFixed(2)}%`
                        }
                      </td>

                      {/* Sharpe */}
                      <td className="py-2 px-3 text-right text-zinc-300 tabular-nums">
                        {m ? m.sharpe_ratio.toFixed(2) : "—"}
                      </td>

                      {/* Sortino */}
                      <td className="py-2 px-3 text-right text-zinc-300 tabular-nums">
                        {m ? m.sortino_ratio.toFixed(2) : "—"}
                      </td>

                      {/* Max DD */}
                      <td className="py-2 px-3 text-right text-red-400 tabular-nums">
                        {m ? `-${m.max_drawdown_pct.toFixed(1)}%` : "—"}
                      </td>

                      {/* Win Rate */}
                      <td className="py-2 px-3 text-right text-zinc-300 tabular-nums">
                        {m ? `${m.win_rate_pct.toFixed(1)}%` : "—"}
                      </td>

                      {/* Trades */}
                      <td className="py-2 px-3 text-right text-zinc-400 tabular-nums">
                        {m ? m.total_trades : "—"}
                      </td>

                      {/* Actions */}
                      <td className="py-2 px-3 text-right">
                        {!entry.error && (
                          <button
                            onClick={() => onSelectStrategy(entry.strategy)}
                            className="px-2 py-1 rounded text-xs bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/30 transition"
                          >
                            Use This
                          </button>
                        )}
                        {entry.error && (
                          <span className="text-xs text-zinc-600" title={entry.error}>failed</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
