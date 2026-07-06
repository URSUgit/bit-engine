"use client";

import { useMemo, useState } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, Cell, LineChart, Line, ReferenceLine,
} from "recharts";

const COST_LEVELS = [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.10, 0.12, 0.15, 0.20, 0.25, 0.30];

export function CostSensitivity({ result }: { result: BacktestResult }) {
  const { trades } = result;
  const [highlight, setHighlight] = useState<number | null>(null);

  // For each cost level, count how many trades become losses
  const costImpactData = useMemo(() => {
    return COST_LEVELS.map((costPct) => {
      const roundTrip = costPct * 2; // entry + exit
      let flipped = 0;
      let totalWins = 0;
      let totalGross = 0;
      for (const t of trades) {
        const netPnl = t.pnl_pct - roundTrip;
        if (t.pnl_pct > 0) {
          totalWins++;
          if (netPnl <= 0) flipped++;
        }
        totalGross += netPnl;
      }
      return {
        cost: costPct,
        flipped,
        totalWins,
        flippedPct: totalWins > 0 ? (flipped / totalWins) * 100 : 0,
        netReturn: totalGross,
      };
    });
  }, [trades]);

  // Per-trade "cost headroom" = margin before win flips to loss
  const tradeHeadroomData = useMemo(() => {
    return trades
      .map((t, i) => ({
        i,
        pnl: t.pnl_pct,
        headroom: t.pnl_pct > 0 ? t.pnl_pct / 2 : 0, // cost-per-side to flip
        isWinner: t.pnl_pct > 0,
        side: t.side,
      }))
      .filter((t) => t.isWinner)
      .sort((a, b) => a.headroom - b.headroom);
  }, [trades]);

  // Marginal trades (winners with very thin headroom)
  const marginalTrades = useMemo(() => {
    return tradeHeadroomData.filter((t) => t.headroom < 0.10).slice(0, 20);
  }, [tradeHeadroomData]);

  // "Safe" trades (winners that survive even high costs)
  const solidWinners = useMemo(() => {
    return tradeHeadroomData.filter((t) => t.headroom >= 0.10).length;
  }, [tradeHeadroomData]);

  const winnerCount = trades.filter((t) => t.pnl_pct > 0).length;
  const grossWinnerAvg = winnerCount > 0
    ? trades.filter((t) => t.pnl_pct > 0).reduce((s, t) => s + t.pnl_pct, 0) / winnerCount
    : 0;

  if (trades.length === 0) {
    return <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">No trades to analyze.</div>;
  }

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Winners", value: String(winnerCount), color: "text-emerald-400" },
          { label: "Marginal Winners (<0.1% headroom)", value: String(marginalTrades.length), color: marginalTrades.length > winnerCount * 0.2 ? "text-red-400" : "text-amber-400" },
          { label: "Robust Winners (≥0.1%)", value: String(solidWinners), color: "text-emerald-400" },
          { label: "Avg Winner PnL", value: `+${grossWinnerAvg.toFixed(2)}%`, color: "text-emerald-400" },
        ].map((c) => (
          <div key={c.label} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
            <div className={`text-xl font-bold font-mono ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Winners flipped vs cost */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">Winners Flipped to Losses vs. Cost per Side</h4>
        <p className="text-[10px] text-zinc-600 mb-3">
          How many currently-winning trades would become losses as commission/slippage per side increases.
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={costImpactData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="cost" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(2)}%`} label={{ value: "Cost per side %", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }} />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} domain={[0, 100]} yAxisId="left" />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
            <ReferenceLine yAxisId="left" y={50} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: "50% flipped", fill: "#f59e0b", fontSize: 9, position: "right" }} />
            <ReferenceLine x={0.04} stroke="#71717a" strokeDasharray="3 3" label={{ value: "Binance taker", fill: "#71717a", fontSize: 9, position: "top" }} />
            <Tooltip
              content={({ payload, label }) => {
                if (!payload?.length) return null;
                return (
                  <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: "#a1a1aa", marginBottom: 4 }}>Cost: {label}% per side</div>
                    {payload.map((p, i) => {
                      const v = typeof p.value === "number" ? p.value : Number(p.value ?? 0);
                      return (
                        <div key={i} style={{ color: p.color }}>
                          {String(p.name)}: {v.toFixed(1)}%
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            <Line yAxisId="left" type="monotone" dataKey="flippedPct" name="Winners flipped" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line yAxisId="right" type="monotone" dataKey="netReturn" name="Net return" stroke="#22c55e" strokeWidth={1.5} strokeDasharray="4 2" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Cost headroom per trade (sorted) */}
      {tradeHeadroomData.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-1">Winner Cost Headroom (sorted ascending)</h4>
          <p className="text-[10px] text-zinc-600 mb-3">Cost per side required to flip each winning trade to a loss. Low headroom = fragile win.</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={tradeHeadroomData.slice(0, 60)} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis hide />
              <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(2)}%`} />
              <ReferenceLine y={0.04} stroke="#71717a" strokeDasharray="3 3" label={{ value: "0.04% (Binance)", fill: "#71717a", fontSize: 9, position: "insideTopRight" }} />
              <ReferenceLine y={0.10} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: "0.10%", fill: "#f59e0b", fontSize: 9, position: "insideTopRight" }} />
              <Tooltip
                content={({ payload }) => {
                  if (!payload?.length) return null;
                  const d = payload[0]?.payload as { i: number; pnl: number; headroom: number } | undefined;
                  if (!d) return null;
                  return (
                    <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                      <div style={{ color: "#a1a1aa" }}>Trade #{d.i + 1}</div>
                      <div style={{ color: "#22c55e" }}>PnL: +{d.pnl.toFixed(3)}%</div>
                      <div style={{ color: "#f59e0b" }}>Headroom: {d.headroom.toFixed(3)}% per side</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="headroom" name="Headroom" isAnimationActive={false} maxBarSize={6}>
                {tradeHeadroomData.slice(0, 60).map((d, i) => (
                  <Cell
                    key={i}
                    fill={d.headroom < 0.04 ? "#ef4444" : d.headroom < 0.10 ? "#f59e0b" : "#22c55e"}
                    fillOpacity={0.8}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2 text-[10px]">
            <span className="text-red-400">■ Fragile (&lt;0.04%)</span>
            <span className="text-amber-400">■ Marginal (0.04–0.10%)</span>
            <span className="text-emerald-400">■ Robust (&gt;0.10%)</span>
          </div>
        </div>
      )}

      {/* Marginal trades table */}
      {marginalTrades.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-3">Marginal Trades (headroom &lt;0.10%)</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800">
                  <th className="text-left pb-2 font-normal">Trade #</th>
                  <th className="text-right pb-2 font-normal">PnL</th>
                  <th className="text-right pb-2 font-normal">Headroom/side</th>
                  <th className="text-right pb-2 font-normal">Risk</th>
                </tr>
              </thead>
              <tbody>
                {marginalTrades.map((t) => (
                  <tr key={t.i} className="border-b border-zinc-800/50">
                    <td className="py-1.5 text-zinc-400">#{t.i + 1}</td>
                    <td className="py-1.5 text-right font-mono text-emerald-400">+{t.pnl.toFixed(3)}%</td>
                    <td className="py-1.5 text-right font-mono text-amber-400">{t.headroom.toFixed(3)}%</td>
                    <td className="py-1.5 text-right">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${t.headroom < 0.04 ? "bg-red-950/50 text-red-400" : "bg-amber-950/50 text-amber-400"}`}>
                        {t.headroom < 0.04 ? "Below Binance fee" : "Marginal"}
                      </span>
                    </td>
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
