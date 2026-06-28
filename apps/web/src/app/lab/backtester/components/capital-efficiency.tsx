"use client";

import { useMemo } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, ReferenceLine,
  BarChart, Bar, Cell,
} from "recharts";

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function CapitalEfficiency({ result }: { result: BacktestResult }) {
  const { trades, equity_curve, metrics } = result;

  // Time-in-market: % of bars where a position was open
  const inMarket = useMemo(() => {
    if (!equity_curve || equity_curve.length < 2) return null;
    const totalBars = equity_curve.length;
    // A bar is "in market" if it falls between entry_time and exit_time of any trade
    const intervals = trades.map((t) => [
      new Date(t.entry_time).getTime() / 1000,
      new Date(t.exit_time).getTime() / 1000,
    ]);
    let inCount = 0;
    for (const pt of equity_curve) {
      const inAny = intervals.some(([a, b]) => pt.t >= a && pt.t <= b);
      if (inAny) inCount++;
    }
    return { pct: (inCount / totalBars) * 100, inCount, totalBars };
  }, [equity_curve, trades]);

  // Active PnL only: sum PnL of active bars
  const annReturn = metrics.cagr_pct ?? metrics.total_return_pct ?? 0;
  const inMarketPct = inMarket?.pct ?? 100;
  const capitalUtilization = inMarketPct;
  // Annualized PnL per % of time in market = measure of how productively capital is deployed
  const capitalEfficiencyRatio = inMarketPct > 0 ? annReturn / (inMarketPct / 100) : 0;

  // Monthly capital deployment: trades per month
  const monthlyDeployment = useMemo(() => {
    const map: Record<string, { trades: number; pnl: number }> = {};
    for (const t of trades) {
      const dt = new Date(t.entry_time);
      const k = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
      if (!map[k]) map[k] = { trades: 0, pnl: 0 };
      map[k].trades++;
      map[k].pnl += t.pnl_pct;
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, ...v }));
  }, [trades]);

  // Drawdown-adjusted return: return / max_drawdown (Calmar-like)
  const maxDD = Math.abs(metrics.max_drawdown_pct ?? 0);
  const calmar = maxDD > 0 ? annReturn / maxDD : 0;

  // Idle periods: gaps between trades > 5 bars
  const idlePeriods = useMemo(() => {
    if (trades.length < 2) return [];
    const periods: { start: number; end: number; days: number }[] = [];
    for (let i = 1; i < trades.length; i++) {
      const prevExit = new Date(trades[i - 1].exit_time).getTime();
      const nextEntry = new Date(trades[i].entry_time).getTime();
      const days = (nextEntry - prevExit) / (1000 * 60 * 60 * 24);
      if (days > 1) {
        periods.push({ start: prevExit / 1000, end: nextEntry / 1000, days });
      }
    }
    return periods.sort((a, b) => b.days - a.days).slice(0, 10);
  }, [trades]);

  const avgIdleDays = idlePeriods.length > 0
    ? idlePeriods.reduce((s, p) => s + p.days, 0) / idlePeriods.length
    : 0;

  // Equity curve resampled for chart
  const equitySample = useMemo(() => {
    if (!equity_curve) return [];
    const step = Math.max(1, Math.floor(equity_curve.length / 200));
    return equity_curve.filter((_, i) => i % step === 0).map((pt) => ({
      t: pt.t,
      equity: pt.equity,
      dd: -pt.drawdown_pct,
    }));
  }, [equity_curve]);

  if (trades.length === 0) {
    return <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">No trades to analyze.</div>;
  }

  return (
    <div className="space-y-5">
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Time in Market",
            value: `${capitalUtilization.toFixed(1)}%`,
            color: capitalUtilization > 80 ? "text-amber-400" : capitalUtilization > 40 ? "text-emerald-400" : "text-zinc-300",
            note: capitalUtilization > 80 ? "High exposure" : capitalUtilization < 20 ? "Low utilization" : "Balanced",
          },
          {
            label: "Capital Efficiency",
            value: `${capitalEfficiencyRatio.toFixed(1)}×`,
            color: capitalEfficiencyRatio > 2 ? "text-emerald-400" : capitalEfficiencyRatio > 0 ? "text-amber-400" : "text-red-400",
            note: "Ann. return / % time deployed",
          },
          {
            label: "Calmar Ratio",
            value: calmar.toFixed(2),
            color: calmar > 1 ? "text-emerald-400" : calmar > 0.5 ? "text-amber-400" : "text-red-400",
            note: "Ann. return / max DD",
          },
          {
            label: "Avg Idle Period",
            value: `${avgIdleDays.toFixed(1)}d`,
            color: "text-zinc-300",
            note: `${idlePeriods.length} gaps found`,
          },
        ].map((c) => (
          <div key={c.label} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
            <div className={`text-xl font-bold font-mono ${c.color}`}>{c.value}</div>
            <div className="text-[10px] text-zinc-600 mt-1">{c.note}</div>
          </div>
        ))}
      </div>

      {/* Equity + drawdown overlay */}
      {equitySample.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-1">Equity & Drawdown</h4>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={equitySample} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="t" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => formatDate(Number(v))} />
              <YAxis yAxisId="eq" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `$${Number(v).toFixed(0)}`} />
              <YAxis yAxisId="dd" orientation="right" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
              <Tooltip
                content={({ payload }) => {
                  if (!payload?.length) return null;
                  const d = payload[0]?.payload as { t: number; equity: number; dd: number } | undefined;
                  if (!d) return null;
                  return (
                    <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                      <div style={{ color: "#a1a1aa" }}>{formatDate(d.t)}</div>
                      <div style={{ color: "#22c55e" }}>Equity: ${d.equity.toFixed(0)}</div>
                      <div style={{ color: "#ef4444" }}>Drawdown: {d.dd.toFixed(1)}%</div>
                    </div>
                  );
                }}
              />
              <Area yAxisId="eq" type="monotone" dataKey="equity" stroke="#22c55e" fill="#22c55e" fillOpacity={0.1} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Area yAxisId="dd" type="monotone" dataKey="dd" stroke="#ef4444" fill="#ef4444" fillOpacity={0.15} strokeWidth={1} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Monthly deployment heatmap bar */}
      {monthlyDeployment.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-1">Monthly Trade Deployment</h4>
          <p className="text-[10px] text-zinc-600 mb-3">Number of trades per calendar month.</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={monthlyDeployment} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="month" tick={{ fill: "#71717a", fontSize: 9 }} />
              <YAxis tick={{ fill: "#71717a", fontSize: 10 }} allowDecimals={false} />
              <Tooltip
                content={({ payload, label }) => {
                  if (!payload?.length) return null;
                  const d = payload[0]?.payload as { month: string; trades: number; pnl: number } | undefined;
                  if (!d) return null;
                  return (
                    <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                      <div style={{ color: "#a1a1aa" }}>{label}</div>
                      <div style={{ color: "#71717a" }}>{d.trades} trades</div>
                      <div style={{ color: d.pnl >= 0 ? "#22c55e" : "#ef4444" }}>Net PnL: {d.pnl > 0 ? "+" : ""}{d.pnl.toFixed(2)}%</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="trades" name="Trades" isAnimationActive={false} maxBarSize={20}>
                {monthlyDeployment.map((d, i) => (
                  <Cell key={i} fill={d.pnl >= 0 ? "#22c55e" : "#ef4444"} fillOpacity={0.75} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Longest idle periods */}
      {idlePeriods.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-3">Longest Idle Periods (No Position)</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800">
                  <th className="text-left pb-2 font-normal">#</th>
                  <th className="text-left pb-2 font-normal">From</th>
                  <th className="text-left pb-2 font-normal">To</th>
                  <th className="text-right pb-2 font-normal">Idle Days</th>
                </tr>
              </thead>
              <tbody>
                {idlePeriods.map((p, i) => (
                  <tr key={i} className="border-b border-zinc-800/50">
                    <td className="py-1.5 text-zinc-400">{i + 1}</td>
                    <td className="py-1.5 text-zinc-300">{formatDate(p.start)}</td>
                    <td className="py-1.5 text-zinc-300">{formatDate(p.end)}</td>
                    <td className="py-1.5 text-right font-mono text-amber-400">{p.days.toFixed(0)}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
