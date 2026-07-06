"use client";

import { useMemo } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, BarChart, Bar, Cell,
} from "recharts";
import type { BacktestResult } from "@/lib/backtest-api";

// ── Math helpers ──────────────────────────────────────────────────────────────

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function variance(xs: number[]) {
  const m = mean(xs);
  return mean(xs.map((x) => (x - m) ** 2));
}

function std(xs: number[]) {
  return Math.sqrt(variance(xs));
}

function cov(xs: number[], ys: number[]) {
  const mx = mean(xs), my = mean(ys);
  return mean(xs.map((x, i) => (x - mx) * (ys[i]! - my)));
}

function correlation(xs: number[], ys: number[]) {
  const sx = std(xs), sy = std(ys);
  return sx === 0 || sy === 0 ? 0 : cov(xs, ys) / (sx * sy);
}

function linReg(xs: number[], ys: number[]) {
  const sx = std(xs);
  if (sx === 0) return { beta: 0, alpha: 0, r2: 0 };
  const beta = cov(xs, ys) / (sx * sx);
  const alpha = mean(ys) - beta * mean(xs);
  const yHat = xs.map((x) => alpha + beta * x);
  const ssRes = ys.reduce((a, y, i) => a + (y - yHat[i]!) ** 2, 0);
  const ssTot = ys.reduce((a, y) => a + (y - mean(ys)) ** 2, 0);
  return { beta, alpha, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot };
}

function buildDailyReturns(equity: { t: number; equity: number }[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1]!.equity;
    if (prev > 0) returns.push(((equity[i]!.equity - prev) / prev) * 100);
  }
  return returns;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, color = "text-zinc-200",
}: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
      <div className="text-xs text-zinc-400 mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}

interface ScatterDatum {
  x: number;
  y: number;
}

