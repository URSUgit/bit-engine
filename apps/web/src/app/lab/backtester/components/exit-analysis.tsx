"use client";

import { useMemo } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, ReferenceLine, Cell,
  BarChart, Bar,
} from "recharts";

type BucketStats = { label: string; avgPnl: number; count: number; avgDuration: number };

function bucket(pnl: number): string {
  if (pnl <= -5) return "< -5%";
  if (pnl <= -2) return "-5 to -2%";
  if (pnl <= 0) return "-2 to 0%";
  if (pnl <= 2) return "0 to +2%";
  if (pnl <= 5) return "+2 to +5%";
  return "> +5%";
}

const BUCKET_ORDER = ["< -5%", "-5 to -2%", "-2 to 0%", "0 to +2%", "+2 to +5%", "> +5%"];

export function ExitAnalysis({ result }: { result: BacktestResult }) {
  const { trades, equity_curve } = result;

  const tradeWithMfe = useMemo(() => {
    const sortedEq = [...equity_curve].sort((a, b) => a.t - b.t);
    return trades.map((t) => {
      const entryMs = new Date(t.entry_time).getTime();
      const exitMs = new Date(t.exit_time).getTime();
      const tradeEq = sortedEq.filter((p) => p.t >= entryMs && p.t <= exitMs);
      if (tradeEq.length === 0) return { ...t, mfe: t.pnl_pct, mae: t.pnl_pct, exitEfficiency: 100 };
      const entryEq = tradeEq[0]?.equity ?? 1;
      const maxEq = Math.max(...tradeEq.map((p) => p.equity));
      const minEq = Math.min(...tradeEq.map((p) => p.equity));
      const mfe = ((maxEq - entryEq) / entryEq) * 100 * (t.side === "long" ? 1 : -1);
      const mae = ((minEq - entryEq) / entryEq) * 100 * (t.side === "long" ? -1 : 1);
      const exitEfficiency = mfe > 0 ? Math.min(100, (t.pnl_pct / mfe) * 100) : 0;
      return { ...t, mfe, mae, exitEfficiency };
    });
  }, [trades, equity_curve]);

  const scatterData = useMemo(() => {
    return tradeWithMfe.map((t, i) => ({
      i,
      x: t.mfe,
      y: t.pnl_pct,
      side: t.side,
      leftOnTable: t.mfe - t.pnl_pct,
    }));
  }, [tradeWithMfe]);

  const avgExitEfficiency = useMemo(() => {
    const winners = tradeWithMfe.filter((t) => t.pnl_pct > 0 && t.mfe > 0);
    if (winners.length === 0) return 0;
    return winners.reduce((s, t) => s + t.exitEfficiency, 0) / winners.length;
  }, [tradeWithMfe]);

  const avgLeftOnTable = useMemo(() => {
    const winners = tradeWithMfe.filter((t) => t.mfe > t.pnl_pct);
    if (winners.length === 0) return 0;
    return winners.reduce((s, t) => s + (t.mfe - t.pnl_pct), 0) / winners.length;
  }, [tradeWithMfe]);

  const durationBuckets = useMemo((): BucketStats[] => {
    const map: Record<string, { sum: number; count: number; durSum: number }> = {};
    for (const t of trades) {
      const b = bucket(t.pnl_pct);
      if (!map[b]) map[b] = { sum: 0, count: 0, durSum: 0 };
      map[b]!.sum += t.pnl_pct;
      map[b]!.count++;
      map[b]!.durSum += t.duration_bars;
    }
    return BUCKET_ORDER.map((label) => ({
      label,
      avgPnl: map[label] ? map[label]!.sum / map[label]!.count : 0,
      count: map[label]?.count ?? 0,
      avgDuration: map[label] ? map[label]!.durSum / map[label]!.count : 0,
    }));
  }, [trades]);

  const exitTimingData = useMemo(() => {
    return tradeWithMfe.map((t, i) => ({
      i,
      leftOnTable: Math.max(0, t.mfe - t.pnl_pct),
      pnl: t.pnl_pct,
    }));
  }, [tradeWithMfe]);

  if (trades.length === 0) {
    return <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">No trades to analyze.</div>;
  }

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Exit Efficiency",
            value: `${avgExitEfficiency.toFixed(1)}%`,
            color: avgExitEfficiency >= 70 ? "text-emerald-400" : avgExitEfficiency >= 50 ? "text-amber-400" : "text-red-400",
            sub: "Avg (actual PnL / MFE) for winners",
          },
          {
            label: "Avg Left on Table",
            value: `${avgLeftOnTable.toFixed(2)}%`,
            color: avgLeftOnTable < 0.5 ? "text-emerald-400" : avgLeftOnTable < 2 ? "text-amber-400" : "text-red-400",
            sub: "Avg unrealized gain given up on exit",
          },
          {
            label: "Premature Exits",
            value: `${tradeWithMfe.filter((t) => t.pnl_pct > 0 && t.mfe > t.pnl_pct * 1.5).length}`,
            color: "text-zinc-300",
            sub: "Winners where MFE was 50%+ above exit",
          },
          {
            label: "Trades Analyzed",
            value: String(trades.length),
            color: "text-zinc-300",
            sub: "Using equity curve for MFE/MAE",
          },
        ].map((c) => (
          <div key={c.label} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
            <div className={`text-xl font-bold font-mono ${c.color}`}>{c.value}</div>
            <div className="text-[10px] text-zinc-600 mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* MFE vs Actual PnL scatter */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">MFE vs. Actual PnL</h4>
        <p className="text-[10px] text-zinc-600 mb-3">
          Points above the diagonal line left gains on the table. Points on/below the line = efficient exits.
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <ScatterChart margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="x" name="MFE" type="number" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(1)}%`} label={{ value: "MFE %", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }} />
            <YAxis dataKey="y" name="PnL" type="number" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(1)}%`} label={{ value: "Actual PnL %", angle: -90, position: "insideLeft", fill: "#52525b", fontSize: 10 }} />
            <ReferenceLine segment={[{ x: -10, y: -10 }, { x: 30, y: 30 }]} stroke="#52525b" strokeDasharray="4 2" label={{ value: "Perfect exit", fill: "#52525b", fontSize: 9 }} />
            <ReferenceLine y={0} stroke="#3f3f46" />
            <ReferenceLine x={0} stroke="#3f3f46" />
            <Tooltip
              content={({ payload }) => {
                if (!payload?.length) return null;
                const d = payload[0]?.payload as { i: number; x: number; y: number; leftOnTable: number; side: string } | undefined;
                if (!d) return null;
                return (
                  <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: "#a1a1aa" }}>Trade #{d.i + 1} ({d.side})</div>
                    <div style={{ color: "#06b6d4" }}>MFE: {d.x.toFixed(2)}%</div>
                    <div style={{ color: d.y >= 0 ? "#22c55e" : "#ef4444" }}>PnL: {d.y >= 0 ? "+" : ""}{d.y.toFixed(2)}%</div>
                    <div style={{ color: "#f59e0b" }}>Left on table: {d.leftOnTable.toFixed(2)}%</div>
                  </div>
                );
              }}
            />
            <Scatter data={scatterData} isAnimationActive={false}>
              {scatterData.map((d, i) => (
                <Cell key={i} fill={d.y >= 0 ? "#22c55e" : "#ef4444"} fillOpacity={0.7} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Left on table per trade */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">Unrealized Gains Left on Table</h4>
        <p className="text-[10px] text-zinc-600 mb-3">MFE − Actual exit PnL for each trade. Zero = perfect exit timing.</p>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={exitTimingData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="i" hide />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(1)}%`} />
            <Tooltip
              content={({ payload, label }) => {
                if (!payload?.length) return null;
                const lot = payload[0]?.value;
                const pnl = payload[1]?.value;
                return (
                  <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: "#a1a1aa" }}>Trade #{Number(label) + 1}</div>
                    <div style={{ color: "#f59e0b" }}>Left on table: {typeof lot === "number" ? lot.toFixed(2) : "0"}%</div>
                    <div style={{ color: typeof pnl === "number" && pnl >= 0 ? "#22c55e" : "#ef4444" }}>PnL: {typeof pnl === "number" ? (pnl >= 0 ? "+" : "") + pnl.toFixed(2) : "0"}%</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="leftOnTable" name="Left on Table" fill="#f59e0b" fillOpacity={0.7} isAnimationActive={false} maxBarSize={6} />
            <Bar dataKey="pnl" name="Actual PnL" isAnimationActive={false} maxBarSize={6}>
              {exitTimingData.map((d, i) => (
                <Cell key={i} fill={d.pnl >= 0 ? "#22c55e" : "#ef4444"} fillOpacity={0.6} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Duration by PnL bucket */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">Avg Trade Duration by PnL Outcome</h4>
        <p className="text-[10px] text-zinc-600 mb-3">Whether big losers are held too long or big winners are cut too short.</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={durationBuckets.filter((b) => b.count > 0)} margin={{ top: 4, right: 8, left: -10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 9 }} angle={-20} textAnchor="end" />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} label={{ value: "Bars", angle: -90, position: "insideLeft", fill: "#52525b", fontSize: 10 }} />
            <Tooltip
              content={({ payload, label }) => {
                if (!payload?.length) return null;
                const d = payload[0]?.value;
                const bkt = durationBuckets.find((b) => b.label === label);
                return (
                  <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: "#a1a1aa" }}>{label}</div>
                    <div style={{ color: "#06b6d4" }}>Avg duration: {typeof d === "number" ? d.toFixed(1) : "0"} bars</div>
                    {bkt && <div style={{ color: "#71717a" }}>{bkt.count} trades</div>}
                  </div>
                );
              }}
            />
            <Bar dataKey="avgDuration" name="Avg Duration (bars)" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {durationBuckets.map((b, i) => (
                <Cell key={i} fill={b.avgPnl >= 0 ? "#22c55e" : "#ef4444"} fillOpacity={0.75} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
