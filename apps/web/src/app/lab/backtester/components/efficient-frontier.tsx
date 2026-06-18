"use client";

import { useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { StrategyInfo } from "@/lib/backtest-api";

// ── Types ──────────────────────────────────────────────────────────────────────

interface FrontierPoint {
  volatility: number;
  expected_return: number;
  sharpe: number;
  weights: number[];
}

interface FrontierResult {
  strategies: string[];
  frontier_points: FrontierPoint[];
  optimal_point: FrontierPoint;
  min_vol_point: FrontierPoint;
  equal_weight_point: FrontierPoint;
  annual_rf_rate: number;
}

interface EfficientFrontierProps {
  symbol: string;
  interval: string;
  periodDays: number;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  positionPct: number;
  strategies: StrategyInfo[];
}

// ── Colours ────────────────────────────────────────────────────────────────────

const PIE_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6",
  "#a78bfa", "#fb923c", "#34d399", "#f87171", "#60a5fa",
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtPct(v: number): string {
  return (v * 100).toFixed(2) + "%";
}

function fmtPct2(v: number): string {
  return (v * 100).toFixed(1) + "%";
}

// Sparkline-style bar for weight display in the comparison table
function WeightBar({ weights, colors }: { weights: number[]; colors: string[] }) {
  return (
    <div className="flex h-4 w-full rounded overflow-hidden min-w-[80px]">
      {weights.map((w, i) =>
        w > 0.005 ? (
          <div
            key={i}
            style={{ width: `${w * 100}%`, backgroundColor: colors[i % colors.length] }}
            title={`${((w) * 100).toFixed(1)}%`}
          />
        ) : null,
      )}
    </div>
  );
}

// Custom scatter shape: star for optimal point
function StarShape(props: {
  cx?: number;
  cy?: number;
  fill?: string;
  size?: number;
}) {
  const { cx = 0, cy = 0, fill = "#f59e0b", size = 12 } = props;
  const r = size;
  const ir = r * 0.4;
  const points = Array.from({ length: 5 }, (_, i) => {
    const outer = ((i * 2 * Math.PI) / 5) - Math.PI / 2;
    const inner = outer + Math.PI / 5;
    return [
      cx + r * Math.cos(outer),
      cy + r * Math.sin(outer),
      cx + ir * Math.cos(inner),
      cy + ir * Math.sin(inner),
    ];
  });
  const d = points.map(([ox, oy, ix, iy], i) =>
    `${i === 0 ? "M" : "L"}${ox},${oy} L${ix},${iy}`
  ).join(" ") + " Z";
  return <path d={d} fill={fill} />;
}

// Custom tooltip for scatter chart
function FrontierTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: FrontierPoint & { label?: string } }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded p-2 text-xs text-zinc-200 shadow-lg">
      {p.label && <div className="font-semibold text-white mb-1">{p.label}</div>}
      <div>Return: {fmtPct(p.expected_return)}</div>
      <div>Vol: {fmtPct(p.volatility)}</div>
      <div>Sharpe: {p.sharpe.toFixed(3)}</div>
    </div>
  );
}

