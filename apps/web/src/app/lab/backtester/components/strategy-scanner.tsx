"use client";

import { useState } from "react";
import { backtestApi, type BacktestResult, type StrategyInfo } from "@/lib/backtest-api";
import { isoDaysAgo } from "./shared";

interface ScanEntry {
  strategy: string;
  result: BacktestResult | null;
  error: string | null;
}

type SortKey = "return" | "sharpe" | "sortino" | "calmar" | "recovery" | "sqn" | "maxdd" | "winrate" | "trades";

interface StrategyScannerViewProps {
  symbol: string;
  strategies: StrategyInfo[];
  periodDays: number;
  interval: string;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  positionPct: number;
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
  positionPct,
  onSelectStrategy,
}: StrategyScannerViewProps) {
  const [scanResults, setScanResults] = useState<ScanEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("sharpe");
  const [sortAsc, setSortAsc] = useState(false);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(false); }
  }

  function sortValue(entry: ScanEntry): number {
    const m = entry.result?.metrics;
    if (!m) return sortAsc ? Infinity : -Infinity;
    switch (sortKey) {
      case "return":   return m.total_return_pct;
      case "sharpe":   return m.sharpe_ratio;
      case "sortino":  return m.sortino_ratio;
      case "calmar":   return m.calmar_ratio;
      case "recovery": return m.recovery_factor ?? 0;
      case "sqn":      return m.sqn ?? 0;
      case "maxdd":    return -m.max_drawdown_pct;  // less dd = better, so negate
      case "winrate":  return m.win_rate_pct;
      case "trades":   return m.total_trades;
      default: return 0;
    }
  }

  const sorted = [...scanResults].sort((a, b) => {
    const diff = sortValue(b) - sortValue(a);
    return sortAsc ? -diff : diff;
  });

  async function runScan() {
    if (strategies.length === 0) return;
    setScanning(true);
    setScanResults([]);
    setDoneCount(0);

    let done = 0;

    const tasks = strategies
      .filter((s) => s.name !== "buy_and_hold")
      .map(async (strat) => {
        const strategyParams: Record<string, number> = {};
        Object.entries(strat.params_schema).forEach(([k, v]) => {
          strategyParams[k] = typeof v.default === "boolean" ? (v.default ? 1 : 0) : (v.default as number);
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
            position_size_pct: positionPct / 100,
            strategy_params: strategyParams,
          });
          done++;
          setDoneCount(done);
          return { strategy: strat.name, result, error: null } as ScanEntry;
        } catch (e) {
          done++;
          setDoneCount(done);
          return { strategy: strat.name, result: null, error: e instanceof Error ? e.message : String(e) } as ScanEntry;
        }
      });

    const settled = await Promise.allSettled(tasks);
    const entries: ScanEntry[] = settled.map((s, i) =>
      s.status === "fulfilled"
        ? s.value
        : { strategy: strategies.filter((s) => s.name !== "buy_and_hold")[i].name, result: null, error: "Unexpected error" },
    );
    setScanResults(entries);
    setScanning(false);
  }

  const successCount = scanResults.filter((r) => r.result !== null).length;
  const scanStrategies = strategies.filter((s) => s.name !== "buy_and_hold");

  const Th = ({ label, k, right = true }: { label: string; k: SortKey; right?: boolean }) => (
    <th
      className={`py-2 px-3 ${right ? "text-right" : "text-left"} text-xs text-zinc-500 uppercase tracking-wide cursor-pointer hover:text-zinc-300 select-none whitespace-nowrap`}
      onClick={() => toggleSort(k)}
    >
      {label}
      {sortKey === k && <span className="ml-1">{sortAsc ? "↑" : "↓"}</span>}
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Strategy Scanner</h2>
            <p className="text-sm text-zinc-500 mt-0.5">
              Run all {scanStrategies.length} strategies on{" "}
              <span className="text-zinc-300 font-medium">{symbol}</span> ·{" "}
              {periodDays}d · {interval} · click any column header to sort
            </p>
          </div>
          <button
            onClick={runScan}
            disabled={scanning || scanStrategies.length === 0}
            className="px-5 py-2.5 rounded-md bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-semibold text-sm transition whitespace-nowrap"
          >
            {scanning ? `Scanning… ${doneCount}/${scanStrategies.length}` : "Scan All Strategies"}
          </button>
        </div>

        {scanning && (
          <div className="mt-4 space-y-2">
            <div className="relative h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
                style={{
                  width: `${scanStrategies.length > 0 ? (doneCount / scanStrategies.length) * 100 : 0}%`,
                  background: "linear-gradient(90deg, #06b6d4, #3b82f6)",
                  boxShadow: "0 0 8px rgba(6,182,212,0.6)",
                }}
              />
            </div>
            <p className="text-xs text-zinc-500">{doneCount} of {scanStrategies.length} complete</p>
          </div>
        )}
      </div>

      {!scanning && scanResults.length === 0 && (
        <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-lg p-12 text-center">
          <h3 className="text-xl font-medium text-zinc-300 mb-2">Find the best strategy</h3>
          <p className="text-sm text-zinc-500 max-w-md mx-auto">
            Runs all {scanStrategies.length} strategies with default params and ranks by Sharpe ratio.
            Click column headers to re-sort.
          </p>
        </div>
      )}

      {scanResults.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <h3 className="font-semibold text-zinc-200">
              {successCount} of {scanResults.length} succeeded · sorted by{" "}
              <span className="text-cyan-400">{sortKey}</span> {sortAsc ? "↑" : "↓"}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-zinc-800">
                  <th className="py-2 px-3 text-left text-xs text-zinc-500 uppercase tracking-wide">#</th>
                  <th className="py-2 px-3 text-left text-xs text-zinc-500 uppercase tracking-wide">Strategy</th>
                  <Th label="Return" k="return" />
                  <Th label="Sharpe" k="sharpe" />
                  <Th label="Sortino" k="sortino" />
                  <Th label="Calmar" k="calmar" />
                  <Th label="Recovery" k="recovery" />
                  <Th label="SQN" k="sqn" />
                  <Th label="Max DD" k="maxdd" />
                  <Th label="Win %" k="winrate" />
                  <Th label="Trades" k="trades" />
                  <th className="py-2 px-3 text-right text-xs text-zinc-500 uppercase tracking-wide">Use</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((entry, idx) => {
                  const m = entry.result?.metrics;
                  const isTop = idx === 0 && m != null;
                  const pos = m != null && (m.total_return_pct >= 0);

                  return (
                    <tr
                      key={entry.strategy}
                      className={`border-b border-zinc-800/60 transition-colors ${
                        isTop ? "bg-amber-500/5 hover:bg-amber-500/10" : "hover:bg-zinc-800/30"
                      }`}
                    >
                      <td className="py-2 px-3">
                        {isTop
                          ? <span className="text-amber-400 font-bold text-xs">★</span>
                          : <span className="text-zinc-500 text-xs">{idx + 1}</span>}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`font-medium ${isTop ? "text-amber-300" : "text-zinc-200"}`}>
                          {entry.strategy}
                        </span>
                      </td>
                      <td className={`py-2 px-3 text-right font-semibold tabular-nums ${
                        entry.error ? "text-zinc-500" : pos ? "text-emerald-400" : "text-red-400"
                      }`}>
                        {entry.error ? <span className="text-xs text-red-500">Err</span>
                          : `${pos ? "+" : ""}${m!.total_return_pct.toFixed(2)}%`}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-zinc-300">
                        {m ? <span className={(m.sharpe_ratio >= 1 ? "text-emerald-400" : "")}>{m.sharpe_ratio.toFixed(2)}</span> : "—"}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-zinc-300">
                        {m ? m.sortino_ratio.toFixed(2) : "—"}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-zinc-300">
                        {m ? m.calmar_ratio.toFixed(2) : "—"}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-zinc-300">
                        {m?.recovery_factor != null ? m.recovery_factor.toFixed(2) : "—"}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-zinc-300">
                        {m?.sqn != null ? (
                          <span className={m.sqn >= 1.6 ? "text-cyan-400" : ""}>{m.sqn.toFixed(2)}</span>
                        ) : "—"}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-red-400">
                        {m ? `-${m.max_drawdown_pct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-zinc-300">
                        {m ? `${m.win_rate_pct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-zinc-400">
                        {m ? m.total_trades : "—"}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {!entry.error ? (
                          <button
                            onClick={() => onSelectStrategy(entry.strategy)}
                            className="px-2 py-1 rounded text-xs bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/30 transition"
                          >
                            Use
                          </button>
                        ) : (
                          <span className="text-xs text-zinc-600" title={entry.error ?? ""}>failed</span>
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
