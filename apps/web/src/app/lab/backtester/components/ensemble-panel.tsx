"use client";

import { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import type { StrategyInfo, Metrics } from "@/lib/backtest-api";
import { isoDaysAgo } from "./shared";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EnsembleResult {
  id: string;
  symbol: string;
  strategy: string;
  sub_strategies: string[];
  interval: string;
  start_date: string;
  end_date: string;
  bars_processed: number;
  runtime_ms: number;
  metrics: Metrics;
  equity_curve: { t: number; equity: number; drawdown_pct: number }[];
  trades: {
    side: string;
    entry_time: string;
    exit_time: string;
    entry_price: number;
    exit_price: number;
    pnl: number;
    pnl_pct: number;
  }[];
}

// ── Vote-threshold picker ─────────────────────────────────────────────────────

const THRESHOLD_OPTIONS = [
  { label: "Any majority (≥1/N)", value: 0 },
  { label: "Clear majority (≥0.25)", value: 0.25 },
  { label: "Strong majority (≥0.5)", value: 0.5 },
  { label: "Near-unanimous (≥0.75)", value: 0.75 },
];

// ── Metric card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 text-center">
      <div className={`text-xl font-bold font-mono ${color ?? "text-zinc-200"}`}>{value}</div>
      <div className="text-[10px] text-zinc-500 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface EnsemblePanelProps {
  strategies: StrategyInfo[];
  symbol: string;
  interval: string;
  periodDays: number;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  positionPct: number;
}

const EXCLUDED = ["buy_and_hold", "buy_hold", "oracle_scalper"];