// Custom pie label — uses optional fields from PieLabelRenderProps
function PieLabel({
  cx = 0,
  cy = 0,
  midAngle = 0,
  outerRadius = 0,
  percent = 0,
}: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  percent?: number;
  name?: string;
}) {
  if (percent < 0.03) return null;
  const RADIAN = Math.PI / 180;
  const radius = outerRadius * 1.15;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="#e4e4e7"
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
      fontSize={11}
    >
      {`${(percent * 100).toFixed(1)}%`}
    </text>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function EfficientFrontier({
  symbol,
  interval,
  periodDays,
  initialCapital,
  commissionPct,
  slippagePct,
  positionPct,
  strategies,
}: EfficientFrontierProps) {
  const strategyNames = strategies.map((s) => s.name);
  const maxStrategies = Math.min(strategyNames.length, 8);
  const defaultSelected = strategyNames.slice(0, Math.min(5, maxStrategies));

  const [selected, setSelected] = useState<string[]>(defaultSelected);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FrontierResult | null>(null);

  function toggleStrategy(name: string) {
    setSelected((prev) => {
      if (prev.includes(name)) {
        return prev.length <= 2 ? prev : prev.filter((s) => s !== name);
      }
      return prev.length >= 8 ? prev : [...prev, name];
    });
  }

  async function runFrontier() {
    if (selected.length < 2) {
      setError("Select at least 2 strategies.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const body = {
        strategies: selected,
        symbol,
        interval,
        period_days: periodDays,
        initial_capital: initialCapital,
        commission_pct: commissionPct / 100,
        slippage_pct: slippagePct / 100,
        position_size_pct: positionPct / 100,
        risk_free_rate: 0.05,
      };
      const res = await fetch("/api/v1/backtest/frontier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text || res.statusText}`);
      }
      const data = (await res.json()) as FrontierResult;
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Scatter chart data
  const frontierData = result
    ? result.frontier_points.map((p) => ({
        ...p,
        volatility: p.volatility * 100,
        expected_return: p.expected_return * 100,
      }))
    : [];

  const optimalData = result
    ? [
        {
          ...result.optimal_point,
          volatility: result.optimal_point.volatility * 100,
          expected_return: result.optimal_point.expected_return * 100,
          label: `Optimal (Sharpe: ${result.optimal_point.sharpe.toFixed(2)})`,
        },
      ]
    : [];

  const minVolData = result
    ? [
        {
          ...result.min_vol_point,
          volatility: result.min_vol_point.volatility * 100,
          expected_return: result.min_vol_point.expected_return * 100,
          label: "Min Volatility",
        },
      ]
    : [];

  const eqWeightData = result
    ? [
        {
          ...result.equal_weight_point,
          volatility: result.equal_weight_point.volatility * 100,
          expected_return: result.equal_weight_point.expected_return * 100,
          label: "Equal Weight",
        },
      ]
    : [];

  // Pie data
  const pieData = result
    ? result.strategies.map((name, i) => ({
        name,
        value: result.optimal_point.weights[i] ?? 0,
      })).filter((d) => d.value > 0.005)
    : [];

  // Comparison table rows
  type TableRow = {
    label: string;
    point: FrontierPoint;
    isOptimal: boolean;
  };
  const tableRows: TableRow[] = result
    ? [
        { label: "Optimal (Max Sharpe)", point: result.optimal_point, isOptimal: true },
        { label: "Min Volatility", point: result.min_vol_point, isOptimal: false },
        { label: "Equal Weight (1/N)", point: result.equal_weight_point, isOptimal: false },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">Efficient Frontier</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Markowitz mean-variance optimisation across selected strategies
          </p>
        </div>
      </div>

      {/* Strategy picker */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-zinc-300">
            Select strategies ({selected.length} / 8)
          </span>
          <button
            onClick={runFrontier}
            disabled={loading || selected.length < 2}
            className="px-4 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
          >
            {loading ? "Computing…" : "Run Frontier"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {strategyNames.map((name) => {
            const checked = selected.includes(name);
            return (
              <label
                key={name}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded border cursor-pointer text-xs transition-colors ${
                  checked
                    ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleStrategy(name)}
                  className="sr-only"
                />
                <span
                  className={`w-3 h-3 rounded-sm border flex items-center justify-center ${
                    checked ? "bg-indigo-500 border-indigo-500" : "border-zinc-500"
                  }`}
                >
                  {checked && (
                    <svg viewBox="0 0 8 8" className="w-2 h-2 text-white fill-current">
                      <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" />
                    </svg>
                  )}
                </span>
                {name}
              </label>
            );
          })}
        </div>
      </div>

      {/* Loading pulse */}
      {loading && (
        <div className="space-y-3 animate-pulse">
          <div className="h-64 bg-zinc-800 rounded-lg" />
          <div className="h-64 bg-zinc-800 rounded-lg" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-900/20 border border-red-700 rounded p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="space-y-6">
          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Efficient Frontier scatter chart */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-zinc-300 mb-4">
                Efficient Frontier
              </h4>
              <ResponsiveContainer width="100%" height={300}>
                <ScatterChart margin={{ top: 10, right: 30, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                  <XAxis
                    type="number"
                    dataKey="volatility"
                    name="Volatility"
                    unit="%"
                    tick={{ fill: "#a1a1aa", fontSize: 11 }}
                    label={{ value: "Volatility %", position: "insideBottom", offset: -10, fill: "#71717a", fontSize: 11 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="expected_return"
                    name="Return"
                    unit="%"
                    tick={{ fill: "#a1a1aa", fontSize: 11 }}
                    label={{ value: "Return %", angle: -90, position: "insideLeft", fill: "#71717a", fontSize: 11 }}
                  />
                  <Tooltip content={<FrontierTooltip />} />

                  {/* Frontier points */}
                  <Scatter
                    name="Frontier"
                    data={frontierData}
                    fill="#52525b"
                    opacity={0.7}
                    r={3}
                  />

                  {/* Min-vol point */}
                  <Scatter
                    name="Min Volatility"
                    data={minVolData}
                    fill="#3b82f6"
                    r={7}
                    shape="circle"
                  />

                  {/* Equal-weight point */}
                  <Scatter
                    name="Equal Weight"
                    data={eqWeightData}
                    fill="#06b6d4"
                    r={7}
                    shape="circle"
                  />

                  {/* Optimal point — star */}
                  <Scatter
                    name="Optimal"
                    data={optimalData}
                    fill="#f59e0b"
                    r={12}
                    shape={<StarShape fill="#f59e0b" size={12} />}
                  />
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 mt-2 justify-center text-xs text-zinc-400">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-full bg-zinc-600" /> Frontier
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-full bg-blue-500" /> Min Vol
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-full bg-cyan-500" /> Equal Weight
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 bg-amber-400" style={{ clipPath: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)" }} />
                  ★ Optimal
                </span>
              </div>
            </div>

            {/* Allocation pie chart */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-zinc-300 mb-2">
                Optimal Allocation
              </h4>

              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    labelLine={false}
                    label={(p) => <PieLabel {...p} />}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend
                    formatter={(value: string) => (
                      <span className="text-xs text-zinc-300">{value}</span>
                    )}
                  />
                  <Tooltip
                    formatter={(value) => [`${(Number(value) * 100).toFixed(1)}%`, "Weight"]}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Stat cards */}
              <div className="grid grid-cols-3 gap-2 mt-3">
                {[
                  { label: "Optimal Sharpe", value: result.optimal_point.sharpe.toFixed(3) },
                  {
                    label: "Optimal Return",
                    value: fmtPct(result.optimal_point.expected_return),
                  },
                  {
                    label: "Optimal Vol",
                    value: fmtPct(result.optimal_point.volatility),
                  },
                ].map((card) => (
                  <div
                    key={card.label}
                    className="bg-zinc-800 rounded p-2 text-center"
                  >
                    <div className="text-xs text-zinc-500">{card.label}</div>
                    <div className="text-sm font-semibold text-zinc-100 mt-0.5">
                      {card.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Comparison table */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800">
              <h4 className="text-sm font-semibold text-zinc-300">Portfolio Comparison</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500">
                    <th className="text-left px-4 py-2 font-medium">Portfolio</th>
                    <th className="text-left px-4 py-2 font-medium">Weights</th>
                    <th className="text-right px-4 py-2 font-medium">Exp. Return</th>
                    <th className="text-right px-4 py-2 font-medium">Volatility</th>
                    <th className="text-right px-4 py-2 font-medium">Sharpe</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row) => (
                    <tr
                      key={row.label}
                      className={`border-b border-zinc-800/50 ${
                        row.isOptimal
                          ? "bg-amber-500/5 border-amber-500/20"
                          : "hover:bg-zinc-800/40"
                      }`}
                    >
                      <td className="px-4 py-3 text-zinc-200 font-medium whitespace-nowrap">
                        {row.isOptimal && (
                          <span className="text-amber-400 mr-1.5">★</span>
                        )}
                        {row.label}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1 min-w-[120px]">
                          <WeightBar
                            weights={row.point.weights}
                            colors={PIE_COLORS}
                          />
                          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                            {result.strategies.map((name, i) =>
                              (row.point.weights[i] ?? 0) > 0.005 ? (
                                <span key={name} className="text-zinc-400">
                                  <span
                                    style={{ color: PIE_COLORS[i % PIE_COLORS.length] }}
                                  >
                                    {name}
                                  </span>
                                  {" "}
                                  {fmtPct2(row.point.weights[i] ?? 0)}
                                </span>
                              ) : null,
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-200 tabular-nums">
                        {fmtPct(row.point.expected_return)}
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-200 tabular-nums">
                        {fmtPct(row.point.volatility)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-semibold tabular-nums ${
                          row.isOptimal ? "text-amber-400" : "text-zinc-200"
                        }`}
                      >
                        {row.point.sharpe.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
