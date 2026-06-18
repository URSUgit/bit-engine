"use client";

import { useState } from "react";
import { backtestApi, type BacktestResult } from "@/lib/backtest-api";
import { isoDaysAgo } from "./shared";

// ── Types ─────────────────────────────────────────────────────────────────────

type TFResult = {
  interval: string;
  status: "idle" | "running" | "done" | "error";
  result: BacktestResult | null;
  error: string | null;
  ms: number;
};

const INTERVALS_TO_TEST = ["1m", "5m", "15m", "1h", "4h", "1d"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number, decimals = 2) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`;
}

function colorRet(v: number) {
  return v > 10 ? "text-emerald-300" : v > 0 ? "text-emerald-400" : "text-red-400";
}

function colorSharpe(v: number) {
  return v >= 1.5 ? "text-emerald-300" : v >= 0.8 ? "text-emerald-400" : v >= 0 ? "text-yellow-400" : "text-red-400";
}

function colorDD(v: number) {
  return v < 5 ? "text-emerald-400" : v < 15 ? "text-yellow-400" : "text-red-400";
}

function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 80 ? "bg-emerald-900/60 text-emerald-300 border-emerald-700" :
    score >= 60 ? "bg-yellow-900/60 text-yellow-300 border-yellow-700" :
    score >= 40 ? "bg-orange-900/60 text-orange-300 border-orange-700" :
    "bg-zinc-800 text-zinc-500 border-zinc-700";
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${cls}`}>
      {score}
    </span>
  );
}

function scoreResult(m: BacktestResult["metrics"]): number {
  let s = 0;
  if (m.sharpe_ratio >= 1) s += 20;
  if (m.sharpe_ratio >= 2) s += 10;
  if (m.total_return_pct > 20) s += 20;
  if (m.max_drawdown_pct < 15) s += 15;
  if (m.win_rate_pct > 55) s += 15;
  if (m.profit_factor > 1.5) s += 20;
  return s;
}

function StatusDot({ status }: { status: TFResult["status"] }) {
  if (status === "running") return <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />;
  if (status === "done")    return <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />;
  if (status === "error")   return <span className="inline-block w-2 h-2 rounded-full bg-red-400" />;
  return <span className="inline-block w-2 h-2 rounded-full bg-zinc-700" />;
}

// ── Main component ────────────────────────────────────────────────────────────

interface MultiTimeframeProps {
  symbol: string;
  strategy: string;
  strategyParams: Record<string, number>;
  periodDays: number;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  positionPct: number;
}

