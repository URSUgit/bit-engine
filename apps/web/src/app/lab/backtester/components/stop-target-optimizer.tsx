"use client";

import { useMemo, useState } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, ReferenceLine, Legend,
} from "recharts";

// Sweep grids (percent moves)
const STOP_LEVELS = [0.5, 1, 1.5, 2, 3, 4, 5, 7, 10, 15];
const TARGET_LEVELS = [0.5, 1, 1.5, 2, 3, 4, 5, 7, 10, 15];

// Apply a hypothetical stop/target cap to a realized pnl_pct.
// Approximation: assumes the trade path would have touched the cap. Conservative
// for stops (true intratrade low is unknown), optimistic for targets.
function clampPnl(pnl: number, stop: number, target: number): number {
  if (pnl <= -stop) return -stop;
  if (pnl >= target) return target;
  return pnl;
}

function equityFromPnls(pnls: number[], positionPct: number, initial: number): number[] {
  let eq = initial;
  const out: number[] = [initial];
  for (const p of pnls) {
    eq *= 1 + (p / 100) * (positionPct / 100);
    out.push(eq);
  }
  return out;
}

function totalReturnPct(pnls: number[], positionPct: number): number {
  let mult = 1;
  for (const p of pnls) mult *= 1 + (p / 100) * (positionPct / 100);
  return (mult - 1) * 100;
}

function cellColor(ret: number, min: number, max: number): { background: string; color: string } {
  if (max === min) return { background: "#3f3f46", color: "#e4e4e7" };
  const mid = 0;
  let t: number;
  let bg: string;
  if (ret >= mid) {
    t = max > 0 ? ret / max : 0;
    const g = Math.round(80 + t * 120);
    bg = `rgb(${Math.round(34 * (1 - t) + 16 * t)}, ${g}, ${Math.round(94 * (1 - t) + 60 * t)})`;
  } else {
    t = min < 0 ? ret / min : 0;
    const r = Math.round(120 + t * 119);
    bg = `rgb(${r}, ${Math.round(68 * (1 - t))}, ${Math.round(68 * (1 - t))})`;
  }
  return { background: bg, color: "#fafafa" };
}

