"use client";

import type { Metrics } from "@/lib/backtest-api";

interface KellyPanelProps {
  metrics: Metrics;
}

export function KellyPanel({ metrics }: KellyPanelProps) {
  if (metrics.total_trades < 10) return null;

  const p = metrics.win_rate_pct / 100;
  const q = 1 - p;

  // b = avg_win / avg_loss if available, else fall back to profit_factor
  const b =
    metrics.avg_win_pct !== undefined &&
    metrics.avg_loss_pct !== undefined &&
    metrics.avg_loss_pct !== 0
      ? Math.abs(metrics.avg_win_pct) / Math.abs(metrics.avg_loss_pct)
      : metrics.profit_factor;

  // Guard against degenerate inputs
  if (
    metrics.win_rate_pct === 0 ||
    metrics.profit_factor === 0 ||
    b === 0
  ) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5">
        <h3 className="font-semibold mb-3">Kelly Criterion Position Sizing</h3>
        <p className="text-sm text-zinc-400">
          Insufficient data to compute Kelly fraction. Need at least some winning
          trades and a positive profit factor.
        </p>
      </div>
    );
  }

  const kellyRaw = (p - q / b) * 100;
  const kelly_pct = Math.min(kellyRaw, 100);
  const half_kelly = kelly_pct / 2;
  const quarter_kelly = kelly_pct / 4;

  // Gauge scale: 0-50%
  const GAUGE_MAX = 50;
  function gaugeLeft(val: number): string {
    return `${Math.min((val / GAUGE_MAX) * 100, 100).toFixed(2)}%`;
  }

  const avgWinDisplay =
    metrics.avg_win_pct !== undefined
      ? `${metrics.avg_win_pct.toFixed(2)}%`
      : "—";
  const avgLossDisplay =
    metrics.avg_loss_pct !== undefined
      ? `${metrics.avg_loss_pct.toFixed(2)}%`
      : "—";

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 space-y-5">
      <h3 className="font-semibold">Kelly Criterion Position Sizing</h3>

      {/* Gauge bar */}
      <div>
        <div className="relative h-4 rounded overflow-hidden">
          {/* Background zones */}
          <div className="absolute inset-0 flex">
            <div className="bg-emerald-900/60" style={{ width: "20%" }} title="0–10%" />
            <div className="bg-yellow-900/60" style={{ width: "30%" }} title="10–25%" />
            <div className="bg-red-900/60" style={{ width: "50%" }} title="25%+" />
          </div>

          {/* Quarter-Kelly tick */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-cyan-400"
            style={{ left: gaugeLeft(quarter_kelly) }}
            title={`Quarter-Kelly: ${quarter_kelly.toFixed(1)}%`}
          />
          {/* Half-Kelly tick */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-yellow-400"
            style={{ left: gaugeLeft(half_kelly) }}
            title={`Half-Kelly: ${half_kelly.toFixed(1)}%`}
          />
          {/* Full Kelly tick */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-400"
            style={{ left: gaugeLeft(kelly_pct) }}
            title={`Full Kelly: ${kelly_pct.toFixed(1)}%`}
          />
        </div>

        {/* Scale labels */}
        <div className="flex justify-between text-[10px] text-zinc-500 mt-0.5">
          <span>0%</span>
          <span>10%</span>
          <span>25%</span>
          <span>50%+</span>
        </div>
      </div>

      {/* Recommendation cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-zinc-800/60 rounded-lg p-3 border border-red-900/30">
          <div className="text-xs text-zinc-400 mb-1">Full Kelly</div>
          <div className="text-lg font-bold text-red-400">
            {kelly_pct.toFixed(1)}%
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            Max theoretical growth — not recommended
          </div>
        </div>
        <div className="bg-zinc-800/60 rounded-lg p-3 border border-yellow-900/30">
          <div className="text-xs text-zinc-400 mb-1">Half-Kelly</div>
          <div className="text-lg font-bold text-yellow-400">
            {half_kelly.toFixed(1)}%
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            Recommended for professionals
          </div>
        </div>
        <div className="bg-zinc-800/60 rounded-lg p-3 border border-cyan-900/30">
          <div className="text-xs text-zinc-400 mb-1">Quarter-Kelly</div>
          <div className="text-lg font-bold text-cyan-400">
            {quarter_kelly.toFixed(1)}%
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            Conservative — limited drawdown
          </div>
        </div>
      </div>

      {/* Guidance note */}
      <p className="text-sm text-zinc-300">
        Half-Kelly suggests{" "}
        <span className="text-yellow-400 font-semibold">
          {half_kelly.toFixed(1)}%
        </span>{" "}
        position size for optimal risk-adjusted growth.
      </p>

      {/* Context line */}
      <div className="text-xs text-zinc-500 border-t border-zinc-800 pt-3">
        Based on: Win rate{" "}
        <span className="text-zinc-300">{metrics.win_rate_pct.toFixed(1)}%</span>
        {" · "}Avg win{" "}
        <span className="text-zinc-300">{avgWinDisplay}</span>
        {" · "}Avg loss{" "}
        <span className="text-zinc-300">{avgLossDisplay}</span>
        {" · "}Ratio{" "}
        <span className="text-zinc-300">{b.toFixed(2)}:1</span>
      </div>
    </div>
  );
}
