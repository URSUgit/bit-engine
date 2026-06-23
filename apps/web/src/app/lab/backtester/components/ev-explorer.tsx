"use client";

import { useMemo } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, ReferenceLine, Tooltip,
} from "recharts";

const WIN_RATES = [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70];
const RR_RATIOS = [0.50, 0.75, 1.00, 1.25, 1.50, 2.00, 2.50, 3.00];

function evCellStyle(ev: number): { background: string; color: string } {
  if (ev > 0.3) return { background: "#14532d", color: "#86efac" };
  if (ev > 0.15) return { background: "#166534", color: "#86efac" };
  if (ev > 0.05) return { background: "#15803d", color: "#bbf7d0" };
  if (ev > 0) return { background: "#166534aa", color: "#d1fae5" };
  if (ev > -0.05) return { background: "#7f1d1daa", color: "#fecaca" };
  if (ev > -0.15) return { background: "#991b1b", color: "#fca5a5" };
  return { background: "#7f1d1d", color: "#fca5a5" };
}

export function EvExplorer({ result }: { result: BacktestResult }) {
  const { metrics, trades } = result;

  const winRate = (metrics.win_rate ?? 50) / 100;
  const avgWin = Math.abs(metrics.avg_win_pct ?? 2);
  const avgLoss = Math.abs(metrics.avg_loss_pct ?? 1);
  const rrRatio = avgLoss > 0 ? avgWin / avgLoss : 1;
  const evPerTrade = winRate * avgWin - (1 - winRate) * avgLoss;

  const kellyF = useMemo(() => {
    if (avgLoss === 0) return 0;
    return Math.max(0, winRate - (1 - winRate) / rrRatio) * 100;
  }, [winRate, rrRatio, avgLoss]);

  const tradePnls = useMemo(() => trades.map((t) => t.pnl_pct), [trades]);
  const tradeStd = useMemo(() => {
    if (tradePnls.length < 2) return 1;
    const mean = tradePnls.reduce((a, b) => a + b, 0) / tradePnls.length;
    const variance = tradePnls.reduce((a, b) => a + (b - mean) ** 2, 0) / (tradePnls.length - 1);
    return Math.sqrt(variance);
  }, [tradePnls]);

  const edge = Math.max(0.01, evPerTrade);
  const tradesToSignificance = Math.ceil(((1.96 * tradeStd) / edge) ** 2);

  // Break-even win rate curve
  const breakEvenCurve = useMemo(() => {
    return Array.from({ length: 50 }, (_, i) => {
      const rr = 0.1 + i * (5.0 - 0.1) / 49;
      return { rr: parseFloat(rr.toFixed(2)), breakevenWR: (1 / (1 + rr)) * 100 };
    });
  }, []);

  // Kelly curve (varying win rate at fixed R:R)
  const kellyCurve = useMemo(() => {
    return Array.from({ length: 51 }, (_, i) => {
      const wr = 0.30 + i * (0.80 - 0.30) / 50;
      const f = Math.max(0, wr - (1 - wr) / rrRatio) * 100;
      return { wr: parseFloat((wr * 100).toFixed(1)), kelly: f };
    });
  }, [rrRatio]);

  // Significance curve (trades needed vs edge)
  const sigCurve = useMemo(() => {
    return Array.from({ length: 40 }, (_, i) => {
      const e = 0.1 + i * (2.0 - 0.1) / 39;
      const n = Math.min(10000, Math.ceil(((1.96 * tradeStd) / e) ** 2));
      return { edge: parseFloat(e.toFixed(2)), tradesNeeded: n };
    });
  }, [tradeStd]);

  const closestWRIdx = WIN_RATES.reduce((best, wr, i) => Math.abs(wr - winRate) < Math.abs(WIN_RATES[best]! - winRate) ? i : best, 0);
  const closestRRIdx = RR_RATIOS.reduce((best, rr, i) => Math.abs(rr - rrRatio) < Math.abs(RR_RATIOS[best]! - rrRatio) ? i : best, 0);

  if (trades.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">
        Run a backtest to explore expected value scenarios
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "EV per Trade", value: `${evPerTrade >= 0 ? "+" : ""}${evPerTrade.toFixed(3)}%`, color: evPerTrade >= 0 ? "text-emerald-400" : "text-red-400" },
          { label: "R:R Ratio", value: rrRatio.toFixed(2), color: "text-amber-400" },
          { label: "Full Kelly F", value: `${kellyF.toFixed(1)}%`, color: "text-cyan-400" },
          { label: "Trades to Significance", value: tradesToSignificance >= 10000 ? "10000+" : tradesToSignificance.toString(), color: "text-zinc-300" },
        ].map((c) => (
          <div key={c.label} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
            <div className={`text-xl font-bold font-mono ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* EV Heatmap */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">Expected Value Heatmap (Win Rate × R:R)</h4>
        <p className="text-[10px] text-zinc-600 mb-3">
          EV = WR × RR − (1−WR) × 1.0. Highlighted cell = your strategy (WR={`${(winRate * 100).toFixed(0)}%`}, R:R={rrRatio.toFixed(2)}).
        </p>
        <div className="overflow-x-auto">
          <table className="text-[11px] border-separate" style={{ borderSpacing: "2px" }}>
            <thead>
              <tr>
                <th className="text-left text-zinc-500 font-normal pr-2 pb-1">R:R ↓ / WR →</th>
                {WIN_RATES.map((wr) => (
                  <th key={wr} className="text-center text-zinc-500 font-normal px-1 pb-1 w-14">
                    {(wr * 100).toFixed(0)}%
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RR_RATIOS.map((rr, ri) => (
                <tr key={rr}>
                  <td className="text-zinc-500 pr-2 font-mono">{rr.toFixed(2)}x</td>
                  {WIN_RATES.map((wr, wi) => {
                    const ev = wr * rr - (1 - wr) * 1.0;
                    const style = evCellStyle(ev);
                    const isHighlighted = wi === closestWRIdx && ri === closestRRIdx;
                    return (
                      <td key={wr} className="text-center font-mono py-0.5 px-0.5">
                        <div
                          style={{
                            ...style,
                            borderRadius: 4,
                            padding: "2px 4px",
                            outline: isHighlighted ? "2px solid #f59e0b" : "none",
                            fontWeight: isHighlighted ? 700 : 400,
                          }}
                        >
                          {ev >= 0 ? "+" : ""}{ev.toFixed(2)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-zinc-600 mt-2">
          Your strategy: WR={`${(winRate * 100).toFixed(1)}%`}, R:R={rrRatio.toFixed(2)}, EV={evPerTrade >= 0 ? "+" : ""}{evPerTrade.toFixed(3)}% per trade
        </p>
      </div>

      {/* Break-even WR curve */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">Break-Even Win Rate Curve</h4>
        <p className="text-[10px] text-zinc-600 mb-3">Minimum win rate required to be profitable at each R:R. Your strategy is marked.</p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={breakEvenCurve} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="rr" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${v}x`} label={{ value: "R:R", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }} />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} domain={[0, 100]} />
            <ReferenceLine x={parseFloat(rrRatio.toFixed(2))} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: "Your R:R", fill: "#f59e0b", fontSize: 9, position: "top" }} />
            <ReferenceLine y={winRate * 100} stroke="#a78bfa" strokeDasharray="3 3" label={{ value: "Your WR", fill: "#a78bfa", fontSize: 9, position: "right" }} />
            <Tooltip
              content={({ payload, label }) => {
                if (!payload?.length) return null;
                const v = payload[0]?.value;
                return (
                  <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: "#a1a1aa" }}>R:R: {label}x</div>
                    <div style={{ color: "#f59e0b" }}>Min WR: {typeof v === "number" ? v.toFixed(1) : "0"}%</div>
                  </div>
                );
              }}
            />
            <Line type="monotone" dataKey="breakevenWR" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Kelly curve */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-1">Kelly Fraction vs. Win Rate</h4>
          <p className="text-[10px] text-zinc-600 mb-3">Optimal position size at fixed R:R={rrRatio.toFixed(2)}.</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={kellyCurve} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="wr" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
              <ReferenceLine x={parseFloat((winRate * 100).toFixed(1))} stroke="#06b6d4" strokeDasharray="3 3" />
              <ReferenceLine y={kellyF / 2} stroke="#52525b" strokeDasharray="2 2" label={{ value: "½F", fill: "#52525b", fontSize: 9, position: "right" }} />
              <Tooltip
                content={({ payload, label }) => {
                  if (!payload?.length) return null;
                  const v = payload[0]?.value;
                  return (
                    <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                      <div style={{ color: "#a1a1aa" }}>WR: {label}%</div>
                      <div style={{ color: "#06b6d4" }}>Kelly: {typeof v === "number" ? v.toFixed(1) : "0"}%</div>
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="kelly" stroke="#06b6d4" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-zinc-600 mt-2">
            Full Kelly: {kellyF.toFixed(1)}% | Half Kelly: {(kellyF / 2).toFixed(1)}% | Quarter Kelly: {(kellyF / 4).toFixed(1)}%
          </p>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-1">Trades Required for Significance</h4>
          <p className="text-[10px] text-zinc-600 mb-3">95% CI (z=1.96). Your {trades.length} trades marked.</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={sigCurve} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="edge" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${v}%`} label={{ value: "Edge %", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }} />
              <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => Number(v) >= 10000 ? "10k+" : String(Number(v))} />
              <ReferenceLine y={trades.length} stroke="#22c55e" strokeDasharray="3 3" label={{ value: `${trades.length} trades`, fill: "#22c55e", fontSize: 9, position: "right" }} />
              <Tooltip
                content={({ payload, label }) => {
                  if (!payload?.length) return null;
                  const v = payload[0]?.value;
                  return (
                    <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                      <div style={{ color: "#a1a1aa" }}>Edge: {label}%</div>
                      <div style={{ color: "#a78bfa" }}>Need: {typeof v === "number" && v >= 10000 ? "10000+" : v} trades</div>
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="tradesNeeded" stroke="#a78bfa" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
