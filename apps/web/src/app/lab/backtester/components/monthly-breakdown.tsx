"use client";

import { useMemo } from "react";
import type { BacktestResult } from "@/lib/backtest-api";

type MonthRow = {
  month: string;
  trades: number;
  pnl: number;
  wins: number;
  pctSum: number;
};

function buildRows(trades: BacktestResult["trades"]): MonthRow[] {
  const map = new Map<string, MonthRow>();
  for (const t of trades) {
    const key = t.exit_time.slice(0, 7); // "YYYY-MM"
    const row = map.get(key) ?? { month: key, trades: 0, pnl: 0, wins: 0, pctSum: 0 };
    row.pnl += t.pnl;
    row.wins += t.pnl >= 0 ? 1 : 0;
    row.pctSum += t.pnl_pct;
    row.trades++;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function computeStats(rows: MonthRow[]) {
  if (rows.length === 0) return null;
  const pnls = rows.map((r) => r.pnl);
  const avg = pnls.reduce((s, v) => s + v, 0) / pnls.length;
  const std = Math.sqrt(pnls.reduce((s, v) => s + (v - avg) ** 2, 0) / pnls.length);
  const best = rows.reduce((a, b) => (a.pnl > b.pnl ? a : b));
  const worst = rows.reduce((a, b) => (a.pnl < b.pnl ? a : b));
  // Rolling 3-month Sharpe (annualised, assumes monthly returns)
  const rolling: number[] = [];
  for (let i = 2; i < pnls.length; i++) {
    const slice = pnls.slice(i - 2, i + 1);
    const m = slice.reduce((s, v) => s + v, 0) / 3;
    const s = Math.sqrt(slice.reduce((ss, v) => ss + (v - m) ** 2, 0) / 3);
    rolling.push(s > 0 ? (m / s) * Math.sqrt(12) : 0);
  }
  const avgRollingSharpe = rolling.length > 0
    ? rolling.reduce((s, v) => s + v, 0) / rolling.length
    : 0;
  return { avg, std, best, worst, avgRollingSharpe };
}

function computeVaR(trades: BacktestResult["trades"]) {
  if (trades.length < 5) return null;
  const sorted = [...trades.map((t) => t.pnl)].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.05);
  const var95 = sorted[idx];
  const cvar95 = sorted.slice(0, idx + 1).reduce((s, v) => s + v, 0) / (idx + 1);
  return { var95, cvar95 };
}

// Simple inline bar using CSS width
function MiniBar({ value, maxAbs }: { value: number; maxAbs: number }) {
  const pct = maxAbs > 0 ? Math.abs(value) / maxAbs : 0;
  const w = `${(pct * 100).toFixed(1)}%`;
  return (
    <div className="flex items-center gap-1 justify-end">
      {value >= 0 ? (
        <>
          <div className="w-20 flex justify-end">
            <div className="h-2 bg-emerald-500/60 rounded-sm" style={{ width: w }} />
          </div>
        </>
      ) : (
        <>
          <div className="w-20 flex justify-end">
            <div className="h-2 bg-red-500/60 rounded-sm" style={{ width: w }} />
          </div>
        </>
      )}
    </div>
  );
}

export function MonthlyBreakdown({ trades }: { trades: BacktestResult["trades"] }) {
  const rows = useMemo(() => buildRows(trades), [trades]);
  const stats = useMemo(() => computeStats(rows), [rows]);
  const var_ = useMemo(() => computeVaR(trades), [trades]);

  if (trades.length === 0) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center text-zinc-500 text-sm">
        No trades to aggregate.
      </div>
    );
  }

  const maxAbsPnl = Math.max(...rows.map((r) => Math.abs(r.pnl)), 1);

  return (
    <div className="space-y-4">
      {/* Monthly table */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5">
        <h3 className="font-semibold mb-4">Monthly P&L Breakdown</h3>
        <div className="overflow-x-auto max-h-[480px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-900">
              <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide border-b border-zinc-800">
                <th className="py-2 pr-4">Month</th>
                <th className="py-2 pr-4 text-right">Trades</th>
                <th className="py-2 pr-4 text-right">Gross P&L</th>
                <th className="py-2 pr-4 text-right">Win Rate</th>
                <th className="py-2 pr-4 text-right">Avg %</th>
                <th className="py-2 text-right">Bar</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const winRate = r.trades > 0 ? r.wins / r.trades : 0;
                const avgPct = r.trades > 0 ? r.pctSum / r.trades : 0;
                return (
                  <tr key={r.month} className="border-b border-zinc-800/40 hover:bg-zinc-800/20">
                    <td className="py-1.5 pr-4 font-mono text-zinc-300">{r.month}</td>
                    <td className="py-1.5 pr-4 text-right text-zinc-400">{r.trades}</td>
                    <td className={`py-1.5 pr-4 text-right font-medium ${r.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {r.pnl >= 0 ? "+" : ""}{r.pnl.toFixed(2)}
                    </td>
                    <td className="py-1.5 pr-4 text-right text-zinc-300">
                      {(winRate * 100).toFixed(0)}%
                    </td>
                    <td className={`py-1.5 pr-4 text-right ${avgPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {avgPct >= 0 ? "+" : ""}{avgPct.toFixed(2)}%
                    </td>
                    <td className="py-1.5">
                      <MiniBar value={r.pnl} maxAbs={maxAbsPnl} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stats + VaR row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Rolling stats */}
        {stats && (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 space-y-3">
            <h4 className="font-medium text-sm text-zinc-300">Rolling Stats</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                { label: "Best month", value: `+$${stats.best.pnl.toFixed(2)}`, color: "text-emerald-400", sub: stats.best.month },
                { label: "Worst month", value: `$${stats.worst.pnl.toFixed(2)}`, color: "text-red-400", sub: stats.worst.month },
                { label: "Avg monthly P&L", value: `${stats.avg >= 0 ? "+" : ""}$${stats.avg.toFixed(2)}`, color: stats.avg >= 0 ? "text-emerald-400" : "text-red-400" },
                { label: "Std dev (monthly)", value: `$${stats.std.toFixed(2)}`, color: "text-zinc-300" },
                { label: "Avg 3m Sharpe", value: stats.avgRollingSharpe.toFixed(2), color: stats.avgRollingSharpe > 0.5 ? "text-emerald-400" : "text-zinc-300" },
                { label: "Total months", value: String(rows.length), color: "text-zinc-300" },
              ].map(({ label, value, color, sub }) => (
                <div key={label} className="bg-zinc-800/40 rounded p-2">
                  <div className="text-xs text-zinc-500">{label}</div>
                  <div className={`font-semibold ${color}`}>{value}</div>
                  {sub && <div className="text-xs text-zinc-600 font-mono">{sub}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VaR */}
        {var_ && (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 space-y-3">
            <h4 className="font-medium text-sm text-zinc-300">Risk Estimates (per trade)</h4>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Historical simulation — computed from the actual trade P&L distribution.
            </p>
            <div className="grid grid-cols-1 gap-3 text-sm">
              <div className="bg-zinc-800/40 rounded p-3">
                <div className="text-xs text-zinc-500 mb-1">VaR (95%) — 1-in-20 worst trade</div>
                <div className="text-red-400 font-semibold">${var_.var95.toFixed(2)}</div>
                <div className="text-xs text-zinc-600 mt-0.5">
                  5% of trades lose more than this amount.
                </div>
              </div>
              <div className="bg-zinc-800/40 rounded p-3">
                <div className="text-xs text-zinc-500 mb-1">CVaR (95%) — expected loss in tail</div>
                <div className="text-red-400 font-semibold">${var_.cvar95.toFixed(2)}</div>
                <div className="text-xs text-zinc-600 mt-0.5">
                  Average loss across the worst 5% of trades.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
