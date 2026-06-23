"use client";

import { useMemo } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Cell, Tooltip, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from "recharts";

function computeSideStats(trades: BacktestResult["trades"], side: "long" | "short") {
  const t = trades.filter((tr) => tr.side === side);
  if (t.length === 0) return null;
  const wins = t.filter((tr) => tr.pnl_pct > 0);
  const losses = t.filter((tr) => tr.pnl_pct <= 0);
  const totalPnl = t.reduce((s, tr) => s + tr.pnl_pct, 0);
  const avgWin = wins.length ? wins.reduce((s, tr) => s + tr.pnl_pct, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, tr) => s + tr.pnl_pct, 0) / losses.length : 0;
  const grossWin = wins.reduce((s, tr) => s + tr.pnl_pct, 0);
  const grossLoss = Math.abs(losses.reduce((s, tr) => s + tr.pnl_pct, 0));
  const avgDuration = t.reduce((s, tr) => s + tr.duration_bars, 0) / t.length;
  const best = Math.max(...t.map((tr) => tr.pnl_pct));
  const worst = Math.min(...t.map((tr) => tr.pnl_pct));
  let maxConsecWins = 0;
  let maxConsecLosses = 0;
  let curWins = 0;
  let curLosses = 0;
  for (const tr of t) {
    if (tr.pnl_pct > 0) { curWins++; curLosses = 0; maxConsecWins = Math.max(maxConsecWins, curWins); }
    else { curLosses++; curWins = 0; maxConsecLosses = Math.max(maxConsecLosses, curLosses); }
  }
  return {
    count: t.length,
    winRate: (wins.length / t.length) * 100,
    totalPnl,
    avgPnl: totalPnl / t.length,
    avgWin,
    avgLoss,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgDuration,
    best,
    worst,
    maxConsecWins,
    maxConsecLosses,
  };
}

const STAT_LABELS: { key: string; label: string; format: (v: number) => string }[] = [
  { key: "count", label: "# Trades", format: (v) => String(Math.round(v)) },
  { key: "winRate", label: "Win Rate", format: (v) => `${v.toFixed(1)}%` },
  { key: "totalPnl", label: "Total PnL", format: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` },
  { key: "avgPnl", label: "Avg PnL/Trade", format: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(3)}%` },
  { key: "avgWin", label: "Avg Win", format: (v) => `+${v.toFixed(3)}%` },
  { key: "avgLoss", label: "Avg Loss", format: (v) => `${v.toFixed(3)}%` },
  { key: "profitFactor", label: "Profit Factor", format: (v) => v === Infinity ? "∞" : v.toFixed(2) },
  { key: "avgDuration", label: "Avg Duration", format: (v) => `${v.toFixed(1)} bars` },
  { key: "best", label: "Best Trade", format: (v) => `+${v.toFixed(3)}%` },
  { key: "worst", label: "Worst Trade", format: (v) => `${v.toFixed(3)}%` },
  { key: "maxConsecWins", label: "Max Consec Wins", format: (v) => String(Math.round(v)) },
  { key: "maxConsecLosses", label: "Max Consec Losses", format: (v) => String(Math.round(v)) },
];

type SideStats = NonNullable<ReturnType<typeof computeSideStats>>;

