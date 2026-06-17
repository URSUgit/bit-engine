"use client";

import { useState } from "react";
import { LineChart, Line, ResponsiveContainer } from "recharts";

interface LeaderboardEntry {
  strategy_name: string;
  display_name: string;
  description: string;
  rank: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  calmar_ratio: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  win_rate_pct: number;
  profit_factor: number;
  total_trades: number;
  avg_trade_duration_bars: number;
  equity_curve_sample: number[];
  error: string | null;
}

type SortCol = "sharpe_ratio" | "total_return_pct" | "calmar_ratio" | "win_rate_pct" | "max_drawdown_pct" | "profit_factor" | "total_trades";

interface StrategyLeaderboardProps {
  symbol: string;
  interval: string;
  periodDays: number;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  positionPct: number;
  onSelectStrategy?: (name: string) => void;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-yellow-400 font-bold text-base">🥇</span>;
  if (rank === 2) return <span className="text-zinc-300 font-bold text-base">🥈</span>;
  if (rank === 3) return <span className="text-amber-600 font-bold text-base">🥉</span>;
  return <span className="text-zinc-500 tabular-nums text-sm">{rank}</span>;
}

function Sparkline({ data, initialCapital }: { data: number[]; initialCapital: number }) {
  const chartData = data.map((v, i) => ({ i, v }));
  const color = data[data.length - 1] >= initialCapital ? "#4ade80" : "#f87171";
  return (
    <ResponsiveContainer width={80} height={28}>
      <LineChart data={chartData}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function colorSharpe(v: number) {
  return v >= 1.5 ? "text-green-300" : v >= 0.5 ? "text-green-400" : v >= 0 ? "text-yellow-400" : "text-red-400";
}
function colorReturn(v: number) { return v > 0 ? "text-green-400" : "text-red-400"; }
function colorDD(v: number) { return v > 20 ? "text-red-400" : v > 10 ? "text-yellow-400" : "text-green-400"; }
function colorWR(v: number) { return v >= 55 ? "text-green-400" : v >= 45 ? "text-yellow-400" : "text-red-400"; }

const SORT_LABELS: Record<SortCol, string> = {
  sharpe_ratio: "Sharpe",
  total_return_pct: "Return",
  calmar_ratio: "Calmar",
  win_rate_pct: "Win Rate",
  max_drawdown_pct: "Max DD",
  profit_factor: "PF",
  total_trades: "Trades",
};

export function StrategyLeaderboard({
  symbol, interval, periodDays, initialCapital,
  commissionPct, slippagePct, positionPct, onSelectStrategy,
}: StrategyLeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>("sharpe_ratio");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  async function runLeaderboard() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/backtest/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          interval,
          period_days: periodDays,
          initial_capital: initialCapital,
          commission_pct: commissionPct / 100,
          slippage_pct: slippagePct / 100,
          position_size_pct: positionPct / 100,
          sort_by: "sharpe_ratio",
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(d.detail ?? res.statusText);
      }
      setEntries(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function toggleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === -1 ? 1 : -1));
    } else {
      setSortCol(col);
      // For drawdown lower is better, default ascending; others descending
      setSortDir(col === "max_drawdown_pct" ? 1 : -1);
    }
  }

  const sorted = entries
    ? [...entries].sort((a, b) => {
        const av = a[sortCol];
        const bv = b[sortCol];
        return (av - bv) * sortDir;
      })
    : null;

  function SortHeader({ col, children }: { col: SortCol; children: React.ReactNode }) {
    const active = sortCol === col;
    return (
      <th
        onClick={() => toggleSort(col)}
        className={`px-3 py-2 text-right font-medium cursor-pointer select-none whitespace-nowrap transition ${
          active ? "text-cyan-400" : "text-zinc-400 hover:text-zinc-200"
        }`}
      >
        {children} {active ? (sortDir === -1 ? "↓" : "↑") : ""}
      </th>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Strategy Leaderboard</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            All strategies ranked on {symbol} · {periodDays}d · {interval}
          </p>
        </div>
        <button
          onClick={runLeaderboard}
          disabled={loading}
          className="px-4 py-2 rounded-md text-sm font-semibold bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50 transition"
        >
          {loading ? "Running all strategies…" : "Run Leaderboard"}
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 p-3 rounded">
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-2 animate-pulse">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-12 bg-zinc-800/40 rounded" style={{ opacity: 1 - i * 0.08 }} />
          ))}
          <p className="text-xs text-zinc-500 text-center pt-1">Running {17} backtests in parallel…</p>
        </div>
      )}

      {sorted && !loading && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/80 text-left">
                  <th className="px-3 py-2 text-zinc-400 font-medium w-8">#</th>
                  <th className="px-3 py-2 text-zinc-400 font-medium">Strategy</th>
                  <th className="px-3 py-2 text-zinc-400 font-medium">Trend</th>
                  <SortHeader col="sharpe_ratio">Sharpe</SortHeader>
                  <SortHeader col="total_return_pct">Return</SortHeader>
                  <SortHeader col="max_drawdown_pct">Max DD</SortHeader>
                  <SortHeader col="win_rate_pct">Win Rate</SortHeader>
                  <SortHeader col="profit_factor">PF</SortHeader>
                  <SortHeader col="total_trades">Trades</SortHeader>
                  <th className="px-3 py-2 text-zinc-400 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {sorted.map((e) => (
                  <tr
                    key={e.strategy_name}
                    className={`hover:bg-zinc-800/30 transition ${e.error ? "opacity-50" : ""}`}
                  >
                    <td className="px-3 py-2.5 text-center">
                      <RankBadge rank={e.rank} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-zinc-200">{e.display_name || e.strategy_name}</div>
                      {e.description && (
                        <div className="text-xs text-zinc-500 truncate max-w-[180px]">{e.description}</div>
                      )}
                      {e.error && <div className="text-xs text-red-400">Error</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <Sparkline data={e.equity_curve_sample} initialCapital={initialCapital} />
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${colorSharpe(e.sharpe_ratio)}`}>
                      {e.sharpe_ratio.toFixed(2)}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${colorReturn(e.total_return_pct)}`}>
                      {e.total_return_pct >= 0 ? "+" : ""}{e.total_return_pct.toFixed(1)}%
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${colorDD(e.max_drawdown_pct)}`}>
                      {e.max_drawdown_pct.toFixed(1)}%
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${colorWR(e.win_rate_pct)}`}>
                      {e.win_rate_pct.toFixed(1)}%
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${e.profit_factor >= 1.5 ? "text-green-400" : e.profit_factor >= 1 ? "text-yellow-400" : "text-red-400"}`}>
                      {e.profit_factor.toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-300">
                      {e.total_trades}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() => onSelectStrategy?.(e.strategy_name)}
                        className="px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white transition"
                      >
                        Load
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-zinc-800 text-xs text-zinc-500 flex items-center justify-between">
            <span>{sorted.length} strategies · Click column headers to sort</span>
            <span>{sorted.filter((e) => !e.error).length} succeeded · {sorted.filter((e) => !!e.error).length} failed</span>
          </div>
        </div>
      )}

      {!sorted && !loading && !error && (
        <div className="h-48 flex flex-col items-center justify-center gap-3 border border-dashed border-zinc-800 rounded-lg text-zinc-500 text-sm">
          <span className="text-2xl">🏆</span>
          <span>Click &ldquo;Run Leaderboard&rdquo; to rank all strategies side-by-side</span>
        </div>
      )}
    </div>
  );
}
