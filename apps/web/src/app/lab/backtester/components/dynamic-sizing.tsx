"use client";

import { useMemo, useState } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, ReferenceLine, Legend,
} from "recharts";

type SizingStrategy = "flat" | "anti_martingale" | "fractional" | "kelly_adaptive";

interface SizingParams {
  basePositionPct: number;
  antiMartingaleStep: number;   // % increase after each win
  antiMartingaleMax: number;    // max multiplier
  fractionalKelly: number;      // fraction of Kelly to use
  volWindow: number;            // window for rolling win rate
}

function computeKelly(winRate: number, avgWin: number, avgLoss: number): number {
  if (avgLoss <= 0) return 0;
  const rr = avgWin / avgLoss;
  return Math.max(0, winRate - (1 - winRate) / rr);
}

function simulateSizing(
  pnlPcts: number[],
  strategy: SizingStrategy,
  params: SizingParams,
  initialCapital: number,
  globalKelly: number,
): { equity: number[]; positionSizes: number[] } {
  const { basePositionPct, antiMartingaleStep, antiMartingaleMax, fractionalKelly, volWindow } = params;
  let equity = initialCapital;
  let multiplier = 1.0;
  const equities: number[] = [initialCapital];
  const sizes: number[] = [];

  for (let i = 0; i < pnlPcts.length; i++) {
    const pnl = pnlPcts[i]!;
    let positionPct: number;

    switch (strategy) {
      case "flat":
        positionPct = basePositionPct;
        break;
      case "anti_martingale":
        positionPct = Math.min(basePositionPct * multiplier, basePositionPct * antiMartingaleMax);
        break;
      case "fractional": {
        const fraction = equity / initialCapital;
        positionPct = basePositionPct * fraction;
        break;
      }
      case "kelly_adaptive": {
        const window = pnlPcts.slice(Math.max(0, i - volWindow), i);
        if (window.length < 5) {
          positionPct = basePositionPct;
        } else {
          const wins = window.filter((p) => p > 0);
          const losses = window.filter((p) => p <= 0);
          const wr = wins.length / window.length;
          const avgW = wins.length > 0 ? wins.reduce((s, p) => s + p, 0) / wins.length : basePositionPct;
          const avgL = losses.length > 0 ? Math.abs(losses.reduce((s, p) => s + p, 0) / losses.length) : basePositionPct;
          const kf = computeKelly(wr, avgW, avgL);
          positionPct = kf * fractionalKelly * 100;
        }
        break;
      }
      default:
        positionPct = basePositionPct;
    }

    positionPct = Math.max(1, Math.min(100, positionPct));
    sizes.push(positionPct);
    const tradeReturn = (positionPct / 100) * (pnl / 100);
    equity *= 1 + tradeReturn;

    if (strategy === "anti_martingale") {
      multiplier = pnl > 0 ? multiplier * (1 + antiMartingaleStep / 100) : 1.0;
    }

    equities.push(equity);
  }

  return { equity: equities, positionSizes: sizes };
}

const SIZING_LABELS: Record<SizingStrategy, string> = {
  flat: "Flat (fixed %)",
  anti_martingale: "Anti-Martingale (scale up after wins)",
  fractional: "Proportional (% of current equity)",
  kelly_adaptive: "Adaptive Kelly (rolling)",
};

