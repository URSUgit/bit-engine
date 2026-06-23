"use client";

import { useMemo } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, Cell, Legend,
  LineChart, Line, ReferenceLine,
} from "recharts";

function computeStreaks(outcomes: boolean[]): { wins: number[]; losses: number[] } {
  const wins: number[] = [];
  const losses: number[] = [];
  let cur = 0;
  let curType = outcomes[0];
  for (const o of outcomes) {
    if (o === curType) {
      cur++;
    } else {
      if (curType) wins.push(cur); else losses.push(cur);
      cur = 1;
      curType = o;
    }
  }
  if (cur > 0) { if (curType) wins.push(cur); else losses.push(cur); }
  return { wins, losses };
}

function theoreticalStreak(p: number, n: number, k: number): number {
  if (k <= 0 || p <= 0 || p >= 1) return 0;
  return p ** k * (1 - p);
}

export function StreakDistribution({ result }: { result: BacktestResult }) {
  const { trades, metrics } = result;
  const winRate = (metrics.win_rate_pct ?? 50) / 100;

  const outcomes = useMemo(() => trades.map((t) => t.pnl_pct > 0), [trades]);
  const streaks = useMemo(() => computeStreaks(outcomes), [outcomes]);

  const maxLoss = Math.max(...streaks.losses, 1);
  const maxWin = Math.max(...streaks.wins, 1);

  const lossDistData = useMemo(() => {
    const actual: Record<number, number> = {};
    for (const s of streaks.losses) actual[s] = (actual[s] ?? 0) + 1;
    const totalStreaks = streaks.losses.length || 1;
    return Array.from({ length: Math.min(maxLoss, 15) }, (_, i) => {
      const k = i + 1;
      return {
        k,
        actual: ((actual[k] ?? 0) / totalStreaks) * 100,
        theoretical: theoreticalStreak(1 - winRate, trades.length, k) * 100,
      };
    });
  }, [streaks.losses, maxLoss, winRate, trades.length]);

  const winDistData = useMemo(() => {
    const actual: Record<number, number> = {};
    for (const s of streaks.wins) actual[s] = (actual[s] ?? 0) + 1;
    const totalStreaks = streaks.wins.length || 1;
    return Array.from({ length: Math.min(maxWin, 15) }, (_, i) => {
      const k = i + 1;
      return {
        k,
        actual: ((actual[k] ?? 0) / totalStreaks) * 100,
        theoretical: theoreticalStreak(winRate, trades.length, k) * 100,
      };
    });
  }, [streaks.wins, maxWin, winRate, trades.length]);

  // Probability of at least N consecutive losses in M trades
  const ruinProbCurve = useMemo(() => {
    const M = Math.min(trades.length, 500);
    const lp = 1 - winRate;
    return Array.from({ length: 15 }, (_, i) => {
      const N = i + 1;
      // Approximate: 1 - (1 - lp^N)^(M/N)
      const prob = 1 - Math.pow(1 - Math.pow(lp, N), Math.floor(M / N));
      return { n: N, prob: Math.min(100, prob * 100) };
    });
  }, [winRate, trades.length]);

  const avgWinStreak = streaks.wins.length > 0 ? streaks.wins.reduce((a, b) => a + b, 0) / streaks.wins.length : 0;
  const avgLossStreak = streaks.losses.length > 0 ? streaks.losses.reduce((a, b) => a + b, 0) / streaks.losses.length : 0;

  if (trades.length < 5) {
    return <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">Need at least 5 trades.</div>;
  }

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Max Loss Streak", value: String(maxLoss), color: maxLoss <= 5 ? "text-emerald-400" : maxLoss <= 10 ? "text-amber-400" : "text-red-400" },
          { label: "Max Win Streak", value: String(maxWin), color: "text-emerald-400" },
          { label: "Avg Loss Streak", value: avgLossStreak.toFixed(1), color: "text-zinc-300" },
          { label: "Avg Win Streak", value: avgWinStreak.toFixed(1), color: "text-zinc-300" },
        ].map((c) => (
          <div key={c.label} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
            <div className={`text-xl font-bold font-mono ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Loss streak distribution */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">Loss Streak Length Distribution</h4>
        <p className="text-[10px] text-zinc-600 mb-3">
          Actual vs. theoretical (Bernoulli) distribution of consecutive losing run lengths.
          Deviation from theory may indicate clustering or anti-persistence.
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={lossDistData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="k" tick={{ fill: "#71717a", fontSize: 10 }} label={{ value: "Streak length", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }} />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
            <Tooltip
              content={({ payload, label }) => {
                if (!payload?.length) return null;
                return (
                  <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: "#a1a1aa", marginBottom: 4 }}>Streak: {label} losses</div>
                    {payload.map((p, i) => (
                      <div key={i} style={{ color: p.color }}>
                        {String(p.name)}: {typeof p.value === "number" ? p.value.toFixed(1) : "0"}%
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <Bar dataKey="actual" name="Actual %" fill="#ef4444" fillOpacity={0.8} />
            <Bar dataKey="theoretical" name="Theoretical %" fill="#71717a" fillOpacity={0.5} />
            <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Win streak distribution */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">Win Streak Length Distribution</h4>
        <p className="text-[10px] text-zinc-600 mb-3">Actual vs. theoretical distribution of consecutive winning run lengths.</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={winDistData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="k" tick={{ fill: "#71717a", fontSize: 10 }} />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
            <Tooltip
              content={({ payload, label }) => {
                if (!payload?.length) return null;
                return (
                  <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: "#a1a1aa", marginBottom: 4 }}>Streak: {label} wins</div>
                    {payload.map((p, i) => (
                      <div key={i} style={{ color: p.color }}>
                        {String(p.name)}: {typeof p.value === "number" ? p.value.toFixed(1) : "0"}%
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <Bar dataKey="actual" name="Actual %" fill="#22c55e" fillOpacity={0.8} />
            <Bar dataKey="theoretical" name="Theoretical %" fill="#71717a" fillOpacity={0.5} />
            <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Probability of at least N consecutive losses */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">Probability of Encountering N Consecutive Losses</h4>
        <p className="text-[10px] text-zinc-600 mb-3">
          Approximate probability of experiencing a run of at least N losses somewhere in {Math.min(trades.length, 500)} trades
          (WR={`${(winRate * 100).toFixed(1)}%`}).
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={ruinProbCurve} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="n" tick={{ fill: "#71717a", fontSize: 10 }} label={{ value: "N consecutive losses", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }} />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} domain={[0, 100]} />
            <ReferenceLine y={5} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: "5%", fill: "#f59e0b", fontSize: 9, position: "right" }} />
            <ReferenceLine x={maxLoss} stroke="#ef4444" strokeDasharray="3 3" label={{ value: "Actual max", fill: "#ef4444", fontSize: 9, position: "top" }} />
            <Tooltip
              content={({ payload, label }) => {
                if (!payload?.length) return null;
                const v = payload[0]?.value;
                return (
                  <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: "#a1a1aa" }}>{label} consecutive losses</div>
                    <div style={{ color: "#ef4444" }}>Probability: {typeof v === "number" ? v.toFixed(1) : "0"}%</div>
                  </div>
                );
              }}
            />
            <Line type="monotone" dataKey="prob" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>

        {/* Quick reference table */}
        <div className="mt-3 grid grid-cols-5 gap-1 text-[10px] text-center">
          {ruinProbCurve.slice(0, 10).map((d) => (
            <div key={d.n} className={`rounded px-1 py-0.5 ${d.prob > 50 ? "bg-red-950/50 text-red-400" : d.prob > 10 ? "bg-amber-950/50 text-amber-400" : "bg-zinc-800 text-zinc-400"}`}>
              <div className="font-mono font-bold">{d.n}×</div>
              <div>{d.prob.toFixed(0)}%</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
