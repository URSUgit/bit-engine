"use client";

import { useMemo, useState } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, ReferenceLine, ZAxis,
  BarChart, Bar, Cell, Legend,
} from "recharts";

type ClusterDim = "hour" | "day_of_week" | "month" | "duration" | "size";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function bucket(trades: BacktestResult["trades"], dim: ClusterDim) {
  const bins: Record<string, { label: string; wins: number; losses: number; totalPnl: number; count: number }> = {};

  const key = (t: BacktestResult["trades"][number]): string => {
    const dt = new Date(t.entry_time);
    if (dim === "hour") return String(dt.getUTCHours());
    if (dim === "day_of_week") return String(dt.getUTCDay());
    if (dim === "month") return String(dt.getUTCMonth());
    if (dim === "duration") {
      const d = t.duration_bars;
      if (d <= 1) return "0";
      if (d <= 3) return "1";
      if (d <= 10) return "2";
      if (d <= 30) return "3";
      return "4";
    }
    // size: by pnl magnitude bucket
    const abs = Math.abs(t.pnl_pct);
    if (abs < 0.5) return "0";
    if (abs < 1) return "1";
    if (abs < 2) return "2";
    if (abs < 5) return "3";
    return "4";
  };

  const label = (k: string): string => {
    if (dim === "hour") return `${k}:00`;
    if (dim === "day_of_week") return DAYS[Number(k)] ?? k;
    if (dim === "month") return MONTHS[Number(k)] ?? k;
    if (dim === "duration") {
      return ["1 bar", "2-3 bars", "4-10 bars", "11-30 bars", "31+ bars"][Number(k)] ?? k;
    }
    return ["<0.5%", "0.5-1%", "1-2%", "2-5%", "5%+"][Number(k)] ?? k;
  };

  for (const t of trades) {
    const k = key(t);
    if (!bins[k]) bins[k] = { label: label(k), wins: 0, losses: 0, totalPnl: 0, count: 0 };
    bins[k].count++;
    bins[k].totalPnl += t.pnl_pct;
    if (t.pnl_pct > 0) bins[k].wins++; else bins[k].losses++;
  }

  return Object.entries(bins)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, v]) => ({
      ...v,
      winRate: v.count > 0 ? (v.wins / v.count) * 100 : 0,
      avgPnl: v.count > 0 ? v.totalPnl / v.count : 0,
    }));
}

function clusterColor(winRate: number, count: number, totalCount: number): string {
  if (count < totalCount * 0.03) return "#52525b"; // too few — grey out
  if (winRate >= 60) return "#22c55e";
  if (winRate >= 50) return "#84cc16";
  if (winRate >= 40) return "#f59e0b";
  return "#ef4444";
}