export function StopTargetOptimizer({ result }: { result: BacktestResult }) {
  const { trades } = result;
  const positionPct = 100; // express relative to full position; pnl_pct already net
  const [sel, setSel] = useState<{ stop: number; target: number } | null>(null);

  const basePnls = useMemo(() => trades.map((t) => t.pnl_pct), [trades]);
  const baseReturn = useMemo(() => totalReturnPct(basePnls, positionPct), [basePnls]);

  // Build the grid
  const grid = useMemo(() => {
    return STOP_LEVELS.map((stop) =>
      TARGET_LEVELS.map((target) => {
        const pnls = basePnls.map((p) => clampPnl(p, stop, target));
        const ret = totalReturnPct(pnls, positionPct);
        const wins = pnls.filter((p) => p > 0).length;
        return { stop, target, ret, winRate: pnls.length ? (wins / pnls.length) * 100 : 0 };
      }),
    );
  }, [basePnls]);

  const flat = useMemo(() => grid.flat(), [grid]);
  const minRet = Math.min(...flat.map((c) => c.ret), baseReturn);
  const maxRet = Math.max(...flat.map((c) => c.ret), baseReturn);

  const best = useMemo(() => flat.reduce((a, b) => (b.ret > a.ret ? b : a), flat[0]), [flat]);

  const active = useMemo(() => {
    if (!sel) return best;
    return flat.find((c) => c.stop === sel.stop && c.target === sel.target) ?? best;
  }, [sel, flat, best]);

  // Equity comparison: original vs selected cap
  const equityComparison = useMemo(() => {
    if (!active) return [];
    const orig = equityFromPnls(basePnls, positionPct, 10000);
    const capped = equityFromPnls(
      basePnls.map((p) => clampPnl(p, active.stop, active.target)),
      positionPct,
      10000,
    );
    return orig.map((o, i) => ({ i, original: o, capped: capped[i] ?? o }));
  }, [basePnls, active]);

  if (trades.length < 5) {
    return <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">Need at least 5 trades.</div>;
  }

  const improvement = active ? active.ret - baseReturn : 0;

  return (
    <div className="space-y-5">
      <div className="bg-amber-950/20 border border-amber-900/40 rounded-lg p-3 text-[11px] text-amber-300/80">
        <strong>Approximation:</strong> caps are applied to each trade&apos;s <em>realized</em> return. Stops assume the
        adverse move would have triggered the cap (conservative — true intratrade lows are unknown), and targets assume the
        favorable move would have been reached. Treat this as a directional what-if, not a re-backtest.
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Baseline Return", value: `${baseReturn > 0 ? "+" : ""}${baseReturn.toFixed(1)}%`, color: baseReturn >= 0 ? "text-emerald-400" : "text-red-400" },
          { label: "Best Capped Return", value: best ? `${best.ret > 0 ? "+" : ""}${best.ret.toFixed(1)}%` : "—", color: "text-emerald-400" },
          { label: "Optimal Stop / Target", value: best ? `${best.stop}% / ${best.target}%` : "—", color: "text-indigo-400" },
          { label: "Improvement", value: `${improvement > 0 ? "+" : ""}${improvement.toFixed(1)}%`, color: improvement > 0 ? "text-emerald-400" : "text-zinc-400" },
        ].map((c) => (
          <div key={c.label} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
            <div className={`text-lg font-bold font-mono ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Heatmap grid */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">Total Return by Stop-Loss × Take-Profit</h4>
        <p className="text-[10px] text-zinc-600 mb-3">Rows = stop-loss cap %, columns = take-profit cap %. Click a cell to compare its equity curve below.</p>
        <div className="overflow-x-auto">
          <table className="border-collapse text-[10px]">
            <thead>
              <tr>
                <th className="p-1 text-zinc-500 text-right sticky left-0 bg-zinc-900/50">SL ↓ / TP →</th>
                {TARGET_LEVELS.map((tp) => (
                  <th key={tp} className="p-1 text-zinc-400 font-mono text-center min-w-[42px]">{tp}%</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row, ri) => (
                <tr key={ri}>
                  <td className="p-1 text-zinc-400 font-mono text-right sticky left-0 bg-zinc-900/50">{STOP_LEVELS[ri]}%</td>
                  {row.map((cell, ci) => {
                    const style = cellColor(cell.ret, minRet, maxRet);
                    const isBest = best && cell.stop === best.stop && cell.target === best.target;
                    const isSel = sel && cell.stop === sel.stop && cell.target === sel.target;
                    return (
                      <td
                        key={ci}
                        onClick={() => setSel({ stop: cell.stop, target: cell.target })}
                        className="p-1 text-center font-mono cursor-pointer transition-transform hover:scale-105"
                        style={{
                          background: style.background,
                          color: style.color,
                          outline: isSel ? "2px solid #818cf8" : isBest ? "2px solid #fbbf24" : "none",
                          outlineOffset: "-2px",
                        }}
                        title={`SL ${cell.stop}% / TP ${cell.target}% → ${cell.ret.toFixed(1)}% (WR ${cell.winRate.toFixed(0)}%)`}
                      >
                        {cell.ret.toFixed(0)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-4 mt-2 text-[10px]">
          <span className="text-amber-400">▢ Best combo</span>
          <span className="text-indigo-400">▢ Selected</span>
        </div>
      </div>

      {/* Equity comparison */}
      {active && equityComparison.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-1">
            Equity: Baseline vs. SL {active.stop}% / TP {active.target}%
          </h4>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={equityComparison} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="i" tick={{ fill: "#71717a", fontSize: 10 }} label={{ value: "Trade #", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }} />
              <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(1)}k`} />
              <ReferenceLine y={10000} stroke="#52525b" strokeDasharray="3 3" />
              <Tooltip
                content={({ payload, label }) => {
                  if (!payload?.length) return null;
                  return (
                    <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                      <div style={{ color: "#a1a1aa", marginBottom: 4 }}>Trade #{label}</div>
                      {payload.map((p, i) => (
                        <div key={i} style={{ color: p.color }}>
                          {String(p.name)}: ${typeof p.value === "number" ? p.value.toFixed(0) : "0"}
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="original" name="Baseline" stroke="#71717a" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="capped" name="Capped" stroke="#22c55e" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
