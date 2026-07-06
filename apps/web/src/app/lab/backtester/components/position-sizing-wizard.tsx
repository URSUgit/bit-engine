"use client";

import { useMemo, useState } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, ReferenceLine, Tooltip, ComposedChart, Area,
} from "recharts";

function kellyFraction(winRate: number, rr: number): number {
  return Math.max(0, winRate - (1 - winRate) / rr);
}

function simulateGrowth(pnlPcts: number[], positionPct: number, n: number): number[] {
  const equity = [1.0];
  let e = 1.0;
  const pop = pnlPcts.length;
  for (let i = 0; i < n; i++) {
    const trade = pnlPcts[i % pop]!;
    e *= 1 + (positionPct / 100) * (trade / 100);
    equity.push(e);
  }
  return equity;
}

export function PositionSizingWizard({ result }: { result: BacktestResult }) {
  const { trades, metrics } = result;
  const [customPct, setCustomPct] = useState(25);

  const winRateDec = (metrics.win_rate_pct ?? 50) / 100;
  const avgWin = Math.abs(metrics.avg_win_pct ?? 2);
  const avgLoss = Math.abs(metrics.avg_loss_pct ?? 1);
  const rr = avgLoss > 0 ? avgWin / avgLoss : 1;

  const fullKelly = kellyFraction(winRateDec, rr) * 100;
  const halfKelly = fullKelly / 2;
  const quarterKelly = fullKelly / 4;

  const pnlPcts = useMemo(() => trades.map((t) => t.pnl_pct), [trades]);

  // Growth curve: vary position size 1–100%
  const growthCurve = useMemo(() => {
    if (pnlPcts.length < 5) return [];
    return Array.from({ length: 100 }, (_, i) => {
      const ps = i + 1;
      const equity = simulateGrowth(pnlPcts, ps, pnlPcts.length);
      const finalEquity = equity[equity.length - 1] ?? 1;
      const maxDD = equity.reduce(({ peak, dd }, v) => {
        const newPeak = Math.max(peak, v);
        return { peak: newPeak, dd: Math.min(dd, (v - newPeak) / newPeak) };
      }, { peak: 1, dd: 0 }).dd * -100;
      return { ps, growth: (finalEquity - 1) * 100, maxDD };
    });
  }, [pnlPcts]);

  // Equity paths for comparison
  const comparisonPaths = useMemo(() => {
    if (pnlPcts.length < 5) return [];
    const sizes = [
      { label: "¼ Kelly", pct: quarterKelly, color: "#06b6d4" },
      { label: "½ Kelly", pct: halfKelly, color: "#22c55e" },
      { label: "Full Kelly", pct: fullKelly, color: "#f59e0b" },
      { label: "Custom", pct: customPct, color: "#a78bfa" },
    ].filter((s) => s.pct > 0);

    const n = Math.min(pnlPcts.length, 200);
    const all = sizes.map((s) => simulateGrowth(pnlPcts, s.pct, n));
    return Array.from({ length: n + 1 }, (_, i) => {
      const row: Record<string, number> = { trade: i };
      sizes.forEach((s, si) => { row[s.label] = (all[si]?.[i] ?? 1) * 100; });
      return row;
    });
  }, [pnlPcts, fullKelly, halfKelly, quarterKelly, customPct]);

  const verdictColor = (pct: number) => {
    if (pct <= quarterKelly) return "text-cyan-400";
    if (pct <= halfKelly) return "text-emerald-400";
    if (pct <= fullKelly) return "text-amber-400";
    return "text-red-400";
  };

  const verdict = (pct: number) => {
    if (pct <= 0) return "Not viable";
    if (pct <= quarterKelly) return "Very conservative";
    if (pct <= halfKelly) return "Conservative";
    if (pct <= fullKelly) return "Optimal (Kelly)";
    if (pct <= fullKelly * 1.5) return "Aggressive";
    return "Over-Kelly — high risk of ruin";
  };

  if (trades.length < 5) {
    return <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">Need at least 5 trades.</div>;
  }

  return (
    <div className="space-y-5">
      {/* Kelly summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Full Kelly F", value: fullKelly > 0 ? `${fullKelly.toFixed(1)}%` : "Not viable", color: "text-amber-400", sub: "Growth-optimal (over-leveraged in practice)" },
          { label: "Half Kelly", value: fullKelly > 0 ? `${halfKelly.toFixed(1)}%` : "—", color: "text-emerald-400", sub: "Recommended for live trading" },
          { label: "Quarter Kelly", value: fullKelly > 0 ? `${quarterKelly.toFixed(1)}%` : "—", color: "text-cyan-400", sub: "Ultra-conservative, minimal ruin risk" },
          { label: "Current Strategy", value: `${(metrics.avg_trade_pnl_pct ?? 0) >= 0 ? "Positive" : "Negative"} EV`, color: (metrics.avg_trade_pnl_pct ?? 0) >= 0 ? "text-emerald-400" : "text-red-400", sub: `WR: ${(metrics.win_rate_pct ?? 0).toFixed(1)}%, R:R: ${rr.toFixed(2)}` },
        ].map((c) => (
          <div key={c.label} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
            <div className={`text-xl font-bold font-mono ${c.color}`}>{c.value}</div>
            <div className="text-[10px] text-zinc-600 mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Custom position size input + verdict */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-center gap-4 mb-3">
          <label className="text-sm text-zinc-300 font-medium">Your position size:</label>
          <input
            type="range" min={1} max={100} step={1} value={customPct}
            onChange={(e) => setCustomPct(Number(e.target.value))}
            className="flex-1 accent-violet-500"
          />
          <input
            type="number" min={1} max={100} value={customPct}
            onChange={(e) => setCustomPct(Math.min(100, Math.max(1, Number(e.target.value))))}
            className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm font-mono text-zinc-200 text-right"
          />
          <span className="text-sm text-zinc-400">%</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-semibold ${verdictColor(customPct)}`}>{verdict(customPct)}</span>
          {fullKelly > 0 && (
            <span className="text-xs text-zinc-500">
              ({(customPct / fullKelly * 100).toFixed(0)}% of full Kelly)
            </span>
          )}
        </div>
      </div>

      {/* Growth vs position size chart */}
      {growthCurve.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-1">Growth & Drawdown vs. Position Size</h4>
          <p className="text-[10px] text-zinc-600 mb-3">
            Simulated over {pnlPcts.length} historical trades. Growth exceeds drawdown in the optimal zone.
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={growthCurve} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="ps" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${v}%`} label={{ value: "Position %", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }} />
              <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
              <ReferenceLine y={0} stroke="#52525b" />
              {fullKelly > 0 && (
                <ReferenceLine x={Math.round(fullKelly)} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: "Kelly", fill: "#f59e0b", fontSize: 9, position: "top" }} />
              )}
              {fullKelly > 0 && (
                <ReferenceLine x={Math.round(halfKelly)} stroke="#22c55e" strokeDasharray="4 2" label={{ value: "½K", fill: "#22c55e", fontSize: 9, position: "top" }} />
              )}
              <ReferenceLine x={customPct} stroke="#a78bfa" strokeDasharray="3 3" label={{ value: "You", fill: "#a78bfa", fontSize: 9, position: "insideTop" }} />
              <Area type="monotone" dataKey="maxDD" stroke="#ef4444" fill="#ef444420" strokeWidth={1.5} name="Max Drawdown" isAnimationActive={false} />
              <Line type="monotone" dataKey="growth" stroke="#22c55e" strokeWidth={2} dot={false} name="Final Growth" isAnimationActive={false} />
              <Tooltip
                content={({ payload, label }) => {
                  if (!payload?.length) return null;
                  return (
                    <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                      <div style={{ color: "#a1a1aa", marginBottom: 4 }}>Position: {label}%</div>
                      {payload.map((p, i) => {
                        const v = typeof p.value === "number" ? p.value : Number(p.value ?? 0);
                        return (
                          <div key={i} style={{ color: p.color }}>
                            {String(p.name)}: {v >= 0 ? "+" : ""}{v.toFixed(1)}%
                          </div>
                        );
                      })}
                    </div>
                  );
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Equity path comparison */}
      {comparisonPaths.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-1">Equity Path Comparison</h4>
          <p className="text-[10px] text-zinc-600 mb-3">Equity starting at 100 simulated over {Math.min(pnlPcts.length, 200)} trades.</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={comparisonPaths} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="trade" tick={{ fill: "#71717a", fontSize: 10 }} label={{ value: "Trades", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }} />
              <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(0)}`} />
              <ReferenceLine y={100} stroke="#52525b" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="¼ Kelly" stroke="#06b6d4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="½ Kelly" stroke="#22c55e" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="Full Kelly" stroke="#f59e0b" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="Custom" stroke="#a78bfa" strokeWidth={2} strokeDasharray="4 2" dot={false} isAnimationActive={false} />
              <Tooltip
                content={({ payload, label }) => {
                  if (!payload?.length) return null;
                  return (
                    <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                      <div style={{ color: "#a1a1aa", marginBottom: 4 }}>Trade #{label}</div>
                      {payload.map((p, i) => {
                        const v = typeof p.value === "number" ? p.value : Number(p.value ?? 0);
                        return (
                          <div key={i} style={{ color: p.color }}>
                            {String(p.name)}: {v.toFixed(1)}
                          </div>
                        );
                      })}
                    </div>
                  );
                }}
              />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2 text-[10px]">
            <span className="text-cyan-400">— ¼ Kelly</span>
            <span className="text-emerald-400">— ½ Kelly</span>
            <span className="text-amber-400">— Full Kelly</span>
            <span className="text-violet-400">— - - Custom ({customPct}%)</span>
          </div>
        </div>
      )}

      {/* Interpretation */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-2 text-xs text-zinc-400">
        <h4 className="text-sm font-semibold text-zinc-300">Kelly Criterion Notes</h4>
        <p>
          <strong className="text-zinc-300">Full Kelly</strong> maximizes long-run geometric growth but produces severe drawdowns
          and requires the strategy distribution to be known exactly. In practice it over-fits.
        </p>
        <p>
          <strong className="text-zinc-300">Half Kelly</strong> ({halfKelly.toFixed(1)}%) achieves ~75% of Kelly growth with ~½ the drawdown.
          Most professional traders use ¼–½ Kelly.
        </p>
        <p>
          <strong className="text-zinc-300">Interpretation:</strong> These simulations replay your exact historical trade sequence.
          They are not forward projections — they illustrate the leverage sensitivity of this equity curve.
        </p>
      </div>
    </div>
  );
}
