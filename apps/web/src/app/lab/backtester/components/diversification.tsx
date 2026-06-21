"use client";

import { useState } from "react";
import { backtestApi, type StrategyInfo } from "@/lib/backtest-api";
import { isoDaysAgo } from "./shared";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CorrelationResult {
  strategies: string[];
  matrix: Record<string, Record<string, number | null>>;
  most_diversifying_pair: [string, string] | null;
  min_correlation: number | null;
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function corrColor(v: number | null): string {
  if (v === null) return "bg-zinc-800/50 text-zinc-600";
  if (v === 1) return "bg-zinc-700 text-zinc-300";
  if (v >= 0.7) return "bg-red-800/70 text-red-100";
  if (v >= 0.4) return "bg-orange-800/60 text-orange-100";
  if (v >= 0.1) return "bg-zinc-700/60 text-zinc-200";
  if (v >= -0.1) return "bg-emerald-900/40 text-emerald-200";
  if (v >= -0.4) return "bg-emerald-700/60 text-emerald-100";
  return "bg-emerald-600/70 text-emerald-50";
}

function corrLabel(v: number | null): string {
  if (v === null) return "—";
  return v.toFixed(2);
}

// ── Main component ────────────────────────────────────────────────────────────

export interface DiversificationProps {
  strategies: StrategyInfo[];
  symbol: string;
  interval: string;
  periodDays: number;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
}

const DEFAULT_PICK = ["rsi", "ma_cross", "macd", "bollinger", "momentum", "scalp_ema", "vwap_reversion"];

export function DiversificationPanel({
  strategies, symbol, interval, periodDays,
  initialCapital, commissionPct, slippagePct,
}: DiversificationProps) {
  const [selected, setSelected] = useState<string[]>(
    DEFAULT_PICK.filter((d) => strategies.some((s) => s.name === d)),
  );
  const [result, setResult] = useState<CorrelationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleStrategy(name: string) {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name],
    );
  }

  async function run() {
    if (selected.length < 2) {
      setError("Select at least 2 strategies.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const BASE = "";
      const res = await fetch(`${BASE}/api/v1/backtest/equity_correlation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategies: selected,
          symbol,
          interval,
          period_days: periodDays,
          initial_capital: initialCapital,
          commission_pct: commissionPct / 100,
          slippage_pct: slippagePct / 100,
          position_size_pct: 0.25,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-zinc-200 mb-2">Strategy Diversification Analysis</h3>
        <p className="text-xs text-zinc-500 mb-4">
          Pairwise Pearson correlation between strategy equity curves. Low/negative correlation = better diversification.
        </p>

        {/* Strategy picker */}
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2">
            Select Strategies ({selected.length}/15)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {strategies
              .filter((s) => s.name !== "buy_hold" && s.name !== "oracle_scalper")
              .map((s) => (
                <button
                  key={s.name}
                  onClick={() => toggleStrategy(s.name)}
                  className={`px-2 py-0.5 rounded text-xs font-mono transition ${
                    selected.includes(s.name)
                      ? "bg-cyan-500 text-zinc-950 font-semibold"
                      : "bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {s.name}
                </button>
              ))}
          </div>
        </div>

        <button
          onClick={run}
          disabled={loading || selected.length < 2}
          className="px-4 py-2 bg-cyan-500 text-zinc-950 rounded-lg text-sm font-bold hover:bg-cyan-400 transition disabled:opacity-60 flex items-center gap-2"
        >
          {loading ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin" />
              Computing…
            </>
          ) : (
            "Run Correlation Analysis"
          )}
        </button>

        {error && (
          <div className="mt-3 text-xs text-red-400 bg-red-900/20 border border-red-800/50 rounded px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {result && (
        <>
          {/* Best pair banner */}
          {result.most_diversifying_pair && result.min_correlation !== null && (
            <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-xl px-4 py-3">
              <div className="text-xs text-zinc-400 mb-0.5">Most Diversifying Pair</div>
              <div className="font-semibold text-zinc-100">
                {result.most_diversifying_pair[0]} + {result.most_diversifying_pair[1]}
                <span className="ml-2 text-emerald-300 font-mono">
                  ρ = {result.min_correlation.toFixed(3)}
                </span>
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                These two strategies have the lowest correlation — combining them reduces portfolio risk.
              </div>
            </div>
          )}

          {/* Correlation matrix */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 overflow-x-auto">
            <h3 className="text-sm font-semibold text-zinc-300 mb-3">Correlation Matrix</h3>
            <table className="text-xs border-separate border-spacing-0.5">
              <thead>
                <tr>
                  <th className="w-28" />
                  {result.strategies.map((s) => (
                    <th key={s} className="px-1 py-1 text-center text-zinc-500 font-mono font-normal min-w-[56px]">
                      {s.length > 8 ? s.slice(0, 7) + "…" : s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.strategies.map((rowS) => (
                  <tr key={rowS}>
                    <td className="px-2 py-0.5 text-zinc-400 font-mono text-[11px] whitespace-nowrap pr-3">
                      {rowS}
                    </td>
                    {result.strategies.map((colS) => {
                      const v = result.matrix[rowS]?.[colS] ?? null;
                      return (
                        <td
                          key={colS}
                          className={`px-1 py-0.5 text-center font-mono font-semibold rounded ${corrColor(v)}`}
                          title={`${rowS} ↔ ${colS}: ${v !== null ? v.toFixed(4) : "—"}`}
                        >
                          {corrLabel(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Color legend */}
            <div className="flex items-center gap-3 mt-3 text-[11px] text-zinc-500 flex-wrap">
              <span>Correlation scale:</span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-red-800/70 inline-block" /> High (&gt;0.7)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-zinc-700/60 inline-block" /> Moderate
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-emerald-900/40 inline-block" /> Near-zero
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-emerald-600/70 inline-block" /> Negative (diversifying)
              </span>
            </div>
          </div>

          {/* Interpretation */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 text-xs text-zinc-400 space-y-2">
            <div className="font-semibold text-zinc-300 mb-2">How to use this</div>
            <div>• <strong>ρ &gt; 0.7</strong>: strategies move together — little diversification benefit from combining</div>
            <div>• <strong>0.3 &lt; ρ &lt; 0.7</strong>: moderate correlation — some diversification</div>
            <div>• <strong>ρ &lt; 0.3</strong>: low correlation — good diversification candidates</div>
            <div>• <strong>ρ &lt; 0</strong>: inversely correlated — excellent hedge pairs</div>
            <div className="pt-1 text-zinc-500">
              For optimal portfolio construction, select pairs with ρ &lt; 0.4 and combine using Kelly criterion or equal weight.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
