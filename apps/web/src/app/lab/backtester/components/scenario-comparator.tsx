"use client";

import { useState, useCallback } from "react";
import type { BacktestResult, BacktestParams } from "@/lib/backtest-api";
import { backtestApi } from "@/lib/backtest-api";
import { isoDaysAgo } from "./shared";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScenarioComparatorProps {
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

interface ScenarioDefinition {
  id: string;
  label: string;
  buildParams: (base: BacktestParams) => BacktestParams;
}

interface ScenarioState {
  id: string;
  label: string;
  status: "idle" | "loading" | "done" | "error";
  result: BacktestResult | null;
  error: string | null;
}

// ─── Scenario definitions ─────────────────────────────────────────────────────

function buildScenarios(
  symbol: string,
  strategy: string,
  strategyParams: Record<string, number>,
  interval: string,
  periodDays: number,
  initialCapital: number,
  commissionPct: number,
  slippagePct: number,
  positionPct: number,
): ScenarioDefinition[] {
  return [
    {
      id: "base",
      label: "Base Case",
      buildParams: (base) => ({ ...base }),
    },
    {
      id: "higher_commission",
      label: "Higher Commission",
      buildParams: (base) => ({
        ...base,
        commission_pct: base.commission_pct * 3,
      }),
    },
    {
      id: "more_slippage",
      label: "More Slippage",
      buildParams: (base) => ({
        ...base,
        slippage_pct: base.slippage_pct * 3,
      }),
    },
    {
      id: "shorter_period",
      label: "Shorter Period",
      buildParams: () => {
        const days = Math.max(10, Math.floor(periodDays / 2));
        return {
          symbol,
          strategy,
          strategy_params: strategyParams,
          interval,
          initial_capital: initialCapital,
          commission_pct: commissionPct,
          slippage_pct: slippagePct,
          position_size_pct: positionPct,
          start_date: isoDaysAgo(days),
        };
      },
    },
    {
      id: "longer_period",
      label: "Longer Period",
      buildParams: () => {
        const days = Math.min(730, periodDays * 2);
        return {
          symbol,
          strategy,
          strategy_params: strategyParams,
          interval,
          initial_capital: initialCapital,
          commission_pct: commissionPct,
          slippage_pct: slippagePct,
          position_size_pct: positionPct,
          start_date: isoDaysAgo(days),
        };
      },
    },
    {
      id: "bear_market",
      label: "Bear Market (2022)",
      buildParams: () => ({
        symbol,
        strategy,
        strategy_params: strategyParams,
        interval,
        initial_capital: initialCapital,
        commission_pct: commissionPct,
        slippage_pct: slippagePct,
        position_size_pct: positionPct,
        start_date: "2022-01-01",
        end_date: "2022-12-31",
      }),
    },
    {
      id: "bull_market",
      label: "Bull Market (2023)",
      buildParams: () => ({
        symbol,
        strategy,
        strategy_params: strategyParams,
        interval,
        initial_capital: initialCapital,
        commission_pct: commissionPct,
        slippage_pct: slippagePct,
        position_size_pct: positionPct,
        start_date: "2023-01-01",
        end_date: "2023-12-31",
      }),
    },
  ];
}

// ─── Helper components ────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span className="inline-block w-3 h-3 border-2 border-zinc-600 border-t-cyan-400 rounded-full animate-spin" />
  );
}

