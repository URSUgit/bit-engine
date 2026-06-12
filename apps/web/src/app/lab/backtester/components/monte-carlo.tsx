"use client";

import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { backtestApi, type BacktestResult, type MonteCarloResult } from "@/lib/backtest-api";

interface MonteCarloPanelProps {
  result: BacktestResult;
}

function fmtDollar(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function StatCard({
  label,
  value,
  danger,
  muted,
}: {
  label: string;
  value: string;
  danger?: boolean;
  muted?: boolean;
}) {
  const color = danger
    ? "text-red-400"
    : muted
    ? "text-zinc-400"
    : "text-emerald-400";
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-lg font-semibold mt-1 ${color}`}>{value}</div>
    </div>
  );
}

// Custom tooltip for the recharts AreaChart
function BandTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: number;
}) {
  if (!active || !payload || payload.length === 0) return null;

  // Find the values we care about — payload names match area dataKeys
  const get = (name: string) =>
    payload.find((p) => p.name === name)?.value ?? 0;

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded p-2 text-xs space-y-1">
      <div className="text-zinc-400 font-medium mb-1">Trade #{(label ?? 0) + 1}</div>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" />
        <span className="text-zinc-400">p95:</span>
        <span className="text-zinc-200">{fmtDollar(get("p95"))}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-cyan-500 inline-block" />
        <span className="text-zinc-400">p75:</span>
        <span className="text-zinc-200">{fmtDollar(get("p75"))}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-cyan-300 inline-block" />
        <span className="text-zinc-400">p50:</span>
        <span className="text-zinc-200 font-semibold">{fmtDollar(get("p50"))}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
        <span className="text-zinc-400">p25:</span>
        <span className="text-zinc-200">{fmtDollar(get("p25"))}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
        <span className="text-zinc-400">p5:</span>
        <span className="text-zinc-200">{fmtDollar(get("p5"))}</span>
      </div>
    </div>
  );
}

export function MonteCarloPanel({ result }: MonteCarloPanelProps) {
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const N_SIMS = 1000;

  async function runSimulation() {
    setLoading(true);
    setError(null);
    try {
      const r = await backtestApi.monteCarlo(
        result.trades,
        result.metrics.initial_capital,
        N_SIMS,
      );
      setMcResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const initialCapital = result.metrics.initial_capital;

  // Build chart data — recharts needs one entry per step with individual values
  // We use "stacked" areas but really want bands, so we encode:
  //   p5_base = p5
  //   p25_base = p25 - p5   (delta above p5)
  //   p50_val  = p50 (median line, not stacked)
  //   p75_base = p75 - p25  (delta above p25)
  //   p95_base = p95 - p75  (delta above p75)
  // This approach avoids true stacking complexity; instead we just chart each
  // percentile directly and use fill between consecutive ones.
  const chartData = mcResult
    ? mcResult.equity_band.map((b) => ({
        step: b.step,
        p5: b.p5,
        p25: b.p25,
        p50: b.p50,
        p75: b.p75,
        p95: b.p95,
      }))
    : [];

  const positivePct =
    mcResult ? (mcResult.positive_probability * 100).toFixed(1) : "—";
  const positiveWidth = mcResult
    ? Math.round(mcResult.positive_probability * 100)
    : 0;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-5">
      {/* Header + trigger */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-semibold text-zinc-100">Monte Carlo Simulation</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Randomize trade order {N_SIMS.toLocaleString()} times to show the distribution of possible outcomes
          </p>
        </div>
        {!mcResult && (
          <button
            onClick={runSimulation}
            disabled={loading}
            className="px-4 py-2 rounded-md bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-semibold text-sm transition"
          >
            {loading ? `Simulating ${N_SIMS.toLocaleString()} random trade sequences…` : `Run Monte Carlo (${N_SIMS.toLocaleString()} sims)`}
          </button>
        )}
        {mcResult && (
          <button
            onClick={runSimulation}
            disabled={loading}
            className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 text-xs border border-zinc-700 transition"
          >
            {loading ? "Re-simulating…" : "Re-run"}
          </button>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 p-2 rounded">
          {error}
        </div>
      )}

      {loading && !mcResult && (
        <div className="py-12 text-center text-zinc-400 text-sm">
          Simulating {N_SIMS.toLocaleString()} random trade sequences…
        </div>
      )}

      {mcResult && (
        <>
          {/* Key stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Median outcome"
              value={fmtDollar(mcResult.p50_equity)}
              muted={false}
            />
            <StatCard
              label="Best case (p95)"
              value={fmtDollar(mcResult.p95_equity)}
            />
            <StatCard
              label="Worst case (p5)"
              value={fmtDollar(mcResult.p5_equity)}
              danger={mcResult.p5_equity < initialCapital}
              muted={mcResult.p5_equity >= initialCapital}
            />
            <StatCard
              label="Ruin probability"
              value={fmtPct(mcResult.ruin_probability)}
              danger={mcResult.ruin_probability > 0.1}
              muted={mcResult.ruin_probability <= 0.1}
            />
          </div>

          {/* Probability bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-300 font-medium">
                Profitable in{" "}
                <span
                  className={
                    mcResult.positive_probability >= 0.5
                      ? "text-emerald-400"
                      : "text-red-400"
                  }
                >
                  {positivePct}%
                </span>{" "}
                of simulations
              </span>
              <span className="text-xs text-zinc-500">
                {mcResult.n_simulations.toLocaleString()} sims
              </span>
            </div>
            <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  mcResult.positive_probability >= 0.5
                    ? "bg-gradient-to-r from-emerald-600 to-emerald-400"
                    : "bg-gradient-to-r from-red-700 to-red-500"
                }`}
                style={{ width: `${positiveWidth}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-zinc-600">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Equity band chart */}
          {chartData.length > 0 && (
            <div>
              <div className="text-xs text-zinc-500 mb-2 font-medium uppercase tracking-wide">
                Equity distribution across trade sequence
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart
                  data={chartData}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis
                    dataKey="step"
                    tick={{ fill: "#71717a", fontSize: 10 }}
                    tickFormatter={(v) => `T${v + 1}`}
                    label={{
                      value: "Trade #",
                      position: "insideBottom",
                      offset: -2,
                      fill: "#52525b",
                      fontSize: 10,
                    }}
                  />
                  <YAxis
                    tick={{ fill: "#71717a", fontSize: 10 }}
                    tickFormatter={(v) =>
                      v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                    }
                    width={52}
                  />
                  <Tooltip content={<BandTooltip />} />
                  <ReferenceLine
                    y={initialCapital}
                    stroke="#52525b"
                    strokeDasharray="5 3"
                    label={{
                      value: "Initial capital",
                      position: "right",
                      fill: "#52525b",
                      fontSize: 9,
                    }}
                  />

                  {/* p5-p95 outer band (lightest) */}
                  <Area
                    type="monotone"
                    dataKey="p95"
                    stroke="rgba(6,182,212,0.4)"
                    strokeWidth={1}
                    fill="rgba(6,182,212,0.08)"
                    fillOpacity={1}
                    name="p95"
                    legendType="none"
                  />
                  <Area
                    type="monotone"
                    dataKey="p5"
                    stroke="rgba(6,182,212,0.4)"
                    strokeWidth={1}
                    fill="rgba(6,182,212,0.0)"
                    fillOpacity={1}
                    name="p5"
                    legendType="none"
                  />

                  {/* p25-p75 inner band (medium) */}
                  <Area
                    type="monotone"
                    dataKey="p75"
                    stroke="rgba(6,182,212,0.7)"
                    strokeWidth={1}
                    fill="rgba(6,182,212,0.18)"
                    fillOpacity={1}
                    name="p75"
                    legendType="none"
                  />
                  <Area
                    type="monotone"
                    dataKey="p25"
                    stroke="rgba(6,182,212,0.7)"
                    strokeWidth={1}
                    fill="rgba(6,182,212,0.0)"
                    fillOpacity={1}
                    name="p25"
                    legendType="none"
                  />

                  {/* p50 median line (solid) */}
                  <Area
                    type="monotone"
                    dataKey="p50"
                    stroke="#06b6d4"
                    strokeWidth={2}
                    fill="none"
                    fillOpacity={0}
                    dot={false}
                    name="p50"
                    legendType="none"
                  />
                </AreaChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-1 text-[10px] text-zinc-500 flex-wrap">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-4 h-0.5 bg-cyan-500/40" style={{ border: "1px solid rgba(6,182,212,0.4)" }} />
                  p5–p95 range
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-4 h-0.5 bg-cyan-500/70" style={{ border: "1px solid rgba(6,182,212,0.7)" }} />
                  p25–p75 range
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-4 h-0.5 bg-cyan-400" />
                  Median (p50)
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-4 border-t border-dashed border-zinc-600" />
                  Initial capital
                </span>
              </div>
            </div>
          )}

          {/* Drawdown distribution */}
          <div>
            <div className="text-xs text-zinc-500 mb-2 font-medium uppercase tracking-wide">
              Max drawdown distribution
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">Best case (p5) max DD</div>
                <div className="text-lg font-semibold mt-1 text-emerald-400">
                  {mcResult.p5_max_dd.toFixed(1)}%
                </div>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">Typical (p50) max DD</div>
                <div className="text-lg font-semibold mt-1 text-yellow-400">
                  {mcResult.p50_max_dd.toFixed(1)}%
                </div>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded p-3">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">Severe (p95) max DD</div>
                <div
                  className={`text-lg font-semibold mt-1 ${
                    mcResult.p95_max_dd > 50 ? "text-red-500" : "text-red-400"
                  }`}
                >
                  {mcResult.p95_max_dd.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>

          {/* Summary row */}
          <div className="pt-3 border-t border-zinc-800 flex flex-wrap gap-4 text-xs text-zinc-500">
            <span>
              Expected final equity:{" "}
              <span className="text-zinc-300 font-medium">
                {fmtDollar(mcResult.expected_final_equity)}
              </span>
            </span>
            <span>
              Std dev:{" "}
              <span className="text-zinc-300 font-medium">
                {fmtDollar(mcResult.std_final_equity)}
              </span>
            </span>
            <span>
              {mcResult.n_simulations.toLocaleString()} simulations over{" "}
              {result.trades.length} trades
            </span>
          </div>
        </>
      )}
    </div>
  );
}