function ReturnScatterPlot({
  xs, ys, beta, alpha, xlabel, ylabel,
}: { xs: number[]; ys: number[]; beta: number; alpha: number; xlabel: string; ylabel: string }) {
  const data: ScatterDatum[] = xs.map((x, i) => ({ x, y: ys[i]! }));
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const regLine: ScatterDatum[] = [
    { x: xMin, y: alpha + beta * xMin },
    { x: xMax, y: alpha + beta * xMax },
  ];

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart margin={{ top: 8, right: 8, bottom: 24, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis
          type="number" dataKey="x" name={xlabel}
          stroke="#52525b" tick={{ fill: "#71717a", fontSize: 10 }}
          label={{ value: xlabel, position: "insideBottom", offset: -12, fill: "#71717a", fontSize: 11 }}
        />
        <YAxis type="number" dataKey="y" name={ylabel}
          stroke="#52525b" tick={{ fill: "#71717a", fontSize: 10 }} />
        <Tooltip
          content={({ payload }) => {
            if (!payload?.length) return null;
            const d = payload[0]?.payload as ScatterDatum;
            return (
              <div className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs">
                <div>{xlabel}: {d.x.toFixed(2)}%</div>
                <div>{ylabel}: {d.y.toFixed(2)}%</div>
              </div>
            );
          }}
        />
        <ReferenceLine x={0} stroke="#52525b" />
        <ReferenceLine y={0} stroke="#52525b" />
        <Scatter data={data} fill="#06b6d4" opacity={0.55} r={3} isAnimationActive={false} />
        <Scatter data={regLine} line={{ stroke: "#f59e0b", strokeWidth: 1.5 }} fill="none" isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

interface BetaDatum { i: number; beta: number }

function RollingBetaChart({ stratReturns, benchReturns }: { stratReturns: number[]; benchReturns: number[] }) {
  const WIN = 20;
  const minLen = Math.min(stratReturns.length, benchReturns.length);
  const data: BetaDatum[] = [];
  for (let i = WIN; i <= minLen; i++) {
    const xs = benchReturns.slice(i - WIN, i);
    const ys = stratReturns.slice(i - WIN, i);
    const { beta } = linReg(xs, ys);
    data.push({ i, beta });
  }

  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis dataKey="i" hide />
        <YAxis stroke="#52525b" tick={{ fill: "#71717a", fontSize: 10 }} width={36} />
        <Tooltip
          content={({ payload }) => {
            if (!payload?.length) return null;
            const d = payload[0]?.payload as BetaDatum;
            return (
              <div className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs">
                Bar {d.i}: β = {d.beta.toFixed(2)}
              </div>
            );
          }}
        />
        <ReferenceLine y={0} stroke="#52525b" />
        <ReferenceLine y={1} stroke="#71717a" strokeDasharray="4 2" />
        <Bar dataKey="beta" isAnimationActive={false} radius={[2, 2, 0, 0]}>
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={entry.beta > 1.2 ? "#f59e0b" : entry.beta > 0 ? "#06b6d4" : "#ef4444"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function FactorExposure({ result }: { result: BacktestResult }) {
  const bh = result.benchmark;

  const { stratReturns, benchReturns } = useMemo(() => {
    const strat = buildDailyReturns(result.equity_curve);
    const bench = bh ? buildDailyReturns(bh.equity_curve) : [];
    const len = Math.min(strat.length, bench.length);
    return { stratReturns: strat.slice(-len), benchReturns: bench.slice(-len) };
  }, [result.equity_curve, bh]);

  const hasBench = benchReturns.length > 10;

  const { beta, alpha, r2, corr } = useMemo(() => {
    if (!hasBench) return { beta: 0, alpha: 0, r2: 0, corr: 0 };
    const reg = linReg(benchReturns, stratReturns);
    return { ...reg, corr: correlation(benchReturns, stratReturns) };
  }, [hasBench, benchReturns, stratReturns]);

  const annualAlpha = alpha * 252;

  const retStats = useMemo(() => {
    if (!stratReturns.length) return null;
    const sorted = [...stratReturns].sort((a, b) => a - b);
    const n = sorted.length;
    const m = mean(stratReturns), s = std(stratReturns);
    const positives = stratReturns.filter((r) => r > 0);
    const negatives = stratReturns.filter((r) => r < 0);
    return {
      mean: m,
      std: s,
      var95: sorted[Math.floor(n * 0.05)] ?? 0,
      var99: sorted[Math.floor(n * 0.01)] ?? 0,
      cvar95: mean(sorted.slice(0, Math.max(1, Math.floor(n * 0.05)))),
      skew:
        s === 0 ? 0 : mean(stratReturns.map((r) => ((r - m) / s) ** 3)),
      kurtosis:
        s === 0 ? 0 : mean(stratReturns.map((r) => ((r - m) / s) ** 4)) - 3,
      posRate: n > 0 ? (positives.length / n) * 100 : 0,
      avgWin: positives.length ? mean(positives) : 0,
      avgLoss: negatives.length ? mean(negatives) : 0,
    };
  }, [stratReturns]);

  if (!retStats) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
        Not enough equity data for factor analysis.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {hasBench ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Market Beta (β)"
              value={beta.toFixed(3)}
              sub={Math.abs(beta) > 1.2 ? "Market-amplifying" : Math.abs(beta) > 0.5 ? "Moderate exposure" : "Low market correlation"}
              color={Math.abs(beta) > 1.5 ? "text-yellow-400" : "text-cyan-300"}
            />
            <StatCard
              label="Annualized Alpha (α)"
              value={`${annualAlpha >= 0 ? "+" : ""}${annualAlpha.toFixed(1)}%`}
              sub="vs buy-and-hold"
              color={annualAlpha > 0 ? "text-emerald-300" : "text-red-400"}
            />
            <StatCard
              label="Correlation (ρ)"
              value={corr.toFixed(3)}
              sub={Math.abs(corr) > 0.7 ? "High" : Math.abs(corr) > 0.4 ? "Moderate" : "Low"}
              color={Math.abs(corr) < 0.3 ? "text-emerald-300" : Math.abs(corr) < 0.6 ? "text-yellow-400" : "text-red-400"}
            />
            <StatCard
              label="R² (Explained)"
              value={`${(r2 * 100).toFixed(1)}%`}
              sub="variance from market"
              color={r2 < 0.2 ? "text-emerald-300" : r2 < 0.5 ? "text-yellow-400" : "text-red-400"}
            />
          </div>

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-1 text-zinc-300">Strategy Returns vs Benchmark</h3>
            <p className="text-xs text-zinc-500 mb-3">Each dot = one period. Amber line = OLS regression.</p>
            <ReturnScatterPlot
              xs={benchReturns} ys={stratReturns}
              beta={beta} alpha={alpha}
              xlabel="Benchmark Return %" ylabel="Strategy Return %"
            />
          </div>

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-1 text-zinc-300">Rolling Beta (20-period)</h3>
            <p className="text-xs text-zinc-500 mb-3">
              Amber = β &gt; 1.2 (market-amplifying) · Cyan = normal · Red = inverse
            </p>
            <RollingBetaChart stratReturns={stratReturns} benchReturns={benchReturns} />
          </div>
        </>
      ) : (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded p-4 text-sm text-zinc-500 text-center">
          Benchmark data not available — run a backtest to see market factor exposure.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Mean Period Return"
          value={`${retStats.mean >= 0 ? "+" : ""}${retStats.mean.toFixed(3)}%`}
          color={retStats.mean >= 0 ? "text-emerald-300" : "text-red-400"}
        />
        <StatCard
          label="Period Volatility"
          value={`${retStats.std.toFixed(3)}%`}
          sub={`Ann. ~${(retStats.std * Math.sqrt(252)).toFixed(1)}%`}
        />
        <StatCard
          label="Skewness"
          value={retStats.skew.toFixed(3)}
          sub={retStats.skew > 0.2 ? "Right-skewed (good)" : retStats.skew < -0.2 ? "Left tail risk" : "Symmetric"}
          color={retStats.skew > 0.2 ? "text-emerald-300" : retStats.skew < -0.2 ? "text-red-400" : "text-zinc-300"}
        />
        <StatCard
          label="Excess Kurtosis"
          value={retStats.kurtosis.toFixed(3)}
          sub={Math.abs(retStats.kurtosis) > 3 ? "Fat tails" : "Near-normal tails"}
          color={Math.abs(retStats.kurtosis) > 3 ? "text-yellow-400" : "text-zinc-300"}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="VaR 95%" value={`${retStats.var95.toFixed(3)}%`}
          sub="95th percentile loss" color="text-yellow-400" />
        <StatCard label="VaR 99%" value={`${retStats.var99.toFixed(3)}%`}
          sub="99th percentile loss" color="text-red-400" />
        <StatCard label="CVaR 95%" value={`${retStats.cvar95.toFixed(3)}%`}
          sub="Expected shortfall" color="text-red-400" />
        <StatCard
          label="Avg Win / Loss Periods"
          value={`${retStats.avgWin.toFixed(2)}% / ${retStats.avgLoss.toFixed(2)}%`}
          sub={`${retStats.posRate.toFixed(0)}% positive periods`}
          color="text-cyan-300"
        />
      </div>
    </div>
  );
}