export function ClusterAnalysis({ result }: { result: BacktestResult }) {
  const { trades } = result;
  const [dim, setDim] = useState<ClusterDim>("hour");

  const data = useMemo(() => bucket(trades, dim), [trades, dim]);
  const totalCount = trades.length;

  // Scatter: duration (x) vs pnl_pct (y), colored by side
  const scatterData = useMemo(() => {
    return trades.map((t, i) => ({
      i,
      x: t.duration_bars,
      y: t.pnl_pct,
      side: t.side,
      size: Math.abs(t.pnl_pct) * 20 + 10,
    }));
  }, [trades]);

  const longScatter = scatterData.filter((d) => d.side === "long");
  const shortScatter = scatterData.filter((d) => d.side === "short");

  const dimLabels: { value: ClusterDim; label: string }[] = [
    { value: "hour", label: "Hour of Day" },
    { value: "day_of_week", label: "Day of Week" },
    { value: "month", label: "Month" },
    { value: "duration", label: "Trade Duration" },
    { value: "size", label: "Trade Size (PnL %)" },
  ];

  if (trades.length === 0) {
    return <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">No trades to analyze.</div>;
  }

  // Best / worst cluster
  const sorted = [...data].filter((d) => d.count >= totalCount * 0.05);
  const best = sorted.reduce((a, b) => (b.avgPnl > a.avgPnl ? b : a), sorted[0]);
  const worst = sorted.reduce((a, b) => (b.avgPnl < a.avgPnl ? b : a), sorted[0]);

  return (
    <div className="space-y-5">
      {/* Dim selector */}
      <div className="flex gap-2 flex-wrap">
        {dimLabels.map((d) => (
          <button
            key={d.value}
            onClick={() => setDim(d.value)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              dim === d.value
                ? "bg-indigo-600 border-indigo-500 text-white"
                : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Summary insight */}
      {best && worst && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-lg p-3">
            <div className="text-xs text-emerald-500 mb-1">Best Cluster ({dim.replace(/_/g, " ")})</div>
            <div className="text-lg font-bold font-mono text-emerald-400">{best.label}</div>
            <div className="text-xs text-zinc-400 mt-1">
              {best.count} trades · WR {best.winRate.toFixed(0)}% · Avg {best.avgPnl > 0 ? "+" : ""}{best.avgPnl.toFixed(2)}%
            </div>
          </div>
          <div className="bg-red-950/30 border border-red-800/40 rounded-lg p-3">
            <div className="text-xs text-red-500 mb-1">Worst Cluster ({dim.replace(/_/g, " ")})</div>
            <div className="text-lg font-bold font-mono text-red-400">{worst.label}</div>
            <div className="text-xs text-zinc-400 mt-1">
              {worst.count} trades · WR {worst.winRate.toFixed(0)}% · Avg {worst.avgPnl > 0 ? "+" : ""}{worst.avgPnl.toFixed(2)}%
            </div>
          </div>
        </div>
      )}

      {/* Win rate bar chart by cluster */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">Win Rate by {dimLabels.find((d) => d.value === dim)?.label}</h4>
        <p className="text-[10px] text-zinc-600 mb-3">Clusters with &lt;3% of trades are greyed out (low sample).</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 10 }} />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} domain={[0, 100]} />
            <ReferenceLine y={50} stroke="#71717a" strokeDasharray="4 2" />
            <Tooltip
              content={({ payload, label }) => {
                if (!payload?.length) return null;
                const d = payload[0]?.payload as { label: string; count: number; wins: number; losses: number; avgPnl: number; winRate: number } | undefined;
                if (!d) return null;
                return (
                  <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: "#a1a1aa", marginBottom: 4 }}>{label}</div>
                    <div style={{ color: "#71717a" }}>{d.count} trades</div>
                    <div style={{ color: "#22c55e" }}>Win rate: {d.winRate.toFixed(1)}%</div>
                    <div style={{ color: d.avgPnl >= 0 ? "#22c55e" : "#ef4444" }}>Avg PnL: {d.avgPnl > 0 ? "+" : ""}{d.avgPnl.toFixed(2)}%</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="winRate" name="Win Rate %" isAnimationActive={false} maxBarSize={40}>
              {data.map((d, i) => (
                <Cell key={i} fill={clusterColor(d.winRate, d.count, totalCount)} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Avg PnL bar chart */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">Average PnL % by {dimLabels.find((d) => d.value === dim)?.label}</h4>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 10 }} />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(2)}%`} />
            <ReferenceLine y={0} stroke="#71717a" />
            <Tooltip
              content={({ payload, label }) => {
                if (!payload?.length) return null;
                const v = payload[0]?.value as number | undefined;
                return (
                  <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: "#a1a1aa" }}>{label}</div>
                    <div style={{ color: (v ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                      Avg PnL: {(v ?? 0) > 0 ? "+" : ""}{(v ?? 0).toFixed(2)}%
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="avgPnl" name="Avg PnL %" isAnimationActive={false} maxBarSize={40}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.avgPnl >= 0 ? "#22c55e" : "#ef4444"} fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Scatter: duration vs pnl */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">Trade Duration vs PnL (Long / Short)</h4>
        <p className="text-[10px] text-zinc-600 mb-3">Each dot = one trade. Bubble size ∝ |PnL|.</p>
        <ResponsiveContainer width="100%" height={220}>
          <ScatterChart margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="x" type="number" name="Duration (bars)" tick={{ fill: "#71717a", fontSize: 10 }} label={{ value: "Duration (bars)", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }} />
            <YAxis dataKey="y" type="number" name="PnL %" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(1)}%`} />
            <ZAxis dataKey="size" range={[20, 200]} />
            <ReferenceLine y={0} stroke="#71717a" strokeDasharray="3 3" />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ payload }) => {
                if (!payload?.length) return null;
                const d = payload[0]?.payload as { i: number; x: number; y: number; side: string } | undefined;
                if (!d) return null;
                return (
                  <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: "#a1a1aa" }}>Trade #{d.i + 1} ({d.side})</div>
                    <div style={{ color: "#71717a" }}>Duration: {d.x} bars</div>
                    <div style={{ color: d.y >= 0 ? "#22c55e" : "#ef4444" }}>PnL: {d.y > 0 ? "+" : ""}{d.y.toFixed(2)}%</div>
                  </div>
                );
              }}
            />
            <Scatter name="Long" data={longScatter} fill="#22c55e" fillOpacity={0.6} />
            <Scatter name="Short" data={shortScatter} fill="#ef4444" fillOpacity={0.6} />
            <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