export function DynamicSizing({ result }: { result: BacktestResult }) {
  const { trades, metrics } = result;
  const [basePositionPct, setBasePositionPct] = useState(25);
  const [antiMartingaleStep, setAntiMartingaleStep] = useState(20);
  const [antiMartingaleMax, setAntiMartingaleMax] = useState(3);
  const [fractionalKelly, setFractionalKelly] = useState(0.5);
  const [volWindow, setVolWindow] = useState(20);

  const pnlPcts = useMemo(() => trades.map((t) => t.pnl_pct), [trades]);

  const globalKelly = useMemo(() => {
    const wr = (metrics.win_rate_pct ?? 50) / 100;
    const avgWin = Math.abs(metrics.avg_win_pct ?? 1);
    const avgLoss = Math.abs(metrics.avg_loss_pct ?? 1);
    return computeKelly(wr, avgWin, avgLoss);
  }, [metrics]);

  const params: SizingParams = { basePositionPct, antiMartingaleStep, antiMartingaleMax, fractionalKelly, volWindow };

  const comparisonData = useMemo(() => {
    if (pnlPcts.length < 5) return [];
    const initialCapital = metrics.initial_capital ?? 10000;
    const strategies: SizingStrategy[] = ["flat", "anti_martingale", "fractional", "kelly_adaptive"];
    const results = strategies.map((s) => simulateSizing(pnlPcts, s, params, initialCapital, globalKelly));
    const n = results[0]!.equity.length;
    return Array.from({ length: n }, (_, i) => {
      const row: Record<string, number> = { trade: i };
      strategies.forEach((s, si) => {
        row[s] = results[si]!.equity[i] ?? initialCapital;
      });
      return row;
    });
  }, [pnlPcts, params, metrics, globalKelly]);

  const finalEquities = useMemo(() => {
    if (pnlPcts.length < 5) return {};
    const initialCapital = metrics.initial_capital ?? 10000;
    const strategies: SizingStrategy[] = ["flat", "anti_martingale", "fractional", "kelly_adaptive"];
    return Object.fromEntries(
      strategies.map((s) => {
        const sim = simulateSizing(pnlPcts, s, params, initialCapital, globalKelly);
        const final = sim.equity[sim.equity.length - 1] ?? initialCapital;
        const maxDD = sim.equity.reduce(({ peak, dd }, v) => {
          const p = Math.max(peak, v);
          return { peak: p, dd: Math.min(dd, (v - p) / p) };
        }, { peak: initialCapital, dd: 0 }).dd * -100;
        return [s, { final, ret: ((final - initialCapital) / initialCapital) * 100, maxDD }];
      }),
    );
  }, [pnlPcts, params, metrics, globalKelly]);

  if (trades.length < 5) {
    return <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">Need at least 5 trades.</div>;
  }

  const COLORS: Record<SizingStrategy, string> = {
    flat: "#71717a",
    anti_martingale: "#22c55e",
    fractional: "#06b6d4",
    kelly_adaptive: "#f59e0b",
  };

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-semibold text-zinc-300">Sizing Parameters</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          {[
            { label: "Base position size", value: basePositionPct, set: setBasePositionPct, min: 1, max: 100, suffix: "%" },
            { label: "Anti-Martingale step (per win)", value: antiMartingaleStep, set: setAntiMartingaleStep, min: 5, max: 100, suffix: "%" },
            { label: "Anti-Martingale max multiplier", value: antiMartingaleMax, set: setAntiMartingaleMax, min: 1.5, max: 10, suffix: "×", step: 0.5 },
            { label: "Kelly fraction", value: fractionalKelly * 100, set: (v: number) => setFractionalKelly(v / 100), min: 10, max: 100, suffix: "%" },
          ].map(({ label, value, set, min, max, suffix }) => (
            <div key={label}>
              <div className="flex justify-between mb-1">
                <span className="text-zinc-400">{label}</span>
                <span className="text-zinc-300 font-mono">{typeof value === "number" ? value.toFixed(0) : value}{suffix}</span>
              </div>
              <input
                type="range" min={min} max={max} step={suffix === "×" ? 0.5 : 1} value={value}
                onChange={(e) => (set as (v: number) => void)(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Results summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(["flat", "anti_martingale", "fractional", "kelly_adaptive"] as SizingStrategy[]).map((s) => {
          const stats = (finalEquities as Record<string, { ret: number; maxDD: number }>)[s];
          if (!stats) return null;
          return (
            <div key={s} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3" style={{ borderLeftColor: COLORS[s], borderLeftWidth: 3 }}>
              <div className="text-[10px] text-zinc-500 mb-1">{SIZING_LABELS[s].split(" (")[0]}</div>
              <div className={`text-xl font-bold font-mono ${stats.ret >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {stats.ret >= 0 ? "+" : ""}{stats.ret.toFixed(1)}%
              </div>
              <div className="text-[10px] text-red-400 mt-0.5">Max DD: {stats.maxDD.toFixed(1)}%</div>
            </div>
          );
        })}
      </div>

      {/* Equity comparison */}
      {comparisonData.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-1">Equity Curve Comparison</h4>
          <p className="text-[10px] text-zinc-600 mb-3">
            Same historical trades, different position sizing algorithms. Starting capital: ${(metrics.initial_capital ?? 10000).toLocaleString()}.
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={comparisonData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="trade" tick={{ fill: "#71717a", fontSize: 10 }} label={{ value: "Trade #", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }} />
              <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`} />
              <ReferenceLine y={metrics.initial_capital ?? 10000} stroke="#3f3f46" strokeDasharray="3 3" />
              <Tooltip
                content={({ payload, label }) => {
                  if (!payload?.length) return null;
                  return (
                    <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                      <div style={{ color: "#a1a1aa", marginBottom: 4 }}>Trade #{label}</div>
                      {payload.map((p, i) => {
                        const v = typeof p.value === "number" ? p.value : Number(p.value ?? 0);
                        const stratKey = String(p.dataKey) as SizingStrategy;
                        return (
                          <div key={i} style={{ color: COLORS[stratKey] ?? p.color }}>
                            {SIZING_LABELS[stratKey]?.split(" (")[0] ?? stratKey}: ${v.toFixed(0)}
                          </div>
                        );
                      })}
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="flat" name="Flat" stroke={COLORS.flat} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="anti_martingale" name="Anti-Martingale" stroke={COLORS.anti_martingale} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="fractional" name="Proportional" stroke={COLORS.fractional} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="kelly_adaptive" name="Adaptive Kelly" stroke={COLORS.kelly_adaptive} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Legend wrapperStyle={{ fontSize: 10, color: "#a1a1aa" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Interpretation */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-2 text-xs text-zinc-400">
        <h4 className="text-sm font-semibold text-zinc-300">Sizing Strategy Notes</h4>
        <p><strong className="text-zinc-300">Flat:</strong> Fixed % per trade. Simple, no compounding effect from wins or losses.</p>
        <p><strong className="text-zinc-300">Anti-Martingale:</strong> Increase size by {antiMartingaleStep}% after each win (max {antiMartingaleMax}×), reset after loss. Compounds winner runs.</p>
        <p><strong className="text-zinc-300">Proportional:</strong> Size as % of current equity. Automatically reduces exposure after drawdowns.</p>
        <p><strong className="text-zinc-300">Adaptive Kelly:</strong> Computes Kelly fraction from last {volWindow} trades' win rate/R:R, scaled by {(fractionalKelly * 100).toFixed(0)}% fraction. Highest variance — may show large divergence.</p>
        <p className="text-zinc-600">Kelly F (full): {globalKelly > 0 ? `${(globalKelly * 100).toFixed(1)}%` : "Not viable (negative EV)"}</p>
      </div>
    </div>
  );
}