export function MultiTimeframePanel({
  symbol, strategy, strategyParams, periodDays,
  initialCapital, commissionPct, slippagePct, positionPct,
}: MultiTimeframeProps) {
  const [results, setResults] = useState<TFResult[]>(
    INTERVALS_TO_TEST.map((interval) => ({ interval, status: "idle", result: null, error: null, ms: 0 }))
  );
  const [running, setRunning] = useState(false);
  const [sortBy, setSortBy] = useState<"interval" | "return" | "sharpe" | "score">("score");

  async function runAll() {
    setRunning(true);
    setResults(INTERVALS_TO_TEST.map((interval) => ({ interval, status: "idle", result: null, error: null, ms: 0 })));

    const startDate = isoDaysAgo(periodDays);

    await Promise.all(
      INTERVALS_TO_TEST.map(async (interval) => {
        setResults((prev) => prev.map((r) => r.interval === interval ? { ...r, status: "running" } : r));
        const t0 = Date.now();
        try {
          const res = await backtestApi.run({
            symbol,
            strategy,
            start_date: startDate,
            interval,
            initial_capital: initialCapital,
            commission_pct: commissionPct,
            slippage_pct: slippagePct,
            position_size_pct: positionPct,
            strategy_params: strategyParams,
          });
          setResults((prev) => prev.map((r) =>
            r.interval === interval ? { interval, status: "done", result: res, error: null, ms: Date.now() - t0 } : r
          ));
        } catch (e) {
          setResults((prev) => prev.map((r) =>
            r.interval === interval ? { interval, status: "error", result: null, error: String(e), ms: Date.now() - t0 } : r
          ));
        }
      })
    );
    setRunning(false);
  }

  const sorted = [...results].sort((a, b) => {
    if (sortBy === "interval") return INTERVALS_TO_TEST.indexOf(a.interval) - INTERVALS_TO_TEST.indexOf(b.interval);
    if (!a.result && !b.result) return 0;
    if (!a.result) return 1;
    if (!b.result) return -1;
    if (sortBy === "return") return b.result.metrics.total_return_pct - a.result.metrics.total_return_pct;
    if (sortBy === "sharpe") return b.result.metrics.sharpe_ratio - a.result.metrics.sharpe_ratio;
    return scoreResult(b.result.metrics) - scoreResult(a.result.metrics);
  });

  const doneCount = results.filter((r) => r.status === "done").length;
  const bestInterval = results
    .filter((r) => r.result)
    .sort((a, b) => scoreResult(b.result!.metrics) - scoreResult(a.result!.metrics))[0]?.interval;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-semibold text-zinc-100">Multi-Timeframe Analysis</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Run <span className="text-zinc-300">{strategy}</span> on <span className="text-zinc-300">{symbol}</span> across all intervals simultaneously
          </p>
        </div>
        <div className="flex items-center gap-2">
          {doneCount > 0 && (
            <span className="text-xs text-zinc-500">{doneCount}/{INTERVALS_TO_TEST.length} done</span>
          )}
          <button
            onClick={runAll}
            disabled={running}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
              running
                ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                : "bg-cyan-600 hover:bg-cyan-500 text-white"
            }`}
          >
            {running ? "Running…" : doneCount > 0 ? "Re-run All" : "Run All Timeframes"}
          </button>
        </div>
      </div>

      {/* Progress row */}
      {(running || doneCount > 0) && (
        <div className="flex gap-2 flex-wrap">
          {results.map((r) => (
            <div key={r.interval} className="flex items-center gap-1.5 bg-zinc-800/50 px-2.5 py-1 rounded border border-zinc-700/50">
              <StatusDot status={r.status} />
              <span className="text-xs font-mono text-zinc-300">{r.interval}</span>
              {r.status === "done" && r.result && (
                <span className={`text-[11px] font-semibold ${colorRet(r.result.metrics.total_return_pct)}`}>
                  {fmt(r.result.metrics.total_return_pct)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Best timeframe banner */}
      {bestInterval && !running && (
        <div className="flex items-center gap-2 bg-cyan-950/30 border border-cyan-800/50 rounded-lg px-3 py-2">
          <span className="text-cyan-300 text-sm">Best timeframe:</span>
          <span className="font-bold text-cyan-200">{bestInterval}</span>
          {results.find((r) => r.interval === bestInterval)?.result && (
            <span className="text-xs text-zinc-400 ml-1">
              (score {scoreResult(results.find((r) => r.interval === bestInterval)!.result!.metrics)}/100)
            </span>
          )}
        </div>
      )}

      {/* Results table */}
      {doneCount > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500 text-[10px] uppercase tracking-wide border-b border-zinc-800">
                {[
                  { key: "interval", label: "TF" },
                  { key: "score", label: "Score" },
                  { key: "return", label: "Return" },
                  { key: "sharpe", label: "Sharpe" },
                  { key: null, label: "Sortino" },
                  { key: null, label: "Calmar" },
                  { key: null, label: "Max DD" },
                  { key: null, label: "Win Rate" },
                  { key: null, label: "Trades" },
                  { key: null, label: "Avg Dur" },
                  { key: null, label: "Runtime" },
                ].map(({ key, label }) => (
                  <th
                    key={label}
                    onClick={() => key && setSortBy(key as typeof sortBy)}
                    className={`px-3 py-2 text-left font-medium ${key ? "cursor-pointer hover:text-zinc-300" : ""} ${key && sortBy === key ? "text-cyan-400" : ""}`}
                  >
                    {label}{key && sortBy === key ? " ▼" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                if (r.status === "idle") return null;
                return (
                  <tr key={r.interval} className={`border-b border-zinc-800/50 hover:bg-zinc-800/20 transition ${r.interval === bestInterval ? "bg-cyan-950/20" : ""}`}>
                    <td className="px-3 py-2.5 font-mono font-bold text-zinc-200">
                      <div className="flex items-center gap-1.5">
                        {r.interval === bestInterval && <span className="text-yellow-400">★</span>}
                        {r.interval}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {r.result ? <ScoreBadge score={scoreResult(r.result.metrics)} /> : r.status === "running" ? <span className="text-zinc-600">…</span> : <span className="text-red-400 text-[10px]">err</span>}
                    </td>
                    <td className={`px-3 py-2.5 font-semibold ${r.result ? colorRet(r.result.metrics.total_return_pct) : "text-zinc-600"}`}>
                      {r.result ? fmt(r.result.metrics.total_return_pct) : r.error ? "—" : "…"}
                    </td>
                    <td className={`px-3 py-2.5 ${r.result ? colorSharpe(r.result.metrics.sharpe_ratio) : "text-zinc-600"}`}>
                      {r.result ? r.result.metrics.sharpe_ratio.toFixed(2) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-300">
                      {r.result ? r.result.metrics.sortino_ratio.toFixed(2) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-300">
                      {r.result ? r.result.metrics.calmar_ratio.toFixed(2) : "—"}
                    </td>
                    <td className={`px-3 py-2.5 ${r.result ? colorDD(r.result.metrics.max_drawdown_pct) : "text-zinc-600"}`}>
                      {r.result ? `-${r.result.metrics.max_drawdown_pct.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-300">
                      {r.result ? `${r.result.metrics.win_rate_pct.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-400">
                      {r.result ? r.result.metrics.total_trades : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-500">
                      {r.result ? `${r.result.metrics.avg_trade_duration_bars.toFixed(1)}b` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-600 text-[10px]">
                      {r.ms > 0 ? `${r.ms}ms` : "—"}
                      {r.error && <span className="text-red-400 text-[10px] ml-1" title={r.error}>⚠</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Radar-style summary when all done */}
      {doneCount === INTERVALS_TO_TEST.length && (
        <div className="pt-2 border-t border-zinc-800">
          <div className="text-[10px] uppercase tracking-wide text-zinc-600 mb-2">Timeframe Radar Summary</div>
          <div className="grid grid-cols-6 gap-1">
            {INTERVALS_TO_TEST.map((tf) => {
              const r = results.find((x) => x.interval === tf);
              const score = r?.result ? scoreResult(r.result.metrics) : 0;
              const pct = score / 100;
              return (
                <div key={tf} className="flex flex-col items-center gap-1">
                  <div className="relative w-10 h-10">
                    <svg viewBox="0 0 40 40" className="w-full h-full">
                      <circle cx="20" cy="20" r="18" fill="none" stroke="#27272a" strokeWidth="3" />
                      <circle
                        cx="20" cy="20" r="18"
                        fill="none"
                        stroke={pct >= 0.7 ? "#4ade80" : pct >= 0.4 ? "#facc15" : "#f87171"}
                        strokeWidth="3"
                        strokeDasharray={`${pct * 113} 113`}
                        strokeLinecap="round"
                        transform="rotate(-90 20 20)"
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-zinc-300">
                      {score}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-400">{tf}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
