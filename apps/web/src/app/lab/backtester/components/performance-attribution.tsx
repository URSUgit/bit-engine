"use client";

import { useMemo } from "react";
import type { BacktestResult, Trade } from "@/lib/backtest-api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ScatterChart, Scatter,
} from "recharts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pnlColor(pnl: number): string {
  if (pnl > 2) return "#4ade80";
  if (pnl > 0) return "#86efac";
  if (pnl > -2) return "#fca5a5";
  return "#f87171";
}

type BucketStats = { label: string; total_pnl: number; avg_pnl: number; win_rate: number; count: number };

function bucketTrades(trades: Trade[], keyFn: (t: Trade) => string, labels: string[]): BucketStats[] {
  const map = new Map<string, { total: number; wins: number; count: number }>();
  for (const lbl of labels) map.set(lbl, { total: 0, wins: 0, count: 0 });

  for (const t of trades) {
    const k = keyFn(t);
    const b = map.get(k);
    if (!b) continue;
    b.total += t.pnl_pct;
    b.count++;
    if (t.pnl > 0) b.wins++;
  }

  return labels.map((lbl) => {
    const b = map.get(lbl)!;
    return {
      label: lbl,
      total_pnl: Math.round(b.total * 100) / 100,
      avg_pnl: b.count > 0 ? Math.round((b.total / b.count) * 100) / 100 : 0,
      win_rate: b.count > 0 ? Math.round((b.wins / b.count) * 1000) / 10 : 0,
      count: b.count,
    };
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AttributionBar({
  data, title, xKey, metric,
}: {
  data: BucketStats[];
  title: string;
  xKey: "label";
  metric: "avg_pnl" | "total_pnl" | "win_rate";
}) {
  const metricLabel = metric === "avg_pnl" ? "Avg P&L %" : metric === "total_pnl" ? "Total P&L %" : "Win Rate %";

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-zinc-300 mb-3">{title}</h4>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey={xKey} tick={{ fill: "#71717a", fontSize: 11 }} />
          <YAxis tick={{ fill: "#71717a", fontSize: 10 }} />
          <Tooltip
            contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6 }}
            labelStyle={{ color: "#a1a1aa" }}
            formatter={(v) => [
              typeof v === "number" ? `${v.toFixed(2)}${metric === "win_rate" ? "%" : "%"}` : String(v),
              metricLabel,
            ]}
          />
          <Bar dataKey={metric} radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={pnlColor(d.avg_pnl)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function DurationScatter({ trades }: { trades: Trade[] }) {
  const points = trades.map((t) => ({
    x: t.duration_bars,
    y: t.pnl_pct,
    pnl: t.pnl,
  })).slice(0, 300); // cap for performance

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-zinc-300 mb-3">P&L% vs Trade Duration (bars)</h4>
      <ResponsiveContainer width="100%" height={180}>
        <ScatterChart margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="x" name="Duration" tick={{ fill: "#71717a", fontSize: 10 }} label={{ value: "bars", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }} />
          <YAxis dataKey="y" name="P&L %" tick={{ fill: "#71717a", fontSize: 10 }} />
          <Tooltip
            contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6 }}
            formatter={(v, name) => [
              typeof v === "number" ? v.toFixed(2) : String(v),
              name === "x" ? "Duration (bars)" : "P&L %",
            ]}
          />
          <Scatter data={points} shape={(props) => {
            const p = props as unknown as { cx: number; cy: number; payload: { pnl: number } };
            const win = p.payload.pnl > 0;
            return <circle cx={p.cx} cy={p.cy} r={3} fill={win ? "rgba(74,222,128,0.7)" : "rgba(248,113,113,0.7)"} />;
          }} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function HoldingDistribution({ trades }: { trades: Trade[] }) {
  const buckets = useMemo(() => {
    const edges = [0, 1, 2, 5, 10, 20, 50, 100, Infinity];
    const labels = ["<1", "1", "2-4", "5-9", "10-19", "20-49", "50-99", "100+"];
    const counts = new Array(labels.length).fill(0);
    const pnls = new Array(labels.length).fill(0);
    for (const t of trades) {
      const d = t.duration_bars;
      for (let i = 0; i < edges.length - 1; i++) {
        if (d >= edges[i] && d < edges[i + 1]) { counts[i]++; pnls[i] += t.pnl_pct; break; }
      }
    }
    return labels.map((lbl, i) => ({
      label: lbl,
      count: counts[i],
      avg_pnl: counts[i] > 0 ? Math.round(pnls[i] / counts[i] * 100) / 100 : 0,
    }));
  }, [trades]);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-zinc-300 mb-3">Avg P&L% by Holding Period (bars)</h4>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={buckets} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 11 }} />
          <YAxis tick={{ fill: "#71717a", fontSize: 10 }} />
          <Tooltip
            contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6 }}
            formatter={(v) => [
              typeof v === "number" ? `${v.toFixed(2)}%` : String(v),
              "Avg P&L %",
            ]}
          />
          <Bar dataKey="avg_pnl" radius={[2, 2, 0, 0]}>
            {buckets.map((d, i) => (
              <Cell key={i} fill={pnlColor(d.avg_pnl)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TopTradesTable({ trades, mode }: { trades: Trade[]; mode: "best" | "worst" }) {
  const sorted = [...trades].sort((a, b) => mode === "best" ? b.pnl_pct - a.pnl_pct : a.pnl_pct - b.pnl_pct).slice(0, 5);
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-zinc-300 mb-3">{mode === "best" ? "🏆 Top 5 Best Trades" : "⚠️ Top 5 Worst Trades"}</h4>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-zinc-500 border-b border-zinc-800">
            <th className="text-left pb-1.5">Entry</th>
            <th className="text-right pb-1.5">Duration</th>
            <th className="text-right pb-1.5">P&L %</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t, i) => (
            <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition">
              <td className="py-1.5 text-zinc-400">{t.entry_time.slice(0, 10)}</td>
              <td className="py-1.5 text-right text-zinc-400">{t.duration_bars}b</td>
              <td className={`py-1.5 text-right font-medium ${t.pnl_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {t.pnl_pct >= 0 ? "+" : ""}{t.pnl_pct.toFixed(2)}%
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={3} className="py-4 text-center text-zinc-600">No trades</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PerformanceAttribution({ result }: { result: BacktestResult }) {
  const trades = result.trades;

  const byDow = useMemo(() => {
    return bucketTrades(
      trades,
      (t) => DAYS[new Date(t.entry_time).getDay()],
      DAYS,
    );
  }, [trades]);

  const byMonth = useMemo(() => {
    return bucketTrades(
      trades,
      (t) => MONTHS[new Date(t.entry_time).getMonth()],
      MONTHS,
    );
  }, [trades]);

  const byHour = useMemo(() => {
    const labels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0") + "h");
    return bucketTrades(
      trades,
      (t) => String(new Date(t.entry_time).getHours()).padStart(2, "0") + "h",
      labels,
    );
  }, [trades]);

  const byQuarter = useMemo(() => {
    return bucketTrades(
      trades,
      (t) => `Q${Math.floor(new Date(t.entry_time).getMonth() / 3) + 1}`,
      ["Q1", "Q2", "Q3", "Q4"],
    );
  }, [trades]);

  if (trades.length === 0) {
    return (
      <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-lg p-10 text-center text-zinc-500">
        No trades to analyse.
      </div>
    );
  }

  const hasHourData = trades.some((t) => {
    const h = new Date(t.entry_time).getHours();
    return h > 0;
  });

  // Summary stats
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl_pct, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl_pct, 0) / losses.length : 0;
  const expectancy = (wins.length / trades.length) * avgWin + (losses.length / trades.length) * avgLoss;
  const avgDuration = trades.reduce((s, t) => s + t.duration_bars, 0) / trades.length;

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total P&L", value: `$${totalPnl.toFixed(2)}`, color: totalPnl >= 0 ? "text-emerald-400" : "text-red-400" },
          { label: "Expectancy", value: `${expectancy >= 0 ? "+" : ""}${expectancy.toFixed(3)}%`, color: expectancy >= 0 ? "text-emerald-400" : "text-red-400" },
          { label: "Avg Win / Loss", value: `+${avgWin.toFixed(2)}% / ${avgLoss.toFixed(2)}%`, color: "text-zinc-200" },
          { label: "Avg Duration", value: `${avgDuration.toFixed(1)} bars`, color: "text-zinc-200" },
        ].map((s) => (
          <div key={s.label} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">{s.label}</div>
            <div className={`text-sm font-semibold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Day-of-week + Quarter */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AttributionBar data={byDow} title="Avg P&L% by Day of Week (entry)" xKey="label" metric="avg_pnl" />
        <AttributionBar data={byQuarter} title="Avg P&L% by Quarter (entry)" xKey="label" metric="avg_pnl" />
      </div>

      {/* Monthly */}
      <AttributionBar data={byMonth} title="Avg P&L% by Month (entry)" xKey="label" metric="avg_pnl" />

      {/* Hour of day — only meaningful for intraday */}
      {hasHourData && (
        <AttributionBar data={byHour} title="Avg P&L% by Hour of Day (entry, UTC)" xKey="label" metric="avg_pnl" />
      )}

      {/* Duration scatter + holding histogram */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DurationScatter trades={trades} />
        <HoldingDistribution trades={trades} />
      </div>

      {/* Best / worst */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TopTradesTable trades={trades} mode="best" />
        <TopTradesTable trades={trades} mode="worst" />
      </div>
    </div>
  );
}
