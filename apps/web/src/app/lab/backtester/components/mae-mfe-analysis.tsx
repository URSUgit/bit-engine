"use client";

import { useMemo } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MaeMfePoint {
  tradeIdx: number;
  mae: number;      // most adverse excursion (negative, worst intra-trade equity drawdown %)
  mfe: number;      // most favorable excursion (positive, best intra-trade equity gain %)
  finalPnl: number; // actual final P&L %
  side: string;
  isWin: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

// ── Main component ────────────────────────────────────────────────────────────

export function MaeMfeAnalysis({ result }: { result: BacktestResult }) {
  // Compute MAE/MFE from equity curve segments for each trade
  const points = useMemo((): MaeMfePoint[] => {
    const { trades, equity_curve: eq } = result;
    if (!trades.length || !eq?.length) return [];

    return trades.map((t, idx) => {
      const entryMs = new Date(t.entry_time).getTime();
      const exitMs = new Date(t.exit_time).getTime();

      // Find equity values during this trade
      const segment = eq.filter((e) => e.t >= entryMs && e.t <= exitMs);

      let mae = 0;
      let mfe = 0;

      if (segment.length >= 2) {
        const entryEq = segment[0].equity;
        if (entryEq > 0) {
          for (const pt of segment) {
            const chg = ((pt.equity - entryEq) / entryEq) * 100;
            if (chg < mae) mae = chg;
            if (chg > mfe) mfe = chg;
          }
        }
      } else {
        // Fallback: use final P&L as both MAE and MFE approximation
        mae = t.pnl_pct < 0 ? t.pnl_pct : 0;
        mfe = t.pnl_pct > 0 ? t.pnl_pct : 0;
      }

      return {
        tradeIdx: idx + 1,
        mae,
        mfe,
        finalPnl: t.pnl_pct,
        side: t.side,
        isWin: t.pnl_pct > 0,
      };
    });
  }, [result]);

  const stats = useMemo(() => {
    if (!points.length) return null;

    const winners = points.filter((p) => p.isWin);
    const losers = points.filter((p) => !p.isWin);

    const maes = [...points.map((p) => p.mae)].sort((a, b) => a - b);
    const mfes = [...points.map((p) => p.mfe)].sort((a, b) => a - b);

    const avgMae = maes.reduce((s, v) => s + v, 0) / maes.length;
    const avgMfe = mfes.reduce((s, v) => s + v, 0) / mfes.length;

    // MFE efficiency: how much of the MFE did we capture?
    const mfeEfficiencies = points
      .filter((p) => p.mfe > 0)
      .map((p) => Math.min(100, (p.finalPnl / p.mfe) * 100));
    const avgMfeEff =
      mfeEfficiencies.length > 0
        ? mfeEfficiencies.reduce((s, v) => s + v, 0) / mfeEfficiencies.length
        : 0;

    // MAE for winners — stop-loss candidates
    const winnerMaes = winners.map((p) => p.mae).sort((a, b) => a - b);
    const mae5Pct = percentile(winnerMaes, 5);  // 5th percentile MAE of winners (tight)
    const mae25Pct = percentile(winnerMaes, 25);

    return {
      avgMae,
      avgMfe,
      avgMfeEff,
      mae5Pct,
      mae25Pct,
      p95Mae: percentile(maes, 95),  // 95% of losses had MAE > this
      p50Mfe: percentile(mfes, 50),  // median MFE
      winnerCount: winners.length,
      loserCount: losers.length,
    };
  }, [points]);

  // Bucket P&L into groups for MFE distribution
  const mfeBuckets = useMemo(() => {
    if (!points.length) return [];
    const wins = points.filter((p) => p.isWin);
    const losses = points.filter((p) => !p.isWin);

    // Group by final P&L outcome
    const groups = [
      { label: "Win", items: wins, color: "#22c55e" },
      { label: "Loss", items: losses, color: "#ef4444" },
    ];

    return groups.map((g) => ({
      label: g.label,
      avgMFE: g.items.length ? g.items.reduce((s, p) => s + p.mfe, 0) / g.items.length : 0,
      avgMAE: g.items.length ? g.items.reduce((s, p) => s + p.mae, 0) / g.items.length : 0,
      color: g.color,
    }));
  }, [points]);

  if (!points.length) {
    return (
      <div className="text-center text-zinc-500 py-10">
        No trade data available for MAE/MFE analysis.
      </div>
    );
  }

  const hasEquityCurveData = result.equity_curve?.length > 0;

  return (
    <div className="space-y-5">
      {!hasEquityCurveData && (
        <div className="bg-yellow-950/20 border border-yellow-800/40 rounded-lg p-3 text-xs text-yellow-300">
          No intra-trade equity data available — MAE/MFE approximated from final P&L only.
          Run backtest to get detailed intra-trade tracking.
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Avg MAE",
            value: `${stats?.avgMae.toFixed(2)}%`,
            sub: "Avg adverse excursion",
            color: "text-red-400",
          },
          {
            label: "Avg MFE",
            value: `${stats?.avgMfe.toFixed(2)}%`,
            sub: "Avg favorable excursion",
            color: "text-emerald-400",
          },
          {
            label: "MFE Efficiency",
            value: `${stats?.avgMfeEff.toFixed(1)}%`,
            sub: "Profit captured vs peak",
            color:
              (stats?.avgMfeEff ?? 0) > 60 ? "text-emerald-400" : "text-orange-400",
          },
          {
            label: "Winner MAE P25",
            value: `${stats?.mae25Pct.toFixed(2)}%`,
            sub: "Stop-loss candidate",
            color: "text-zinc-200",
          },
        ].map((c) => (
          <div key={c.label} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
            <div className={`text-xl font-bold font-mono ${c.color}`}>{c.value}</div>
            <div className="text-[10px] text-zinc-600 mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* MAE vs Final P&L scatter */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-1">MAE vs Final P&L</h4>
          <p className="text-[10px] text-zinc-600 mb-3">
            If winners cluster at low MAE, tight stops would have captured them without early exit.
            If winners have high MAE, stops are cutting profits early.
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <ScatterChart margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis
                type="number"
                dataKey="mae"
                name="MAE"
                tick={{ fill: "#71717a", fontSize: 10 }}
                label={{ value: "MAE %", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }}
              />
              <YAxis
                type="number"
                dataKey="finalPnl"
                name="Final P&L"
                tick={{ fill: "#71717a", fontSize: 10 }}
                label={{ value: "P&L %", angle: -90, position: "insideLeft", fill: "#52525b", fontSize: 10 }}
              />
              <ReferenceLine y={0} stroke="#3f3f46" />
              <Scatter
                data={points}
                shape={(props) => {
                  const p = props as unknown as { cx: number; cy: number; payload: MaeMfePoint };
                  return (
                    <circle
                      cx={p.cx}
                      cy={p.cy}
                      r={3}
                      fill={p.payload.isWin ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.6)"}
                    />
                  );
                }}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* MFE vs Final P&L scatter */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-1">MFE vs Final P&L</h4>
          <p className="text-[10px] text-zinc-600 mb-3">
            Losers with high MFE that reversed = missed take-profit. Winners close to the MFE
            diagonal = efficient take-profit. Gap below diagonal = leaving money on the table.
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <ScatterChart margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis
                type="number"
                dataKey="mfe"
                name="MFE"
                tick={{ fill: "#71717a", fontSize: 10 }}
                label={{ value: "MFE %", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }}
              />
              <YAxis
                type="number"
                dataKey="finalPnl"
                name="Final P&L"
                tick={{ fill: "#71717a", fontSize: 10 }}
                label={{ value: "P&L %", angle: -90, position: "insideLeft", fill: "#52525b", fontSize: 10 }}
              />
              <ReferenceLine y={0} stroke="#3f3f46" />
              <Scatter
                data={points}
                shape={(props) => {
                  const p = props as unknown as { cx: number; cy: number; payload: MaeMfePoint };
                  return (
                    <circle
                      cx={p.cx}
                      cy={p.cy}
                      r={3}
                      fill={p.payload.isWin ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.6)"}
                    />
                  );
                }}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Avg MAE/MFE by outcome */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-3">
          Average MAE &amp; MFE by Trade Outcome
        </h4>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart
            data={mfeBuckets}
            margin={{ top: 4, right: 8, left: -10, bottom: 0 }}
            barCategoryGap="30%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 11 }} />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(1)}%`} />
            <ReferenceLine y={0} stroke="#3f3f46" />
            <Bar dataKey="avgMFE" name="Avg MFE" fill="#22c55e" fillOpacity={0.75} radius={[2, 2, 0, 0]}>
              {mfeBuckets.map((b, i) => (
                <Cell key={i} fill="#22c55e" fillOpacity={0.75} />
              ))}
            </Bar>
            <Bar dataKey="avgMAE" name="Avg MAE" fill="#ef4444" fillOpacity={0.75} radius={[2, 2, 0, 0]}>
              {mfeBuckets.map((b, i) => (
                <Cell key={i} fill="#ef4444" fillOpacity={0.75} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Stop-loss / TP recommendation */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-3">
          Stop-Loss / Take-Profit Calibration Hints
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="space-y-2">
            <p className="text-zinc-400 font-semibold">Stop-Loss Guidance</p>
            <p className="text-zinc-500">
              Winners had a 5th-percentile MAE of{" "}
              <span className="text-red-400 font-mono">{stats?.mae5Pct.toFixed(2)}%</span> and
              25th-percentile MAE of{" "}
              <span className="text-red-400 font-mono">{stats?.mae25Pct.toFixed(2)}%</span>.
              Setting stop-loss tighter than{" "}
              <span className="text-zinc-200 font-mono">{stats?.mae25Pct.toFixed(2)}%</span> would
              have stopped out 25% of eventual winners early.
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-zinc-400 font-semibold">Take-Profit Guidance</p>
            <p className="text-zinc-500">
              Median MFE is{" "}
              <span className="text-emerald-400 font-mono">{stats?.p50Mfe.toFixed(2)}%</span>.
              Average MFE efficiency is{" "}
              <span className={`font-mono font-bold ${(stats?.avgMfeEff ?? 0) > 60 ? "text-emerald-400" : "text-orange-400"}`}>
                {stats?.avgMfeEff.toFixed(1)}%
              </span>{" "}
              — meaning you captured{" "}
              {(stats?.avgMfeEff ?? 0).toFixed(1)}% of peak intra-trade gains on average.
              {(stats?.avgMfeEff ?? 0) < 60 && " Consider trailing stop-loss to lock in more profit."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
