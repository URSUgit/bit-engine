"use client";

import { useState } from "react";
import { backtestApi, type StrategyInfo, type BacktestResult } from "@/lib/backtest-api";
import { isoDaysAgo } from "./shared";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

type PerturbResult = {
  label: string;
  params: Record<string, number>;
  sharpe: number | null;
  returnPct: number | null;
  maxDD: number | null;
  trades: number | null;
  error: string | null;
  status: "idle" | "running" | "done" | "error";
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function perturbParams(
  params: Record<string, number>,
  schema: StrategyInfo["params_schema"],
  factor: number,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, spec] of Object.entries(schema)) {
    if (spec.type === "bool") { result[key] = params[key] ?? 0; continue; }
    const cur   = params[key] ?? (typeof spec.default === "boolean" ? (spec.default ? 1 : 0) : spec.default);
    const perturbed = cur * factor;
    const clamped   = Math.max(
      spec.min ?? -Infinity,
      Math.min(spec.max ?? Infinity, spec.type === "int" ? Math.round(perturbed) : perturbed),
    );
    result[key] = +clamped.toFixed(6);
  }
  return result;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface RobustnessTestProps {
  strategy: StrategyInfo | undefined;
  symbol: string;
  params: Record<string, number>;
  periodDays: number;
  interval: string;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  positionPct: number;
  baseResult: BacktestResult | null;
}

const PERTURB_FACTORS = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3];
const FACTOR_LABELS   = ["-30%", "-20%", "-10%", "Base", "+10%", "+20%", "+30%"];

