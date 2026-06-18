"use client";

import { useMemo } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, BarChart, Bar, Cell,
} from "recharts";

type DrawdownEpisode = {
  peak_t: number;
  trough_t: number;
  recovered_t: number | null;
  peak_equity: number;
  trough_equity: number;
  drawdown_pct: number;
  duration_bars: number;
  recovery_bars: number | null;
  total_bars: number | null;
};

function extractDrawdowns(equity_curve: BacktestResult["equity_curve"]): DrawdownEpisode[] {
  if (equity_curve.length < 2) return [];
  const episodes: DrawdownEpisode[] = [];
  let inDrawdown = false;
  let peakIdx = 0;
  let peakEquity = equity_curve[0].equity;

  for (let i = 1; i < equity_curve.length; i++) {
    const e = equity_curve[i].equity;
    if (!inDrawdown) {
      if (e > peakEquity) {
        peakEquity = e;
        peakIdx = i;
      } else if (e < peakEquity * 0.999) {
        inDrawdown = true;
      }
    } else {
      if (e > peakEquity) {
        // Recovery complete
        const troughIdx = equity_curve.slice(peakIdx, i).reduce((best, pt, j) =>
          pt.equity < equity_curve[peakIdx + best].equity ? j : best, 0) + peakIdx;
        const trough = equity_curve[troughIdx];
        const dd = (peakEquity - trough.equity) / peakEquity * 100;
        if (dd > 0.5) {
          episodes.push({
            peak_t: equity_curve[peakIdx].t,
            trough_t: trough.t,
            recovered_t: equity_curve[i].t,
            peak_equity: peakEquity,
            trough_equity: trough.equity,
            drawdown_pct: dd,
            duration_bars: troughIdx - peakIdx,
            recovery_bars: i - troughIdx,
            total_bars: i - peakIdx,
          });
        }
        peakEquity = e;
        peakIdx = i;
        inDrawdown = false;
      }
    }
  }

  // Still in drawdown at end
  if (inDrawdown && equity_curve.length > peakIdx) {
    const troughIdx = equity_curve.slice(peakIdx).reduce((best, pt, j) =>
      pt.equity < equity_curve[peakIdx + best].equity ? j : best, 0) + peakIdx;
    const trough = equity_curve[troughIdx];
    const dd = (peakEquity - trough.equity) / peakEquity * 100;
    if (dd > 0.5) {
      episodes.push({
        peak_t: equity_curve[peakIdx].t,
        trough_t: trough.t,
        recovered_t: null,
        peak_equity: peakEquity,
        trough_equity: trough.equity,
        drawdown_pct: dd,
        duration_bars: troughIdx - peakIdx,
        recovery_bars: null,
        total_bars: null,
      });
    }
  }

  return episodes.sort((a, b) => b.drawdown_pct - a.drawdown_pct);
}

