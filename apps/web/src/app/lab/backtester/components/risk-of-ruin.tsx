"use client";

import { useMemo, useState } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, ReferenceLine, ComposedChart, Area, Tooltip,
} from "recharts";

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo] ?? 0;
  return (sorted[lo] ?? 0) + (idx - lo) * ((sorted[hi] ?? 0) - (sorted[lo] ?? 0));
}

function runSimulation(
  pnlPcts: number[],
  nPaths: number,
  nTrades: number,
  positionSizePct: number,
): { ruinCurve: { threshold: number; prob: number }[]; maxDDs: number[]; fan: { x: number; p5: number; p25: number; p50: number; p75: number; p95: number }[] } {
  const n = pnlPcts.length;
  const SAMPLE_INTERVAL = Math.max(1, Math.floor(nTrades / 50));
  const fanPoints = Math.ceil(nTrades / SAMPLE_INTERVAL);

  const allPathEquity: number[][] = Array.from({ length: fanPoints }, () => []);
  const maxDDs: number[] = [];

  for (let path = 0; path < nPaths; path++) {
    let equity = 1.0;
    let peak = 1.0;
    let maxDD = 0;
    for (let trade = 0; trade < nTrades; trade++) {
      const sample = pnlPcts[Math.floor(Math.random() * n)]! / 100;
      const tradeReturn = (positionSizePct / 100) * sample;
      equity *= 1 + tradeReturn;
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDD) maxDD = dd;
      if (trade % SAMPLE_INTERVAL === 0) {
        allPathEquity[Math.floor(trade / SAMPLE_INTERVAL)]!.push(equity);
      }
    }
    maxDDs.push(maxDD * 100);
  }

  const thresholds = [10, 20, 30, 40, 50, 60, 70, 80, 90];
  const ruinCurve = thresholds.map((t) => ({
    threshold: t,
    prob: (maxDDs.filter((dd) => dd >= t).length / nPaths) * 100,
  }));

  const fan = Array.from({ length: fanPoints }, (_, i) => {
    const pts = allPathEquity[i] ?? [];
    return {
      x: i * SAMPLE_INTERVAL,
      p5: percentile(pts, 5),
      p25: percentile(pts, 25),
      p50: percentile(pts, 50),
      p75: percentile(pts, 75),
      p95: percentile(pts, 95),
    };
  });

  return { ruinCurve, maxDDs, fan };
}

const POSITION_SIZES = [5, 10, 25, 50, 100];