function ReturnCell({ value, baseValue }: { value: number; baseValue: number | null }) {
  const color = value >= 0 ? "text-emerald-400" : "text-red-400";
  const beatBase =
    baseValue !== null && value > baseValue
      ? "▲"
      : baseValue !== null && value < baseValue
      ? "▼"
      : null;
  const compareColor =
    beatBase === "▲" ? "text-emerald-500" : beatBase === "▼" ? "text-red-500" : "";

  return (
    <span className={`font-mono ${color}`}>
      {value >= 0 ? "+" : ""}
      {value.toFixed(2)}%{" "}
      {beatBase && <span className={`text-[10px] ${compareColor}`}>{beatBase}</span>}
    </span>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function ScenarioComparator({
  symbol,
  strategy,
  strategyParams,
  interval,
  periodDays,
  initialCapital,
  commissionPct,
  slippagePct,
  positionPct,
}: ScenarioComparatorProps) {
  const scenarioDefs = buildScenarios(
    symbol,
    strategy,
    strategyParams,
    interval,
    periodDays,
    initialCapital,
    commissionPct,
    slippagePct,
    positionPct,
  );

  const [scenarios, setScenarios] = useState<ScenarioState[]>(
    scenarioDefs.map((s) => ({
      id: s.id,
      label: s.label,
      status: "idle",
      result: null,
      error: null,
    })),
  );
  const [running, setRunning] = useState(false);

  const runAll = useCallback(async () => {
    setRunning(true);

    // Reset all to loading
    setScenarios(
      scenarioDefs.map((s) => ({
        id: s.id,
        label: s.label,
        status: "loading" as const,
        result: null,
        error: null,
      })),
    );

    const baseParams: BacktestParams = {
      symbol,
      strategy,
      strategy_params: strategyParams,
      interval,
      initial_capital: initialCapital,
      commission_pct: commissionPct,
      slippage_pct: slippagePct,
      position_size_pct: positionPct,
      start_date: isoDaysAgo(periodDays),
    };

    await Promise.all(
      scenarioDefs.map(async (def) => {
        const params = def.buildParams(baseParams);
        try {
          const result = await backtestApi.run(params);
          setScenarios((prev) =>
            prev.map((s) =>
              s.id === def.id ? { ...s, status: "done", result, error: null } : s,
            ),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setScenarios((prev) =>
            prev.map((s) =>
              s.id === def.id ? { ...s, status: "error", result: null, error: message } : s,
            ),
          );
        }
      }),
    );

    setRunning(false);
  }, [
    symbol,
    strategy,
    strategyParams,
    interval,
    periodDays,
    initialCapital,
    commissionPct,
    slippagePct,
    positionPct,
    scenarioDefs,
  ]);

  const baseResult = scenarios.find((s) => s.id === "base")?.result ?? null;
  const baseReturn = baseResult?.metrics.total_return_pct ?? null;

  const doneCount = scenarios.filter((s) => s.status === "done").length;
  const totalCount = scenarios.length;
  const outperformCount = scenarios.filter(
    (s) =>
      s.id !== "base" &&
      s.result !== null &&
      baseReturn !== null &&
      s.result.metrics.total_return_pct > baseReturn,
  ).length;
  const underperformCount = scenarios.filter(
    (s) =>
      s.id !== "base" &&
      s.result !== null &&
      baseReturn !== null &&
      s.result.metrics.total_return_pct < baseReturn,
  ).length;

  const hasResults = scenarios.some((s) => s.status === "done");

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">
            Scenario Comparator
          </h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            &ldquo;What if&rdquo; analysis — varies one parameter at a time
          </p>
        </div>
        <button
          onClick={runAll}
          disabled={running}
          className={`px-4 py-2 rounded text-sm font-medium transition ${
            running
              ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
              : "bg-cyan-500 text-zinc-950 hover:bg-cyan-400"
          }`}
        >
          {running ? (
            <span className="flex items-center gap-2">
              <Spinner /> Running ({doneCount}/{totalCount})…
            </span>
          ) : (
            "Run All Scenarios"
          )}
        </button>
      </div>

      {/* Summary badge (after results) */}
      {hasResults && baseReturn !== null && (
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="px-2 py-1 rounded bg-cyan-900/30 border border-cyan-800/50 text-cyan-300">
            Base Case: {baseReturn >= 0 ? "+" : ""}{baseReturn.toFixed(2)}%
          </span>
          {outperformCount > 0 && (
            <span className="px-2 py-1 rounded bg-emerald-900/30 border border-emerald-800/50 text-emerald-300">
              {outperformCount} scenario{outperformCount !== 1 ? "s" : ""} beat base
            </span>
          )}
          {underperformCount > 0 && (
            <span className="px-2 py-1 rounded bg-red-900/30 border border-red-800/50 text-red-300">
              {underperformCount} scenario{underperformCount !== 1 ? "s" : ""} underperformed
            </span>
          )}
        </div>
      )}

      {/* Results table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800">
              <th className="py-2 pr-4 font-medium">Scenario</th>
              <th className="py-2 pr-4 font-medium text-right">Return %</th>
              <th className="py-2 pr-4 font-medium text-right">Sharpe</th>
              <th className="py-2 pr-4 font-medium text-right">Max DD</th>
              <th className="py-2 pr-4 font-medium text-right">Trades</th>
              <th className="py-2 font-medium text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => {
              const isBase = s.id === "base";
              const m = s.result?.metrics;
              const beats =
                !isBase && m !== undefined && baseReturn !== null
                  ? m.total_return_pct > baseReturn
                  : null;

              return (
                <tr
                  key={s.id}
                  className={`border-b border-zinc-800/50 transition hover:bg-zinc-800/20 ${
                    isBase ? "ring-1 ring-inset ring-cyan-800/60" : ""
                  }`}
                >
                  {/* Scenario label */}
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      {isBase && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide bg-cyan-900/40 text-cyan-400 border border-cyan-800/50 shrink-0">
                          base
                        </span>
                      )}
                      {!isBase && beats === true && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      )}
                      {!isBase && beats === false && (
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                      )}
                      {!isBase && beats === null && (
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-700 shrink-0" />
                      )}
                      <span className={isBase ? "text-cyan-300 font-medium" : "text-zinc-300"}>
                        {s.label}
                      </span>
                    </div>
                  </td>

                  {/* Return % */}
                  <td className="py-2 pr-4 text-right">
                    {s.status === "loading" && <Spinner />}
                    {s.status === "done" && m && (
                      <ReturnCell value={m.total_return_pct} baseValue={isBase ? null : baseReturn} />
                    )}
                    {s.status === "idle" && <span className="text-zinc-600">—</span>}
                    {s.status === "error" && <span className="text-red-500">Err</span>}
                  </td>

                  {/* Sharpe */}
                  <td className="py-2 pr-4 text-right font-mono text-zinc-300">
                    {s.status === "loading" && "…"}
                    {s.status === "done" && m && m.sharpe_ratio.toFixed(2)}
                    {(s.status === "idle" || s.status === "error") && (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>

                  {/* Max Drawdown */}
                  <td className="py-2 pr-4 text-right font-mono text-red-400">
                    {s.status === "loading" && "…"}
                    {s.status === "done" && m && `-${m.max_drawdown_pct.toFixed(2)}%`}
                    {(s.status === "idle" || s.status === "error") && (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>

                  {/* Trades */}
                  <td className="py-2 pr-4 text-right font-mono text-zinc-400">
                    {s.status === "loading" && "…"}
                    {s.status === "done" && m && m.total_trades}
                    {(s.status === "idle" || s.status === "error") && (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="py-2 text-right">
                    {s.status === "idle" && (
                      <span className="text-zinc-600 text-[10px] uppercase">Idle</span>
                    )}
                    {s.status === "loading" && (
                      <span className="text-cyan-400 text-[10px] uppercase">Running</span>
                    )}
                    {s.status === "done" && (
                      <span className="text-emerald-400 text-[10px] uppercase">Done</span>
                    )}
                    {s.status === "error" && (
                      <span className="text-red-400 text-[10px] uppercase" title={s.error ?? ""}>
                        Error
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Error detail */}
      {scenarios.some((s) => s.status === "error") && (
        <div className="space-y-1 border-t border-zinc-800 pt-3">
          {scenarios
            .filter((s) => s.status === "error")
            .map((s) => (
              <p key={s.id} className="text-[11px] text-red-400">
                <span className="font-medium">{s.label}:</span> {s.error}
              </p>
            ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-[10px] text-zinc-600 border-t border-zinc-800 pt-3">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400" /> Beats base
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-400" /> Below base
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block px-1 rounded border border-cyan-800/50 text-cyan-500 text-[9px]">
            base
          </span>{" "}
          Reference scenario
        </span>
      </div>
    </div>
  );
}