export function LongShortAnalysis({ result }: { result: BacktestResult }) {
  const { trades } = result;

  const longStats = useMemo(() => computeSideStats(trades, "long"), [trades]);
  const shortStats = useMemo(() => computeSideStats(trades, "short"), [trades]);

  const pnlByTradeData = useMemo(() => {
    return trades.map((t, i) => ({
      i,
      pnl: t.pnl_pct,
      side: t.side,
    }));
  }, [trades]);

  const radarData = useMemo(() => {
    if (!longStats || !shortStats) return [];
    const maxVal = (key: keyof SideStats) => Math.max(
      Math.abs((longStats[key] as number) ?? 0),
      Math.abs((shortStats[key] as number) ?? 0),
      0.0001,
    );
    const norm = (val: number, max: number) => Math.min(100, (Math.abs(val) / max) * 100);
    return [
      { metric: "Win Rate", long: norm(longStats.winRate, 100), short: norm(shortStats.winRate, 100) },
      { metric: "Avg Win", long: norm(longStats.avgWin, maxVal("avgWin")), short: norm(shortStats.avgWin, maxVal("avgWin")) },
      { metric: "Profit Factor", long: norm(Math.min(longStats.profitFactor, 5), 5), short: norm(Math.min(shortStats.profitFactor, 5), 5) },
      { metric: "Avg Duration (inv)", long: 100 - norm(longStats.avgDuration, maxVal("avgDuration")), short: 100 - norm(shortStats.avgDuration, maxVal("avgDuration")) },
      { metric: "Total PnL", long: norm(longStats.totalPnl, maxVal("totalPnl")), short: norm(shortStats.totalPnl, maxVal("totalPnl")) },
      { metric: "Count", long: norm(longStats.count, maxVal("count")), short: norm(shortStats.count, maxVal("count")) },
    ];
  }, [longStats, shortStats]);

  const monthlyData = useMemo(() => {
    const byMonth: Record<string, { long: number; short: number }> = {};
    for (const t of trades) {
      const d = new Date(t.exit_time);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      if (!byMonth[key]) byMonth[key] = { long: 0, short: 0 };
      byMonth[key][t.side] += t.pnl_pct;
    }
    return Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v }));
  }, [trades]);

  if (trades.length === 0) {
    return <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">No trades to analyze.</div>;
  }

  const hasLong = longStats !== null;
  const hasShort = shortStats !== null;

  return (
    <div className="space-y-5">
      {/* Side comparison table */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 overflow-x-auto">
        <h4 className="text-sm font-semibold text-zinc-300 mb-3">Long vs. Short Performance</h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-zinc-500 border-b border-zinc-800">
              <th className="text-left pb-2 font-normal">Metric</th>
              <th className="text-right pb-2 font-normal text-emerald-400">Long</th>
              <th className="text-right pb-2 font-normal text-red-400">Short</th>
            </tr>
          </thead>
          <tbody>
            {STAT_LABELS.map(({ key, label, format }) => {
              const lv = hasLong ? (longStats[key as keyof SideStats] as number) : null;
              const sv = hasShort ? (shortStats[key as keyof SideStats] as number) : null;
              const lBetter = lv != null && sv != null ? lv > sv : null;
              return (
                <tr key={key} className="border-b border-zinc-800/50">
                  <td className="py-1.5 text-zinc-400">{label}</td>
                  <td className={`py-1.5 text-right font-mono ${lBetter === true ? "text-emerald-400 font-semibold" : "text-zinc-300"}`}>
                    {lv != null ? format(lv) : "—"}
                  </td>
                  <td className={`py-1.5 text-right font-mono ${lBetter === false ? "text-red-300 font-semibold" : "text-zinc-300"}`}>
                    {sv != null ? format(sv) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary verdict */}
      {hasLong && hasShort && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-2">Summary</h4>
          <p className="text-xs text-zinc-400">
            {longStats.totalPnl > shortStats.totalPnl
              ? `Long trades account for the majority of the strategy's PnL (+${longStats.totalPnl.toFixed(2)}% vs ${shortStats.totalPnl >= 0 ? "+" : ""}${shortStats.totalPnl.toFixed(2)}%).`
              : `Short trades outperform (+${shortStats.totalPnl.toFixed(2)}% vs ${longStats.totalPnl >= 0 ? "+" : ""}${longStats.totalPnl.toFixed(2)}%).`}
            {" "}
            {longStats.winRate > shortStats.winRate
              ? `Longs have a higher win rate (${longStats.winRate.toFixed(1)}% vs ${shortStats.winRate.toFixed(1)}%).`
              : `Shorts have a higher win rate (${shortStats.winRate.toFixed(1)}% vs ${longStats.winRate.toFixed(1)}%).`}
          </p>
        </div>
      )}

      {/* Radar comparison */}
      {radarData.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-3">Performance Radar</h4>
          <ResponsiveContainer width="100%" height={260}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#27272a" />
              <PolarAngleAxis dataKey="metric" tick={{ fill: "#71717a", fontSize: 10 }} />
              <Radar name="Long" dataKey="long" stroke="#22c55e" fill="#22c55e" fillOpacity={0.15} />
              <Radar name="Short" dataKey="short" stroke="#f87171" fill="#f87171" fillOpacity={0.15} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Monthly PnL by side */}
      {monthlyData.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-1">Monthly PnL by Side</h4>
          <p className="text-[10px] text-zinc-600 mb-3">Cumulative PnL% of long and short trades closed each month.</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthlyData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="month" tick={{ fill: "#71717a", fontSize: 9 }} />
              <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(0)}%`} />
              <Tooltip
                content={({ payload, label }) => {
                  if (!payload?.length) return null;
                  return (
                    <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                      <div style={{ color: "#a1a1aa", marginBottom: 4 }}>{label}</div>
                      {payload.map((p, i) => {
                        const v = typeof p.value === "number" ? p.value : Number(p.value ?? 0);
                        return (
                          <div key={i} style={{ color: p.color }}>
                            {String(p.name)}: {v >= 0 ? "+" : ""}{v.toFixed(2)}%
                          </div>
                        );
                      })}
                    </div>
                  );
                }}
              />
              <Bar dataKey="long" name="Long" stackId="a" fill="#22c55e" fillOpacity={0.8} radius={[0, 0, 0, 0]} />
              <Bar dataKey="short" name="Short" stackId="b" fill="#f87171" fillOpacity={0.8} radius={[2, 2, 0, 0]} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Per-trade PnL scatter */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">PnL per Trade (colored by side)</h4>
        <p className="text-[10px] text-zinc-600 mb-3">Green = long, red = short. Bars above zero line are winners.</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={pnlByTradeData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="i" hide />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(1)}%`} />
            <ReferenceLine y={0} stroke="#52525b" />
            <Bar dataKey="pnl" isAnimationActive={false} maxBarSize={8}>
              {pnlByTradeData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.side === "long" ? (entry.pnl >= 0 ? "#22c55e" : "#86efac40") : (entry.pnl >= 0 ? "#f87171" : "#ef444440")}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
