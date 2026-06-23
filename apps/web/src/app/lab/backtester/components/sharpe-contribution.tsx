"use client";

import { useMemo } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Cell, Tooltip, ComposedChart, Line, Area,
} from "recharts";

function rollingSharpeDelta(pnlPcts: number[]): number[] {
  const n = pnlPcts.length;
  if (n < 2) return pnlPcts.map(() => 0);
  const mean = pnlPcts.reduce((a, b) => a + b, 0) / n;
  const variance = pnlPcts.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return pnlPcts.map(() => 0);
  const fullSharpe = (mean / std) * Math.sqrt(252);

  return pnlPcts.map((_, i) => {
    const without = pnlPcts.filter((__, j) => j !== i);
    if (without.length < 2) return 0;
    const m2 = without.reduce((a, b) => a + b, 0) / without.length;
    const v2 = without.reduce((a, b) => a + (b - m2) ** 2, 0) / (without.length - 1);
    const s2 = Math.sqrt(v2);
    if (s2 === 0) return 0;
    const sharpeWithout = (m2 / s2) * Math.sqrt(252);
    return fullSharpe - sharpeWithout;
  });
}

export function SharpeContribution({ result }: { result: BacktestResult }) {
  const { trades, metrics } = result;

  const sharpeDeltas = useMemo(() => {
    const pnls = trades.map((t) => t.pnl_pct);
    return rollingSharpeDelta(pnls);
  }, [trades]);

  const tradeData = useMemo(() => {
    return trades.map((t, i) => ({
      i,
      pnl: t.pnl_pct,
      delta: sharpeDeltas[i] ?? 0,
      side: t.side,
      entry_time: t.entry_time,
    }));
  }, [trades, sharpeDeltas]);

  const sortedByImpact = useMemo(() => {
    return [...tradeData].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 20);
  }, [tradeData]);

  const rollingSharpeSeries = useMemo(() => {
    const pnls = trades.map((t) => t.pnl_pct);
    const window = Math.max(20, Math.floor(pnls.length / 10));
    return pnls.map((_, i) => {
      if (i < window - 1) return { i, sharpe: null };
      const slice = pnls.slice(i - window + 1, i + 1);
      const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
      const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (slice.length - 1));
      return { i, sharpe: std > 0 ? (mean / std) * Math.sqrt(252) : 0 };
    });
  }, [trades]);

  const topHelpers = sortedByImpact.filter((t) => t.delta > 0).slice(0, 5);
  const topHurters = sortedByImpact.filter((t) => t.delta < 0).slice(0, 5);

  const fullSharpe = metrics.sharpe_ratio ?? 0;

  if (trades.length < 10) {
    return <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">Need at least 10 trades for Sharpe contribution analysis.</div>;
  }

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Overall Sharpe", value: fullSharpe.toFixed(3), color: fullSharpe >= 1 ? "text-emerald-400" : fullSharpe >= 0 ? "text-amber-400" : "text-red-400" },
          { label: "Best Contributer", value: topHelpers[0] ? `+${topHelpers[0].delta.toFixed(3)}` : "—", color: "text-emerald-400" },
          { label: "Worst Hurter", value: topHurters[0] ? topHurters[0].delta.toFixed(3) : "—", color: "text-red-400" },
          { label: "Trades Analyzed", value: String(trades.length), color: "text-zinc-300" },
        ].map((c) => (
          <div key={c.label} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
            <div className={`text-xl font-bold font-mono ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Per-trade Sharpe delta */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">Sharpe Delta per Trade</h4>
        <p className="text-[10px] text-zinc-600 mb-3">
          How much the overall Sharpe ratio would change if this trade were removed (positive = trade improves Sharpe).
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={tradeData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="i" hide />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => Number(v).toFixed(2)} />
            <Tooltip
              content={({ payload, label }) => {
                if (!payload?.length) return null;
                const d = payload[0]?.payload as typeof tradeData[0] | undefined;
                if (!d) return null;
                const delta = typeof payload[0]?.value === "number" ? payload[0].value : 0;
                return (
                  <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: "#a1a1aa" }}>Trade #{Number(label) + 1}</div>
                    <div style={{ color: "#a1a1aa" }}>{d.entry_time?.slice(0, 10)}</div>
                    <div style={{ color: d.delta >= 0 ? "#22c55e" : "#ef4444" }}>Δ Sharpe: {delta >= 0 ? "+" : ""}{delta.toFixed(3)}</div>
                    <div style={{ color: d.pnl >= 0 ? "#22c55e" : "#ef4444" }}>PnL: {d.pnl >= 0 ? "+" : ""}{d.pnl.toFixed(2)}%</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="delta" isAnimationActive={false} maxBarSize={6}>
              {tradeData.map((d, i) => (
                <Cell key={i} fill={d.delta >= 0 ? "#22c55e" : "#ef4444"} fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Rolling Sharpe */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">Rolling Sharpe Ratio</h4>
        <p className="text-[10px] text-zinc-600 mb-3">
          Sharpe computed over a rolling {Math.max(20, Math.floor(trades.length / 10))}-trade window.
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={rollingSharpeSeries} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="i" hide />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => Number(v).toFixed(1)} />
            <Area type="monotone" dataKey="sharpe" stroke="none" fill="#22c55e20" isAnimationActive={false} />
            <Line type="monotone" dataKey="sharpe" stroke="#22c55e" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            <Tooltip
              content={({ payload, label }) => {
                if (!payload?.length) return null;
                const v = payload[0]?.value;
                return (
                  <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: "#a1a1aa" }}>Trade #{Number(label) + 1}</div>
                    <div style={{ color: "#22c55e" }}>Rolling Sharpe: {typeof v === "number" ? v.toFixed(3) : "—"}</div>
                  </div>
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Top helpers / hurters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { title: "Top 5 Sharpe Boosters", trades: topHelpers, color: "text-emerald-400", bg: "bg-emerald-950/20 border-emerald-800/30" },
          { title: "Top 5 Sharpe Detractors", trades: topHurters, color: "text-red-400", bg: "bg-red-950/20 border-red-800/30" },
        ].map(({ title, trades: grp, color, bg }) => (
          <div key={title} className={`rounded-lg border p-4 ${bg}`}>
            <h4 className={`text-sm font-semibold mb-3 ${color}`}>{title}</h4>
            {grp.length === 0 ? (
              <p className="text-xs text-zinc-500">None</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-zinc-500 border-b border-zinc-800">
                    <th className="text-left pb-1 font-normal">Trade #</th>
                    <th className="text-right pb-1 font-normal">PnL</th>
                    <th className="text-right pb-1 font-normal">Δ Sharpe</th>
                  </tr>
                </thead>
                <tbody>
                  {grp.map((t) => (
                    <tr key={t.i} className="border-b border-zinc-800/40">
                      <td className="py-1 text-zinc-400">#{t.i + 1} {t.entry_time?.slice(0, 10)}</td>
                      <td className={`py-1 text-right font-mono ${t.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(2)}%
                      </td>
                      <td className={`py-1 text-right font-mono ${t.delta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {t.delta >= 0 ? "+" : ""}{t.delta.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
