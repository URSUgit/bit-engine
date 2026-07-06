"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { StrategyInfo } from "@/lib/backtest-api";

interface SensitivityChartProps {
  strategy: StrategyInfo;
  symbol: string;
  periodDays: number;
  interval: string;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  positionPct: number;
  currentParams: Record<string, number>;
}

interface SensitivityPoint {
  param_value: number;
  metric_value: number | null;
  total_return_pct: number | null;
  total_trades: number;
  success: boolean;
  error: string | null;
}

const METRIC_OPTIONS = [
  { value: "sharpe_ratio", label: "Sharpe Ratio" },
  { value: "sortino_ratio", label: "Sortino Ratio" },
  { value: "calmar_ratio", label: "Calmar Ratio" },
  { value: "total_return_pct", label: "Total Return %" },
  { value: "win_rate_pct", label: "Win Rate %" },
  { value: "max_drawdown_pct", label: "Max Drawdown %" },
];

export function SensitivityChart({
  strategy,
  symbol,
  periodDays,
  interval,
  initialCapital,
  commissionPct,
  slippagePct,
  positionPct,
  currentParams,
}: SensitivityChartProps) {
  // Filter eligible params (numeric, with min and max defined)
  const eligibleParams = Object.entries(strategy.params_schema).filter(
    ([, spec]) =>
      spec.type !== "bool" &&
      spec.min !== undefined &&
      spec.max !== undefined
  );

  const [selectedParam, setSelectedParam] = useState<string>(
    () => eligibleParams[0]?.[0] ?? ""
  );
  const [selectedMetric, setSelectedMetric] = useState<string>("sharpe_ratio");
  const [data, setData] = useState<SensitivityPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (eligibleParams.length === 0) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center text-zinc-400 text-sm">
        No sweepable parameters (need numeric params with min/max defined).
      </div>
    );
  }

  function generateSweepValues(paramName: string): number[] {
    const spec = strategy.params_schema[paramName];
    if (spec?.min === undefined || spec?.max === undefined) return [];
    const min = spec.min;
    const max = spec.max;
    return Array.from({ length: 12 }, (_, i) =>
      Math.round((min + (i * (max - min)) / 11) * 100) / 100
    );
  }

  async function runSensitivity() {
    if (!selectedParam) return;
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const paramValues = generateSweepValues(selectedParam);
      const startDate = new Date(Date.now() - periodDays * 86400000)
        .toISOString()
        .slice(0, 10);
      const endDate = new Date().toISOString().slice(0, 10);

      // base_params: all current params except the swept one
      const baseParams: Record<string, number> = {};
      for (const [k, v] of Object.entries(currentParams)) {
        if (k !== selectedParam) baseParams[k] = v;
      }

      const res = await fetch("/api/v1/backtest/sensitivity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          strategy: strategy.name,
          param_name: selectedParam,
          param_values: paramValues,
          start_date: startDate,
          end_date: endDate,
          interval,
          initial_capital: initialCapital,
          commission_pct: commissionPct / 100,
          slippage_pct: slippagePct / 100,
          position_size_pct: positionPct / 100,
          base_params: baseParams,
          metric: selectedMetric,
        }),
      });

      if (!res.ok) {
        const detail = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(detail.detail ?? res.statusText);
      }

      const points: SensitivityPoint[] = await res.json();
      setData(points);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const currentParamValue =
    selectedParam in currentParams ? currentParams[selectedParam] : undefined;

  // Find metric value at current param (for dot coloring)
  const currentPointMetric = data?.find(
    (p) => p.success && p.param_value === currentParamValue
  )?.metric_value;

  const chartData = data
    ?.filter((p) => p.success && p.metric_value !== null)
    .map((p) => ({ param_value: p.param_value, metric_value: p.metric_value }));

  const metricLabel =
    METRIC_OPTIONS.find((m) => m.value === selectedMetric)?.label ?? selectedMetric;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 space-y-4">
      <h3 className="font-semibold">Parameter Sensitivity</h3>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs text-zinc-400">Parameter</label>
          <select
            value={selectedParam}
            onChange={(e) => {
              setSelectedParam(e.target.value);
              setData(null);
            }}
            className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded px-2 py-1.5"
          >
            {eligibleParams.map(([name, spec]) => (
              <option key={name} value={name}>
                {spec.label ?? name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-zinc-400">Metric</label>
          <select
            value={selectedMetric}
            onChange={(e) => {
              setSelectedMetric(e.target.value);
              setData(null);
            }}
            className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded px-2 py-1.5"
          >
            {METRIC_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={runSensitivity}
          disabled={loading || !selectedParam}
          className="px-4 py-1.5 rounded-md text-sm font-medium bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {loading ? "Running…" : "Run Sensitivity"}
        </button>
      </div>

      {/* Sweep range info */}
      {selectedParam && (
        <p className="text-xs text-zinc-500">
          {(() => {
            const spec = strategy.params_schema[selectedParam];
            if (!spec || spec.min === undefined || spec.max === undefined)
              return null;
            const vals = generateSweepValues(selectedParam);
            return `Sweep: ${vals[0]} → ${vals[vals.length - 1]} (12 steps) · Current: ${currentParamValue ?? "—"}`;
          })()}
        </p>
      )}

      {/* Error */}
      {error && (
        <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 p-2 rounded">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="h-64 flex items-center justify-center text-zinc-400 text-sm">
          Running {12} backtests…
        </div>
      )}

      {/* Chart */}
      {!loading && chartData && chartData.length > 0 && (
        <div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart
              data={chartData}
              margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
              <XAxis
                dataKey="param_value"
                stroke="#71717a"
                tick={{ fontSize: 11 }}
                label={{
                  value: selectedParam,
                  position: "insideBottom",
                  offset: -4,
                  fill: "#71717a",
                  fontSize: 11,
                }}
              />
              <YAxis
                stroke="#71717a"
                tick={{ fontSize: 11 }}
                label={{
                  value: metricLabel,
                  angle: -90,
                  position: "insideLeft",
                  offset: 10,
                  fill: "#71717a",
                  fontSize: 11,
                }}
              />
              <Tooltip
                contentStyle={{
                  background: "#18181b",
                  border: "1px solid #3f3f46",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
                formatter={(val) => [typeof val === "number" ? val.toFixed(4) : String(val), metricLabel]}
                labelFormatter={(label) => `${selectedParam}: ${label}`}
              />
              {currentParamValue !== undefined && (
                <ReferenceLine
                  x={currentParamValue}
                  stroke="#22d3ee"
                  strokeDasharray="4 2"
                  label={{
                    value: "Current",
                    fill: "#22d3ee",
                    fontSize: 10,
                    position: "top",
                  }}
                />
              )}
              <Line
                type="monotone"
                dataKey="metric_value"
                stroke="#a1a1aa"
                strokeWidth={2}
                dot={(props) => {
                  const { cx, cy, payload } = props as {
                    cx: number;
                    cy: number;
                    payload: { param_value: number; metric_value: number };
                  };
                  let fill = "#a1a1aa";
                  if (
                    currentParamValue !== undefined &&
                    payload.param_value === currentParamValue
                  ) {
                    fill = "#22d3ee";
                  } else if (
                    currentPointMetric !== undefined &&
                    currentPointMetric !== null &&
                    payload.metric_value > currentPointMetric
                  ) {
                    fill = "#4ade80";
                  } else if (
                    currentPointMetric !== undefined &&
                    currentPointMetric !== null &&
                    payload.metric_value < currentPointMetric
                  ) {
                    fill = "#f87171";
                  }
                  return (
                    <circle
                      key={`dot-${payload.param_value}`}
                      cx={cx}
                      cy={cy}
                      r={4}
                      fill={fill}
                      stroke="none"
                    />
                  );
                }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>

          {/* Failed points summary */}
          {data && data.some((p) => !p.success) && (
            <p className="text-xs text-yellow-600 mt-1">
              {data.filter((p) => !p.success).length} point(s) failed to run.
            </p>
          )}
        </div>
      )}

      {/* No data yet */}
      {!loading && !data && !error && (
        <div className="h-40 flex items-center justify-center text-zinc-500 text-sm border border-dashed border-zinc-800 rounded">
          Select a parameter and metric, then click Run Sensitivity.
        </div>
      )}
    </div>
  );
}