export function EnsemblePanel({
  strategies, symbol, interval, periodDays,
  initialCapital, commissionPct, slippagePct, positionPct,
}: EnsemblePanelProps) {
  const [selected, setSelected] = useState<string[]>(["rsi", "ma_cross", "macd"]);
  const [threshold, setThreshold] = useState(0);
  const [allowShort, setAllowShort] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnsembleResult | null>(null);

  const pickable = useMemo(
    () => strategies.filter((s) => !EXCLUDED.includes(s.name)),
    [strategies],
  );

  function toggle(name: string) {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name],
    );
  }

  async function run() {
    if (selected.length < 2) {
      setError("Select at least 2 strategies.");
      return;
    }
    if (selected.length > 8) {
      setError("At most 8 strategies for ensemble.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/backtest/ensemble", {
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
          position_size_pct: positionPct / 100,
          vote_threshold: threshold,
          allow_short: allowShort,
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

  const chartData = useMemo(() => {
    if (!result) return [];
    return result.equity_curve.map((p) => ({
      t: new Date(p.t).toISOString().slice(0, 10),
      equity: p.equity,
      drawdown: p.drawdown_pct,
    }));
  }, [result]);

  const m = result?.metrics;

  const retColor = !m ? "text-zinc-400"
    : m.total_return_pct >= 0 ? "text-emerald-400"
    : "text-red-400";

  return (
    <div className="space-y-4">
      {/* Config panel */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-zinc-200 mb-1">Ensemble Strategy Builder</h3>
        <p className="text-xs text-zinc-500 mb-4">
          Combine 2–8 strategies. Each bar, every strategy votes buy/sell/hold.
          When the net vote exceeds the threshold, a position is opened.
        </p>

        {/* Strategy picker */}
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2">
            Select Strategies ({selected.length}/8)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {pickable.map((s) => (
              <button
                key={s.name}
                onClick={() => toggle(s.name)}
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

        {/* Vote threshold */}
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2">
            Entry Threshold
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {THRESHOLD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setThreshold(opt.value)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                  threshold === opt.value
                    ? "bg-cyan-500 text-zinc-950 font-bold"
                    : "bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Allow short toggle */}
        <div className="mb-4 flex items-center gap-2">
          <button
            onClick={() => setAllowShort((v) => !v)}
            className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${allowShort ? "bg-cyan-500" : "bg-zinc-700"}`}
          >
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${allowShort ? "left-4" : "left-0.5"}`} />
          </button>
          <span className="text-xs text-zinc-400">Allow short selling (when majority votes sell)</span>
        </div>

        <button
          onClick={run}
          disabled={loading || selected.length < 2}
          className="px-4 py-2 bg-cyan-500 text-zinc-950 rounded-lg text-sm font-bold hover:bg-cyan-400 transition disabled:opacity-60 flex items-center gap-2"
        >
          {loading ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin" />
              Running ensemble…
            </>
          ) : (
            `Run Ensemble (${selected.length} strategies)`
          )}
        </button>

        {error && (
          <div className="mt-3 text-xs text-red-400 bg-red-900/20 border border-red-800/50 rounded px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {result && m && (
        <>
          {/* Strategy list banner */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3">
            <div className="text-xs text-zinc-500 mb-1">Ensemble members</div>
            <div className="flex flex-wrap gap-1.5">
              {result.sub_strategies.map((s) => (
                <span key={s} className="px-2 py-0.5 rounded bg-zinc-700/60 text-xs font-mono text-zinc-300 border border-zinc-600">
                  {s}
                </span>
              ))}
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            <StatCard
              label="Return"
              value={`${m.total_return_pct >= 0 ? "+" : ""}${m.total_return_pct.toFixed(2)}%`}
              color={retColor}
            />
            <StatCard label="Sharpe" value={m.sharpe_ratio.toFixed(2)} color={m.sharpe_ratio >= 1 ? "text-cyan-400" : "text-zinc-300"} />
            <StatCard label="Max DD" value={`-${Math.abs(m.max_drawdown_pct).toFixed(1)}%`} color="text-red-300" />
            <StatCard label="Win Rate" value={`${m.win_rate_pct.toFixed(0)}%`} color={m.win_rate_pct >= 55 ? "text-emerald-400" : "text-zinc-300"} />
            <StatCard label="Trades" value={String(m.total_trades)} color="text-zinc-300" />
            <StatCard
              label="Final"
              value={`$${m.final_equity.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
              color="text-zinc-200"
            />
          </div>

          {/* Equity chart */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-zinc-300 mb-3">Ensemble Equity Curve</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 20, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="t"
                  stroke="#52525b"
                  tick={{ fill: "#71717a", fontSize: 9 }}
                  tickFormatter={(v: string) => v.slice(5)}
                  interval={Math.max(1, Math.floor(chartData.length / 8))}
                />
                <YAxis
                  stroke="#52525b"
                  tick={{ fill: "#71717a", fontSize: 9 }}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  width={50}
                />
                <Tooltip
                  content={({ payload, label }) => {
                    if (!payload?.length) return null;
                    return (
                      <div className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs space-y-0.5">
                        <div className="text-zinc-400">{label}</div>
                        {payload.map((p) => (
                          <div key={p.dataKey as string} style={{ color: p.color }}>
                            {p.name}: {p.dataKey === "equity"
                              ? `$${(p.value as number).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                              : `${(p.value as number).toFixed(2)}%`}
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
                <Line type="monotone" dataKey="equity" name="Ensemble" stroke="#06b6d4" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Drawdown chart */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-zinc-300 mb-3">Drawdown</h3>
            <ResponsiveContainer width="100%" height={100}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="t" tick={false} />
                <YAxis stroke="#52525b" tick={{ fill: "#71717a", fontSize: 9 }} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={40} />
                <Line type="monotone" dataKey="drawdown" name="Drawdown %" stroke="#f87171" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Recent trades */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 overflow-x-auto">
            <h3 className="text-sm font-semibold text-zinc-300 mb-3">
              Recent Trades ({Math.min(15, result.trades.length)} / {result.trades.length})
            </h3>
            <table className="w-full text-xs font-mono border-separate border-spacing-y-0.5">
              <thead>
                <tr className="text-zinc-500 text-left">
                  <th className="px-2 py-1">Entry</th>
                  <th className="px-2 py-1">Exit</th>
                  <th className="px-2 py-1">Side</th>
                  <th className="px-2 py-1 text-right">Entry $</th>
                  <th className="px-2 py-1 text-right">Exit $</th>
                  <th className="px-2 py-1 text-right">P&L %</th>
                </tr>
              </thead>
              <tbody>
                {result.trades.slice(-15).reverse().map((t, i) => (
                  <tr key={i} className="bg-zinc-800/30 hover:bg-zinc-800/60 transition">
                    <td className="px-2 py-1 text-zinc-400">{t.entry_time.slice(0, 10)}</td>
                    <td className="px-2 py-1 text-zinc-400">{t.exit_time.slice(0, 10)}</td>
                    <td className={`px-2 py-1 font-semibold ${t.side === "long" ? "text-emerald-400" : "text-red-400"}`}>
                      {t.side}
                    </td>
                    <td className="px-2 py-1 text-right text-zinc-300">{t.entry_price.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right text-zinc-300">{t.exit_price.toFixed(2)}</td>
                    <td className={`px-2 py-1 text-right font-semibold ${t.pnl_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {t.pnl_pct >= 0 ? "+" : ""}{t.pnl_pct.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tip */}
          <div className="text-[11px] text-zinc-600 px-1">
            Tip: Run the individual strategies in Single mode to compare the ensemble's Sharpe against each component.
          </div>
        </>
      )}
    </div>
  );
}