export function RiskOfRuin({ result }: { result: BacktestResult }) {
  const { trades, metrics } = result;
  const [simPositionPct, setSimPositionPct] = useState(25);

  const pnlPcts = useMemo(() => trades.map((t) => t.pnl_pct), [trades]);

  const sim = useMemo(() => {
    if (pnlPcts.length < 5) return null;
    return runSimulation(pnlPcts, 500, 500, simPositionPct);
  }, [pnlPcts, simPositionPct]);

  const sensitivityRows = useMemo(() => {
    if (pnlPcts.length < 5) return [];
    return POSITION_SIZES.map((ps) => {
      const { ruinCurve, maxDDs } = runSimulation(pnlPcts, 150, 300, ps);
      const ruin50 = ruinCurve.find((r) => r.threshold === 50)?.prob ?? 0;
      const expDD = percentile(maxDDs, 50);
      const verdict = ruin50 < 2 ? "Safe" : ruin50 < 15 ? "Moderate" : "Risky";
      return { ps, ruin50, expDD, verdict };
    });
  }, [pnlPcts]);

  const kellyF = useMemo(() => {
    const wr = (metrics.win_rate ?? 0) / 100;
    const avgWin = Math.abs(metrics.avg_win_pct ?? 1);
    const avgLoss = Math.abs(metrics.avg_loss_pct ?? 1);
    if (avgLoss === 0) return 0;
    const rr = avgWin / avgLoss;
    return Math.max(0, wr - (1 - wr) / rr) * 100;
  }, [metrics]);

  const expectedMaxDD = sim ? percentile(sim.maxDDs, 50) : 0;
  const p95MaxDD = sim ? percentile(sim.maxDDs, 95) : 0;
  const ruin50 = sim?.ruinCurve.find((r) => r.threshold === 50)?.prob ?? 0;

  if (pnlPcts.length < 5) {
    return (
      <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">
        Need at least 5 trades for simulation
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex items-center gap-4 bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
        <label className="text-xs text-zinc-400">Position size per trade:</label>
        <input
          type="range" min={5} max={100} step={5} value={simPositionPct}
          onChange={(e) => setSimPositionPct(Number(e.target.value))}
          className="flex-1 accent-amber-500"
        />
        <span className="text-xs font-mono text-amber-400 w-12 text-right">{simPositionPct}%</span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Ruin Prob (50% loss)", value: `${ruin50.toFixed(1)}%`, color: ruin50 < 5 ? "text-emerald-400" : ruin50 < 20 ? "text-amber-400" : "text-red-400" },
          { label: "Median Max Drawdown", value: `${expectedMaxDD.toFixed(1)}%`, color: "text-amber-400" },
          { label: "95th Pct Max DD", value: `${p95MaxDD.toFixed(1)}%`, color: "text-red-400" },
          { label: "Full Kelly F", value: `${kellyF.toFixed(1)}%`, color: "text-cyan-400" },
        ].map((c) => (
          <div key={c.label} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
            <div className={`text-xl font-bold font-mono ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Ruin probability curve */}
      {sim && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-1">Ruin Probability vs. Loss Threshold</h4>
          <p className="text-[10px] text-zinc-600 mb-3">
            Probability of experiencing at least X% drawdown over 500 trades (500 simulation paths).
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={sim.ruinCurve} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="threshold" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} domain={[0, 100]} />
              <ReferenceLine y={5} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: "5% risk", fill: "#f59e0b", fontSize: 9, position: "right" }} />
              {metrics.max_drawdown_pct != null && (
                <ReferenceLine
                  x={Math.round(Math.abs(metrics.max_drawdown_pct))}
                  stroke="#71717a"
                  strokeDasharray="3 3"
                  label={{ value: "Actual DD", fill: "#71717a", fontSize: 9, position: "top" }}
                />
              )}
              <Tooltip
                content={({ payload, label }) => {
                  if (!payload?.length) return null;
                  const v = payload[0]?.value;
                  return (
                    <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                      <div style={{ color: "#a1a1aa" }}>Threshold: {label}%</div>
                      <div style={{ color: "#ef4444" }}>Ruin prob: {typeof v === "number" ? v.toFixed(1) : "0"}%</div>
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="prob" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Equity fan */}
      {sim && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-1">Equity Percentile Fan (500 paths)</h4>
          <p className="text-[10px] text-zinc-600 mb-3">P5/P25/P50/P75/P95 of simulated equity paths. Starts at 1.0×.</p>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={sim.fan} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="x" tick={{ fill: "#71717a", fontSize: 10 }} label={{ value: "Trades", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }} />
              <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(1)}x`} />
              <ReferenceLine y={1} stroke="#52525b" strokeDasharray="3 3" />
              <Area type="monotone" dataKey="p95" stackId="fan" stroke="none" fill="#ef444420" isAnimationActive={false} />
              <Area type="monotone" dataKey="p75" stackId="fan2" stroke="none" fill="#f59e0b30" isAnimationActive={false} />
              <Area type="monotone" dataKey="p25" stackId="fan2" stroke="none" fill="#f59e0b15" isAnimationActive={false} />
              <Line type="monotone" dataKey="p50" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="p5" stroke="#ef4444" strokeWidth={1} strokeDasharray="3 2" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="p95" stroke="#22c55e" strokeWidth={1} strokeDasharray="3 2" dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2 text-[10px] text-zinc-500">
            <span><span className="text-emerald-500">—</span> P95</span>
            <span><span className="text-amber-400">—</span> P50</span>
            <span><span className="text-red-400">—</span> P5</span>
          </div>
        </div>
      )}

      {/* Position size sensitivity */}
      {sensitivityRows.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-3">Position Size Sensitivity</h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500 border-b border-zinc-800">
                <th className="text-left pb-2 font-normal">Position Size</th>
                <th className="text-right pb-2 font-normal">Median Max DD</th>
                <th className="text-right pb-2 font-normal">Ruin Prob (50% loss)</th>
                <th className="text-right pb-2 font-normal">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {sensitivityRows.map((row) => (
                <tr key={row.ps} className={`border-b border-zinc-800/50 ${row.ps === simPositionPct ? "bg-zinc-800/30" : ""}`}>
                  <td className="py-1.5 text-zinc-300 font-mono">{row.ps}%</td>
                  <td className="py-1.5 text-right font-mono text-zinc-400">{row.expDD.toFixed(1)}%</td>
                  <td className="py-1.5 text-right font-mono text-zinc-400">{row.ruin50.toFixed(1)}%</td>
                  <td className="py-1.5 text-right">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      row.verdict === "Safe" ? "bg-emerald-950/50 text-emerald-400" :
                      row.verdict === "Moderate" ? "bg-amber-950/50 text-amber-400" :
                      "bg-red-950/50 text-red-400"
                    }`}>
                      {row.verdict}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] text-zinc-600 mt-2">
            Simulation: 150 paths × 300 trades with bootstrap resampling. Kelly F* = {kellyF.toFixed(1)}% (recommended max).
          </p>
        </div>
      )}
    </div>
  );
}