function formatDate(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

function ddColor(pct: number): string {
  if (pct < 5) return "#22c55e";
  if (pct < 10) return "#84cc16";
  if (pct < 20) return "#eab308";
  if (pct < 30) return "#f97316";
  return "#ef4444";
}

export function DrawdownAnalysis({ result }: { result: BacktestResult }) {
  const episodes = useMemo(() => extractDrawdowns(result.equity_curve), [result.equity_curve]);

  // Drawdown curve data (already available in equity_curve)
  const ddData = useMemo(() =>
    result.equity_curve.map((pt) => ({
      t: formatDate(pt.t),
      dd: -pt.drawdown_pct,
    })), [result.equity_curve]);

  // Underwater duration distribution
  const underTime = useMemo(() => {
    let under = 0;
    for (const pt of result.equity_curve) {
      if (pt.drawdown_pct > 0.1) under++;
    }
    return {
      under,
      total: result.equity_curve.length,
      pct: result.equity_curve.length > 0 ? (under / result.equity_curve.length * 100) : 0,
    };
  }, [result.equity_curve]);

  if (result.equity_curve.length < 5) {
    return (
      <div className="text-center text-zinc-500 py-10">Insufficient data for drawdown analysis.</div>
    );
  }

  const topN = episodes.slice(0, 10);
  const maxDD = episodes[0]?.drawdown_pct ?? 0;
  const avgDD = episodes.length > 0 ? episodes.reduce((s, e) => s + e.drawdown_pct, 0) / episodes.length : 0;
  const avgRecovery = episodes.filter((e) => e.recovery_bars != null).reduce((s, e) => s + (e.recovery_bars ?? 0), 0)
    / (episodes.filter((e) => e.recovery_bars != null).length || 1);
  const openDD = episodes.find((e) => e.recovered_t === null);

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Max Drawdown", value: `-${maxDD.toFixed(2)}%`, color: "text-red-400" },
          { label: "Avg Drawdown", value: `-${avgDD.toFixed(2)}%`, color: "text-orange-400" },
          { label: "Episodes", value: String(episodes.length), color: "text-zinc-200" },
          { label: "Time Underwater", value: `${underTime.pct.toFixed(1)}%`, color: underTime.pct > 40 ? "text-red-400" : "text-yellow-400" },
        ].map((s) => (
          <div key={s.label} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">{s.label}</div>
            <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Open drawdown warning */}
      {openDD && (
        <div className="bg-red-950/30 border border-red-800 rounded-lg p-3 flex items-center gap-3">
          <span className="text-red-400 text-lg">⚠</span>
          <div>
            <div className="text-sm font-medium text-red-300">Currently in drawdown</div>
            <div className="text-xs text-red-400">
              {openDD.drawdown_pct.toFixed(2)}% below peak since {formatDate(openDD.peak_t)} · {openDD.duration_bars} bars
            </div>
          </div>
        </div>
      )}

      {/* Drawdown curve */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-3">Drawdown curve</h4>
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={ddData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="t" tick={false} />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
            <Tooltip
              contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6 }}
              formatter={(v) => [`${(v as number).toFixed(2)}%`, "Drawdown"]}
            />
            <ReferenceLine y={0} stroke="#52525b" />
            <Area dataKey="dd" stroke="#ef4444" fill="url(#ddGrad)" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Episode size distribution */}
      {topN.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-3">Top {topN.length} drawdown episodes (depth)</h4>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={topN.map((e, i) => ({ name: `#${i + 1}`, dd: e.drawdown_pct, ep: e }))} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="name" tick={{ fill: "#71717a", fontSize: 11 }} />
              <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6 }}
                formatter={(v) => [`${(v as number).toFixed(2)}%`, "Drawdown depth"]}
              />
              <Bar dataKey="dd" radius={[2, 2, 0, 0]}>
                {topN.map((e, i) => <Cell key={i} fill={ddColor(e.drawdown_pct)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Episode table */}
      {episodes.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800">
            <h4 className="text-sm font-semibold text-zinc-300">All drawdown episodes</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800">
                  <th className="text-left px-4 py-2">#</th>
                  <th className="text-right px-3 py-2">Depth</th>
                  <th className="text-left px-3 py-2">Peak date</th>
                  <th className="text-left px-3 py-2">Trough date</th>
                  <th className="text-right px-3 py-2">To trough</th>
                  <th className="text-right px-3 py-2">Recovery</th>
                  <th className="text-right px-3 py-2">Total</th>
                  <th className="text-left px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {episodes.map((ep, i) => (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition">
                    <td className="px-4 py-2 text-zinc-500">{i + 1}</td>
                    <td className="px-3 py-2 text-right font-medium" style={{ color: ddColor(ep.drawdown_pct) }}>
                      -{ep.drawdown_pct.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-zinc-400">{formatDate(ep.peak_t)}</td>
                    <td className="px-3 py-2 text-zinc-400">{formatDate(ep.trough_t)}</td>
                    <td className="px-3 py-2 text-right text-zinc-400">{ep.duration_bars}b</td>
                    <td className="px-3 py-2 text-right text-zinc-400">
                      {ep.recovery_bars != null ? `${ep.recovery_bars}b` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-400">
                      {ep.total_bars != null ? `${ep.total_bars}b` : `${ep.duration_bars}b+`}
                    </td>
                    <td className="px-3 py-2">
                      {ep.recovered_t != null
                        ? <span className="text-emerald-500 text-[10px] bg-emerald-950/40 border border-emerald-900 px-1.5 py-0.5 rounded">Recovered</span>
                        : <span className="text-red-400 text-[10px] bg-red-950/40 border border-red-900 px-1.5 py-0.5 rounded">Open</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {avgRecovery > 0 && (
            <div className="px-4 py-2 border-t border-zinc-800 text-xs text-zinc-500">
              Avg recovery: <span className="text-zinc-300">{avgRecovery.toFixed(1)} bars</span> ·
              Recovered: <span className="text-emerald-400">{episodes.filter((e) => e.recovered_t).length}</span> of {episodes.length}
            </div>
          )}
        </div>
      )}

      {episodes.length === 0 && (
        <div className="text-center text-zinc-500 py-6 text-sm">No significant drawdown episodes detected.</div>
      )}
    </div>
  );
}
