"use client";

import type { CompareResult } from "@/lib/backtest-api";

export function CompareTable({ rows }: { rows: CompareResult[] }) {
  const successful = rows.filter((r) => r.success && r.result);

  // Sort by Sharpe ratio descending
  const sorted = [...successful].sort(
    (a, b) => (b.result!.metrics.sharpe_ratio - a.result!.metrics.sharpe_ratio),
  );

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <h3 className="font-semibold mb-3">
        Comparison ({successful.length} of {rows.length} succeeded)
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide border-b border-zinc-800">
              <th className="py-2 pr-3">Symbol</th>
              <th className="py-2 pr-3 text-right">Total return</th>
              <th className="py-2 pr-3 text-right">CAGR</th>
              <th className="py-2 pr-3 text-right">Sharpe</th>
              <th className="py-2 pr-3 text-right">Sortino</th>
              <th className="py-2 pr-3 text-right">Max DD</th>
              <th className="py-2 pr-3 text-right">Win rate</th>
              <th className="py-2 pr-3 text-right">Trades</th>
              <th className="py-2 text-right">vs B&H</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const r = row.result!;
              const m = r.metrics;
              const b = r.benchmark_metrics;
              const alpha = b ? m.total_return_pct - b.total_return_pct : 0;
              return (
                <tr key={row.symbol} className="border-b border-zinc-800/60">
                  <td className="py-2 pr-3 font-medium text-zinc-200">{row.symbol}</td>
                  <td className={`py-2 pr-3 text-right ${m.total_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {m.total_return_pct >= 0 ? "+" : ""}{m.total_return_pct.toFixed(2)}%
                  </td>
                  <td className="py-2 pr-3 text-right text-zinc-300">
                    {m.cagr_pct >= 0 ? "+" : ""}{m.cagr_pct.toFixed(2)}%
                  </td>
                  <td className={`py-2 pr-3 text-right ${m.sharpe_ratio >= 1 ? "text-emerald-400" : "text-zinc-300"}`}>
                    {m.sharpe_ratio.toFixed(2)}
                  </td>
                  <td className="py-2 pr-3 text-right text-zinc-300">{m.sortino_ratio.toFixed(2)}</td>
                  <td className="py-2 pr-3 text-right text-red-400">-{m.max_drawdown_pct.toFixed(1)}%</td>
                  <td className="py-2 pr-3 text-right text-zinc-300">{m.win_rate_pct.toFixed(0)}%</td>
                  <td className="py-2 pr-3 text-right text-zinc-500">{m.total_trades}</td>
                  <td className={`py-2 text-right ${alpha >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {alpha >= 0 ? "+" : ""}{alpha.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
            {rows.filter((r) => !r.success).map((row) => (
              <tr key={row.symbol} className="border-b border-zinc-800/60 opacity-60">
                <td className="py-2 pr-3 font-medium text-zinc-400">{row.symbol}</td>
                <td colSpan={8} className="py-2 text-zinc-500 text-xs">
                  Failed: {row.error}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
