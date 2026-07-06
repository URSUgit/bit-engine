"use client";

import { useMemo, useState } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, ReferenceLine, Tooltip,
} from "recharts";

type EquitySegmentPoint = { t: number; equity: number; drawdown_pct: number; label: number; isEntry: boolean; isExit: boolean };

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtPrice(p: number): string {
  return p >= 1000 ? p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : p.toFixed(4);
}

export function TradeReplay({ result }: { result: BacktestResult }) {
  const { trades, equity_curve } = result;
  const [idx, setIdx] = useState(0);
  const [filterSide, setFilterSide] = useState<"all" | "long" | "short">("all");
  const [filterOutcome, setFilterOutcome] = useState<"all" | "win" | "loss">("all");

  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      if (filterSide !== "all" && t.side !== filterSide) return false;
      if (filterOutcome === "win" && t.pnl_pct <= 0) return false;
      if (filterOutcome === "loss" && t.pnl_pct > 0) return false;
      return true;
    });
  }, [trades, filterSide, filterOutcome]);

  const safeIdx = Math.min(idx, Math.max(0, filteredTrades.length - 1));
  const trade = filteredTrades[safeIdx];

  const equitySegment = useMemo((): EquitySegmentPoint[] => {
    if (!trade) return [];
    const entryMs = new Date(trade.entry_time).getTime();
    const exitMs = new Date(trade.exit_time).getTime();
    const sorted = [...equity_curve].sort((a, b) => a.t - b.t);
    const tradePoints = sorted.filter((p) => p.t >= entryMs && p.t <= exitMs);
    if (tradePoints.length === 0) {
      const closest = sorted.reduce((best, p) => Math.abs(p.t - entryMs) < Math.abs(best.t - entryMs) ? p : best, sorted[0] ?? { t: 0, equity: 0, drawdown_pct: 0 });
      return [{ ...closest, label: 0, isEntry: true, isExit: true }];
    }
    const entryIdx = sorted.findIndex((p) => p.t === tradePoints[0]?.t);
    const exitIdx = sorted.findIndex((p) => p.t === tradePoints[tradePoints.length - 1]?.t);
    const start = Math.max(0, entryIdx - 2);
    const end = Math.min(sorted.length - 1, exitIdx + 2);
    return sorted.slice(start, end + 1).map((p, i) => ({
      ...p,
      label: i,
      isEntry: p.t === tradePoints[0]?.t,
      isExit: p.t === tradePoints[tradePoints.length - 1]?.t,
    }));
  }, [trade, equity_curve]);

  const entryEquity = equitySegment.find((p) => p.isEntry)?.equity;
  const exitEquity = equitySegment.find((p) => p.isExit)?.equity;
  const equityGain = entryEquity != null && exitEquity != null ? ((exitEquity - entryEquity) / entryEquity) * 100 : null;

  const runningStats = useMemo(() => {
    if (safeIdx < 0) return null;
    const soFar = filteredTrades.slice(0, safeIdx + 1);
    const wins = soFar.filter((t) => t.pnl_pct > 0).length;
    const totalPnl = soFar.reduce((s, t) => s + t.pnl_pct, 0);
    return { wins, total: soFar.length, totalPnl, winRate: soFar.length > 0 ? (wins / soFar.length) * 100 : 0 };
  }, [filteredTrades, safeIdx]);

  if (trades.length === 0) {
    return <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">No trades to replay.</div>;
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
        <div className="flex gap-1">
          {(["all", "long", "short"] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setFilterSide(s); setIdx(0); }}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                filterSide === s ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {(["all", "win", "loss"] as const).map((o) => (
            <button
              key={o}
              onClick={() => { setFilterOutcome(o); setIdx(0); }}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                filterOutcome === o
                  ? o === "win" ? "bg-emerald-900/70 text-emerald-300" : o === "loss" ? "bg-red-900/70 text-red-300" : "bg-zinc-700 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {o.charAt(0).toUpperCase() + o.slice(1)}
            </button>
          ))}
        </div>
        <span className="text-xs text-zinc-500 ml-auto">{filteredTrades.length} trades</span>
      </div>

      {filteredTrades.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">No trades match filter.</div>
      ) : (
        <>
          {/* Navigation */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              disabled={safeIdx === 0}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 rounded text-sm text-zinc-300 transition-colors"
            >
              ← Prev
            </button>
            <span className="text-sm text-zinc-300 font-mono">
              Trade <span className="text-white font-bold">{safeIdx + 1}</span> / {filteredTrades.length}
            </span>
            <button
              onClick={() => setIdx((i) => Math.min(filteredTrades.length - 1, i + 1))}
              disabled={safeIdx === filteredTrades.length - 1}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 rounded text-sm text-zinc-300 transition-colors"
            >
              Next →
            </button>
            <input
              type="range"
              min={0}
              max={filteredTrades.length - 1}
              value={safeIdx}
              onChange={(e) => setIdx(Number(e.target.value))}
              className="flex-1 accent-amber-500 ml-2"
            />
          </div>

          {trade && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Trade details */}
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                    trade.side === "long" ? "bg-emerald-900/60 text-emerald-400" : "bg-red-900/60 text-red-400"
                  }`}>
                    {trade.side}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                    trade.pnl_pct > 0 ? "bg-emerald-900/40 text-emerald-400" : "bg-red-900/40 text-red-400"
                  }`}>
                    {trade.pnl_pct > 0 ? "WIN" : "LOSS"}
                  </span>
                  <span className="text-xs text-zinc-500 ml-auto">#{safeIdx + 1} of {filteredTrades.length}</span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    { label: "Entry Time", value: fmtTime(trade.entry_time), mono: false },
                    { label: "Exit Time", value: fmtTime(trade.exit_time), mono: false },
                    { label: "Entry Price", value: `$${fmtPrice(trade.entry_price)}`, mono: true },
                    { label: "Exit Price", value: `$${fmtPrice(trade.exit_price)}`, mono: true },
                    {
                      label: "PnL",
                      value: `${trade.pnl_pct >= 0 ? "+" : ""}${trade.pnl_pct.toFixed(3)}%`,
                      mono: true,
                      color: trade.pnl_pct >= 0 ? "text-emerald-400" : "text-red-400",
                    },
                    {
                      label: "PnL (USD)",
                      value: `${trade.pnl >= 0 ? "+" : ""}$${trade.pnl.toFixed(2)}`,
                      mono: true,
                      color: trade.pnl >= 0 ? "text-emerald-400" : "text-red-400",
                    },
                    { label: "Duration", value: `${trade.duration_bars} bars`, mono: true },
                    {
                      label: "Price Move",
                      value: `${((trade.exit_price - trade.entry_price) / trade.entry_price * 100).toFixed(3)}%`,
                      mono: true,
                      color: trade.exit_price > trade.entry_price ? "text-emerald-400" : "text-red-400",
                    },
                  ].map(({ label, value, mono, color }) => (
                    <div key={label}>
                      <div className="text-[10px] text-zinc-500 mb-0.5">{label}</div>
                      <div className={`${mono ? "font-mono" : ""} text-sm ${color ?? "text-zinc-300"}`}>{value}</div>
                    </div>
                  ))}
                </div>

                {runningStats && (
                  <div className="border-t border-zinc-800 pt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-zinc-500 mb-0.5">Running WR</div>
                      <div className="text-zinc-300 font-mono">{runningStats.winRate.toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-zinc-500 mb-0.5">Wins so far</div>
                      <div className="text-zinc-300 font-mono">{runningStats.wins}/{runningStats.total}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500 mb-0.5">Cumulative PnL</div>
                      <div className={`font-mono ${runningStats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {runningStats.totalPnl >= 0 ? "+" : ""}{runningStats.totalPnl.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Equity context chart */}
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
                <h4 className="text-xs font-semibold text-zinc-400 mb-2">
                  Equity Context
                  {equityGain != null && (
                    <span className={`ml-2 font-mono ${equityGain >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {equityGain >= 0 ? "+" : ""}{equityGain.toFixed(2)}%
                    </span>
                  )}
                </h4>
                {equitySegment.length > 1 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={equitySegment} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                      <XAxis dataKey="label" hide />
                      <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `$${Number(v).toFixed(0)}`} />
                      {equitySegment.find((p) => p.isEntry) && (
                        <ReferenceLine
                          x={equitySegment.findIndex((p) => p.isEntry)}
                          stroke="#22c55e"
                          strokeDasharray="4 2"
                          label={{ value: "Entry", fill: "#22c55e", fontSize: 9, position: "top" }}
                        />
                      )}
                      {equitySegment.find((p) => p.isExit) && (
                        <ReferenceLine
                          x={equitySegment.findIndex((p) => p.isExit)}
                          stroke={trade.pnl_pct >= 0 ? "#22c55e" : "#ef4444"}
                          strokeDasharray="4 2"
                          label={{ value: "Exit", fill: trade.pnl_pct >= 0 ? "#22c55e" : "#ef4444", fontSize: 9, position: "top" }}
                        />
                      )}
                      <Tooltip
                        content={({ payload }) => {
                          if (!payload?.length) return null;
                          const p = payload[0]?.payload as { equity: number; drawdown_pct: number; t: number } | undefined;
                          if (!p) return null;
                          return (
                            <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 11 }}>
                              <div style={{ color: "#a1a1aa" }}>{new Date(p.t).toLocaleString()}</div>
                              <div style={{ color: "#06b6d4" }}>Equity: ${p.equity.toFixed(2)}</div>
                              <div style={{ color: "#f59e0b" }}>DD: {p.drawdown_pct.toFixed(2)}%</div>
                            </div>
                          );
                        }}
                      />
                      <Line type="monotone" dataKey="equity" stroke="#06b6d4" strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-48 text-zinc-600 text-xs">
                    No equity curve data for this trade window
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Mini trade list for quick jump */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
            <h4 className="text-xs text-zinc-500 mb-2">Jump to trade</h4>
            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
              {filteredTrades.map((t, i) => (
                <button
                  key={i}
                  onClick={() => setIdx(i)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                    i === safeIdx
                      ? "bg-amber-600 text-white"
                      : t.pnl_pct > 0
                      ? "bg-emerald-900/40 text-emerald-400 hover:bg-emerald-900/70"
                      : "bg-red-900/40 text-red-400 hover:bg-red-900/70"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
