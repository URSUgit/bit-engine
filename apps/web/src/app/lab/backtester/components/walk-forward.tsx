"use client";

import { useState } from "react";
import { backtestApi, type WalkForwardFold, type WalkForwardResult } from "@/lib/backtest-api";
import { isoDaysAgo } from "./shared";

export interface WalkForwardPanelProps {
  symbol: string;
  strategy: string;
  strategyParams: Record<string, number>;
  periodDays: number;
  interval: string;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  positionPct: number;
}

// Color for a fold's out-of-sample Sharpe relative to its in-sample Sharpe
function foldSharpeColor(outSharpe: number, inSharpe: number): string {
  if (inSharpe <= 0) return "text-zinc-400";
  const ratio = outSharpe / inSharpe;
  if (ratio >= 0.7) return "text-emerald-400";
  if (ratio >= 0.5) return "text-yellow-400";
  return "text-red-400";
}

function degradationBadge(ratio: number): { label: string; className: string } {
  if (ratio >= 0.7) {
    return { label: "Good", className: "bg-emerald-900/40 text-emerald-300 border border-emerald-700" };
  }
  if (ratio >= 0.5) {
    return { label: "OK", className: "bg-yellow-900/40 text-yellow-300 border border-yellow-700" };
  }
  return { label: "Overfit risk", className: "bg-red-900/40 text-red-300 border border-red-700" };
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function WalkForwardPanel({
  symbol,
  strategy,
  strategyParams,
  periodDays,
  interval,
  initialCapital,
  commissionPct,
  slippagePct,
  positionPct,
}: WalkForwardPanelProps) {
  const [result, setResult] = useState<WalkForwardResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nSplits, setNSplits] = useState(5);
  const [trainPct, setTrainPct] = useState(0.7);
  const [anchored, setAnchored] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await backtestApi.walkForward({
        symbol,
        strategy,
        strategy_params: strategyParams,
        start_date: isoDaysAgo(periodDays),
        end_date: isoDaysAgo(0),
        interval,
        initial_capital: initialCapital,
        commission_pct: commissionPct / 100,
        slippage_pct: slippagePct / 100,
        position_size_pct: positionPct / 100,
        n_splits: nSplits,
        train_pct: trainPct,
        anchored,
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const badge = result ? degradationBadge(result.degradation_ratio) : null;
  const profitableFolds = result
    ? result.folds.filter((f) => f.out_sample_return > 0).length
    : 0;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-semibold text-zinc-100">Walk-Forward Validation</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Tests whether your strategy&apos;s edge generalises out-of-sample or is curve-fitted.
          </p>
        </div>

        {/* Config controls */}
        <div className="flex items-center gap-4 flex-wrap text-xs text-zinc-400">
          <label className="flex items-center gap-1.5">
            Folds
            <select
              value={nSplits}
              onChange={(e) => setNSplits(Number(e.target.value))}
              className="ml-1 px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-zinc-200 focus:outline-none"
            >
              {[2, 3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            Train %
            <select
              value={trainPct}
              onChange={(e) => setTrainPct(Number(e.target.value))}
              className="ml-1 px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-zinc-200 focus:outline-none"
            >
              {[0.5, 0.6, 0.7, 0.75, 0.8, 0.9].map((v) => (
                <option key={v} value={v}>{Math.round(v * 100)}%</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={anchored}
              onChange={(e) => setAnchored(e.target.checked)}
              className="accent-cyan-500 w-3.5 h-3.5"
            />
            Anchored
          </label>
        </div>
      </div>

      {/* Run button */}
      <button
        onClick={run}
        disabled={loading}
        className="w-full py-2.5 rounded-md bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-semibold text-sm transition"
      >
        {loading
          ? `Running ${nSplits} folds…`
          : "Run Walk-Forward Validation"}
      </button>

      {error && (
        <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 p-2 rounded">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Summary row */}
          <div className="flex flex-wrap items-center gap-3 bg-zinc-950 border border-zinc-800 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <span className="text-zinc-400 text-sm">Degradation ratio:</span>
              <span className="font-bold text-zinc-100 text-base">
                {result.degradation_ratio.toFixed(2)}
              </span>
              {badge && (
                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${badge.className}`}>
                  {badge.label}
                </span>
              )}
            </div>
            <div className="text-zinc-500 text-xs hidden sm:block">·</div>
            <div className="text-sm text-zinc-400">
              Consistency:{" "}
              <span className={`font-semibold ${profitableFolds >= result.folds.length * 0.6 ? "text-emerald-400" : "text-yellow-400"}`}>
                {profitableFolds}/{result.folds.length} folds profitable
              </span>
            </div>
            {result.overfitting_warning && (
              <div className="text-xs text-red-400 bg-red-950/30 border border-red-900 px-2 py-1 rounded ml-auto">
                Overfitting warning — out-of-sample Sharpe degraded by {Math.round((1 - result.degradation_ratio) * 100)}%
              </div>
            )}
          </div>

          {/* Avg summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Avg in-sample Sharpe", value: result.avg_in_sample_sharpe.toFixed(2), positive: result.avg_in_sample_sharpe >= 0 },
              { label: "Avg out-of-sample Sharpe", value: result.avg_out_sample_sharpe.toFixed(2), positive: result.avg_out_sample_sharpe >= 0 },
              { label: "Avg in-sample Return", value: fmtPct(result.avg_in_sample_return), positive: result.avg_in_sample_return >= 0 },
              { label: "Avg out-of-sample Return", value: fmtPct(result.avg_out_sample_return), positive: result.avg_out_sample_return >= 0 },
            ].map(({ label, value, positive }) => (
              <div key={label} className="bg-zinc-950 border border-zinc-800 rounded p-3">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
                <div className={`text-lg font-semibold mt-1 ${positive ? "text-emerald-400" : "text-red-400"}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* Fold table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide border-b border-zinc-800">
                  <th className="py-2 pr-4">Fold</th>
                  <th className="py-2 pr-4">Train period</th>
                  <th className="py-2 pr-4">Test period</th>
                  <th className="py-2 pr-4 text-right">In Sharpe</th>
                  <th className="py-2 pr-4 text-right">Out Sharpe</th>
                  <th className="py-2 pr-4 text-right">In Return</th>
                  <th className="py-2 pr-4 text-right">Out Return</th>
                  <th className="py-2 text-right">Trades (in/out)</th>
                </tr>
              </thead>
              <tbody>
                {result.folds.map((fold: WalkForwardFold) => {
                  const sharpeColor = foldSharpeColor(fold.out_sample_sharpe, fold.in_sample_sharpe);
                  return (
                    <tr key={fold.fold} className="border-b border-zinc-800/50 hover:bg-zinc-800/20">
                      <td className="py-2 pr-4 text-zinc-400 font-mono">#{fold.fold}</td>
                      <td className="py-2 pr-4 text-zinc-500 text-xs">
                        {fold.train_start} → {fold.train_end}
                      </td>
                      <td className="py-2 pr-4 text-zinc-500 text-xs">
                        {fold.test_start} → {fold.test_end}
                      </td>
                      <td className="py-2 pr-4 text-right text-zinc-300 font-mono">
                        {fold.in_sample_sharpe.toFixed(2)}
                      </td>
                      <td className={`py-2 pr-4 text-right font-mono font-semibold ${sharpeColor}`}>
                        {fold.out_sample_sharpe.toFixed(2)}
                      </td>
                      <td className={`py-2 pr-4 text-right font-mono ${fold.in_sample_return >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {fmtPct(fold.in_sample_return)}
                      </td>
                      <td className={`py-2 pr-4 text-right font-mono ${fold.out_sample_return >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {fmtPct(fold.out_sample_return)}
                      </td>
                      <td className="py-2 text-right text-zinc-500 text-xs">
                        {fold.in_sample_trades} / {fold.out_sample_trades}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="text-xs text-zinc-600 flex gap-4 flex-wrap border-t border-zinc-800/50 pt-2">
            <span>Out Sharpe color: <span className="text-emerald-400">green</span> = ≥ 70% of in-sample · <span className="text-yellow-400">yellow</span> = ≥ 50% · <span className="text-red-400">red</span> = below 50%</span>
            <span>Degradation ratio = avg out-of-sample Sharpe / avg in-sample Sharpe</span>
          </div>
        </div>
      )}
    </div>
  );
}