export function RobustnessTest({
  strategy, symbol, params, periodDays, interval,
  initialCapital, commissionPct, slippagePct, positionPct, baseResult,
}: RobustnessTestProps) {
  const [results, setResults]   = useState<PerturbResult[]>([]);
  const [running, setRunning]   = useState(false);
  const [metric, setMetric]     = useState<"sharpe" | "returnPct" | "maxDD">("sharpe");

  if (!strategy) return null;

  async function runTest() {
    setRunning(true);
    const startDate = isoDaysAgo(periodDays);

    const initial: PerturbResult[] = PERTURB_FACTORS.map((f, i) => ({
      label: FACTOR_LABELS[i],
      params: perturbParams(params, strategy!.params_schema, f),
      sharpe: null, returnPct: null, maxDD: null, trades: null,
      error: null, status: f === 1.0 ? "done" : "running",
    }));

    // Pre-fill base
    if (baseResult && initial[3]) {
      initial[3] = { ...initial[3], sharpe: baseResult.metrics.sharpe_ratio, returnPct: baseResult.metrics.total_return_pct, maxDD: baseResult.metrics.max_drawdown_pct, trades: baseResult.metrics.total_trades, status: "done" };
    }
    setResults(initial);

    await Promise.all(
      PERTURB_FACTORS.map(async (factor, i) => {
        if (factor === 1.0) return; // already have base
        try {
          const res = await backtestApi.run({
            symbol,
            strategy: strategy!.name,
            start_date: startDate,
            interval,
            initial_capital: initialCapital,
            commission_pct: commissionPct,
            slippage_pct: slippagePct,
            position_size_pct: positionPct,
            strategy_params: perturbParams(params, strategy!.params_schema, factor),
          });
          setResults((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], sharpe: res.metrics.sharpe_ratio, returnPct: res.metrics.total_return_pct, maxDD: res.metrics.max_drawdown_pct, trades: res.metrics.total_trades, status: "done" };
            return next;
          });
        } catch (e) {
          setResults((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], error: String(e), status: "error" };
            return next;
          });
        }
      })
    );
    setRunning(false);
  }

  const baseVal = results[3] ? (metric === "sharpe" ? results[3].sharpe : metric === "returnPct" ? results[3].returnPct : results[3].maxDD) : null;

  const chartData = results.map((r) => {
    const val = metric === "sharpe" ? r.sharpe : metric === "returnPct" ? r.returnPct : r.maxDD;
    return {
      label: r.label,
      value: val,
      fill: r.label === "Base"
        ? "#06b6d4"
        : val !== null && baseVal !== null
        ? (metric === "maxDD"
          ? (val <= baseVal * 1.2 ? "#4ade80" : "#f87171")
          : (val >= baseVal * 0.8 ? "#4ade80" : "#f87171"))
        : "#71717a",
    };
  });

  // Robustness score: how stable is the metric across perturbations?
  const doneValues = results.filter((r) => r.status === "done" && r.sharpe !== null).map((r) => r.sharpe!);
  let robustnessScore: number | null = null;
  if (doneValues.length >= 4) {
    const mean = doneValues.reduce((s, v) => s + v, 0) / doneValues.length;
    const std  = Math.sqrt(doneValues.reduce((s, v) => s + (v - mean) ** 2, 0) / doneValues.length);
    const cv   = mean > 0 ? std / mean : 1;
    robustnessScore = Math.max(0, Math.min(100, Math.round((1 - cv) * 100)));
  }

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-semibold text-zinc-100">Robustness Test</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Perturb all params ±30% simultaneously — measures overfit risk
          </p>
        </div>
        <div className="flex items-center gap-2">
          {robustnessScore !== null && (
            <div className={`text-center px-3 py-1 rounded-lg border ${
              robustnessScore >= 70 ? "border-emerald-800 bg-emerald-950/40 text-emerald-300" :
              robustnessScore >= 40 ? "border-yellow-800 bg-yellow-950/40 text-yellow-300" :
              "border-red-800 bg-red-950/40 text-red-300"
            }`}>
              <div className="text-lg font-black">{robustnessScore}</div>
              <div className="text-[9px] uppercase tracking-wide opacity-70">Robust</div>
            </div>
          )}
          <button
            onClick={runTest}
            disabled={running}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
              running ? "bg-zinc-700 text-zinc-500 cursor-not-allowed" : "bg-cyan-600 hover:bg-cyan-500 text-white"
            }`}
          >
            {running ? "Testing…" : results.length > 0 ? "Re-test" : "Run Test"}
          </button>
        </div>
      </div>

      {results.length > 0 && (
        <>
          {/* Metric selector */}
          <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded p-1 w-fit">
            {([["sharpe", "Sharpe"], ["returnPct", "Return %"], ["maxDD", "Max DD"]] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setMetric(k)}
                className={`px-3 py-1 rounded text-xs font-medium transition ${
                  metric === k ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Bar chart */}
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barSize={28}>
                <XAxis dataKey="label" tick={{ fill: "#a1a1aa", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} />
                {baseVal !== null && <ReferenceLine y={baseVal} stroke="#06b6d4" strokeDasharray="3 3" strokeWidth={1.5} />}
                <Tooltip
                  contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", fontSize: 11 }}
                  formatter={(v: unknown) => [typeof v === "number" ? v.toFixed(3) : "—", metric]}
                />
                <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <rect key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-[10px] uppercase tracking-wide">
                  <th className="px-2 py-1.5 text-left">Perturbation</th>
                  <th className="px-2 py-1.5 text-right">Sharpe</th>
                  <th className="px-2 py-1.5 text-right">Return</th>
                  <th className="px-2 py-1.5 text-right">Max DD</th>
                  <th className="px-2 py-1.5 text-right">Trades</th>
                  <th className="px-2 py-1.5 text-right">vs Base</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const isBase = r.label === "Base";
                  const sharpeVsBase = baseVal !== null && r.sharpe !== null && !isBase
                    ? r.sharpe - (results[3]?.sharpe ?? 0)
                    : null;
                  return (
                    <tr key={r.label} className={`border-b border-zinc-800/40 ${isBase ? "bg-cyan-950/20" : ""}`}>
                      <td className={`px-2 py-1.5 font-medium ${isBase ? "text-cyan-400" : "text-zinc-400"}`}>
                        {r.label}
                        {isBase && <span className="ml-1 text-[10px] text-zinc-600">(base)</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right text-zinc-300">
                        {r.status === "running" ? <span className="text-zinc-600">…</span> : r.sharpe?.toFixed(2) ?? <span className="text-red-400 text-[10px]">err</span>}
                      </td>
                      <td className={`px-2 py-1.5 text-right ${r.returnPct !== null ? (r.returnPct >= 0 ? "text-emerald-400" : "text-red-400") : "text-zinc-600"}`}>
                        {r.returnPct !== null ? `${r.returnPct >= 0 ? "+" : ""}${r.returnPct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right text-zinc-400">
                        {r.maxDD !== null ? `-${r.maxDD.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right text-zinc-500">
                        {r.trades ?? "—"}
                      </td>
                      <td className={`px-2 py-1.5 text-right text-[11px] ${
                        sharpeVsBase === null ? "text-zinc-600" :
                        sharpeVsBase >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}>
                        {sharpeVsBase !== null ? `${sharpeVsBase >= 0 ? "+" : ""}${sharpeVsBase.toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {robustnessScore !== null && (
            <div className={`text-xs px-3 py-2 rounded border ${
              robustnessScore >= 70 ? "border-emerald-900 bg-emerald-950/20 text-emerald-400" :
              robustnessScore >= 40 ? "border-yellow-900 bg-yellow-950/20 text-yellow-400" :
              "border-red-900 bg-red-950/20 text-red-400"
            }`}>
              {robustnessScore >= 70
                ? `✓ Robust (${robustnessScore}/100) — performance is stable across parameter variations. Lower overfit risk.`
                : robustnessScore >= 40
                ? `⚠ Moderate (${robustnessScore}/100) — some sensitivity to parameter changes. Walk-forward testing recommended.`
                : `✗ Fragile (${robustnessScore}/100) — large performance swings under small perturbations. Likely overfit.`}
            </div>
          )}
        </>
      )}
    </div>
  );
}
