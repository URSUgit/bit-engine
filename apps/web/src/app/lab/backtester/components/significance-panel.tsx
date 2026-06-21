"use client";

import { useMemo } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

// ── Statistical helpers ────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function std(arr: number[], mu?: number): number {
  if (arr.length < 2) return 0;
  const m = mu ?? mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

function skewness(arr: number[], mu: number, sigma: number): number {
  if (arr.length < 3 || sigma === 0) return 0;
  const n = arr.length;
  const s3 = arr.reduce((s, x) => s + ((x - mu) / sigma) ** 3, 0);
  return (n / ((n - 1) * (n - 2))) * s3;
}

function kurtosis(arr: number[], mu: number, sigma: number): number {
  if (arr.length < 4 || sigma === 0) return 0;
  const n = arr.length;
  const s4 = arr.reduce((s, x) => s + ((x - mu) / sigma) ** 4, 0);
  return (
    ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * s4 -
    (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
  );
}

// t-distribution CDF approximation (from Abramowitz & Stegun)
function tCDF(t: number, df: number): number {
  // Simple normal approximation for large df
  if (df > 30) {
    const z = t;
    return 0.5 * (1 + erf(z / Math.SQRT2));
  }
  // For smaller df, use a beta function approximation
  const x = df / (df + t * t);
  const ib = incompleteBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - ib / 2 : ib / 2;
}

function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t2 = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t2 + a4) * t2 + a3) * t2 + a2) * t2 + a1) * t2 * Math.exp(-x * x);
  return sign * y;
}

function incompleteBeta(x: number, a: number, b: number): number {
  // Simple approximation using continued fractions (Lentz method, 100 iterations)
  if (x < 0 || x > 1) return 0;
  if (x === 0) return 0;
  if (x === 1) return 1;
  const lbeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  // Continued fraction
  let result = 0;
  for (let i = 0; i < 100; i++) {
    result += Math.pow(-1, i) * Math.pow(x, i) * (a + i) / (a + i + 1);
  }
  return Math.min(1, Math.max(0, front * result));
}

function lgamma(x: number): number {
  // Stirling approximation
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const coeffs = [676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
  for (let i = 0; i < 8; i++) a += coeffs[i]! / (x + i + 1);
  const t = x + 8 - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Bootstrap confidence interval
function bootstrapCI(
  arr: number[],
  statFn: (a: number[]) => number,
  reps = 500,
  alpha = 0.05,
): [number, number] {
  if (arr.length < 4) return [0, 0];
  const samples: number[] = [];
  for (let i = 0; i < reps; i++) {
    const sample = Array.from({ length: arr.length }, () => arr[Math.floor(Math.random() * arr.length)]!);
    samples.push(statFn(sample));
  }
  samples.sort((a, b) => a - b);
  const lo = samples[Math.floor((alpha / 2) * reps)] ?? 0;
  const hi = samples[Math.floor((1 - alpha / 2) * reps)] ?? 0;
  return [lo, hi];
}

// Deflated Sharpe Ratio (Bailey & Lopez de Prado, 2014)
function deflatedSharpe(
  sr: number,          // annualized Sharpe
  nObs: number,        // number of observations (trades or bars)
  skew: number,
  kurt: number,
  nStrategiesTried = 1,
): number {
  if (nObs < 4 || sr === 0) return 0;
  // Expected maximum Sharpe for nStrategiesTried independent tests
  // Approximation: E[max SR] ≈ (1 - euler) * Phi^-1(1 - 1/nStrategiesTried) + euler * Phi^-1(1 - 1/(nStrategiesTried * e))
  // For simplicity, use: SR_benchmark = sqrt(2 * log(nStrategiesTried)) * (1 - 0.5772/sqrt(log(nStrategiesTried)))
  const euler = 0.5772156649;
  let srBenchmark = 0;
  if (nStrategiesTried > 1) {
    const gn = Math.sqrt(2 * Math.log(nStrategiesTried)) - (Math.log(Math.log(nStrategiesTried)) + Math.log(4 * Math.PI)) / (2 * Math.sqrt(2 * Math.log(nStrategiesTried)));
    const delta = euler / Math.sqrt(2 * Math.log(nStrategiesTried));
    srBenchmark = gn - delta;
  }

  // Standard error of SR given non-normal returns
  const varSR = (1 - skew * sr + ((kurt - 1) / 4) * sr * sr) / (nObs - 1);
  if (varSR <= 0) return 0;
  const stdSR = Math.sqrt(varSR);

  // Probability that SR > SR_benchmark (one-sided)
  const z = (sr - srBenchmark) / stdSR;
  // Convert z to probability (normal CDF)
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SignificancePanel({ result }: { result: BacktestResult }) {
  const pnls = useMemo(() => result.trades.map((t) => t.pnl_pct), [result.trades]);

  const stats = useMemo(() => {
    if (pnls.length < 5) return null;
    const mu = mean(pnls);
    const sigma = std(pnls, mu);
    const n = pnls.length;

    // t-test: H0: mean = 0
    const tStat = sigma > 0 ? mu / (sigma / Math.sqrt(n)) : 0;
    const pValue = sigma > 0 ? 2 * (1 - tCDF(Math.abs(tStat), n - 1)) : 1;

    // Annualized Sharpe (assuming 252 trading days, scaled from trade-level)
    const daysInBacktest = Math.max(1,
      (new Date(result.end_date).getTime() - new Date(result.start_date).getTime()) / 86400000
    );
    const tradesPerYear = (n / daysInBacktest) * 365;
    const sharpeAnnualized = sigma > 0 ? (mu / sigma) * Math.sqrt(Math.max(tradesPerYear, 1)) : 0;

    const skew = skewness(pnls, mu, sigma);
    const kurt = kurtosis(pnls, mu, sigma);

    // Bootstrap CI for Sharpe
    const [sharpeLo, sharpeHi] = bootstrapCI(
      pnls,
      (arr) => {
        const m = mean(arr);
        const s = std(arr, m);
        return s > 0 ? (m / s) * Math.sqrt(Math.max(tradesPerYear, 1)) : 0;
      },
      300,
    );

    // Bootstrap CI for mean
    const [meanLo, meanHi] = bootstrapCI(pnls, mean, 300);

    // Deflated Sharpe
    const numParamsTried = Object.keys(result.params_used ?? {}).length;
    const nStrategiesTried = Math.max(1, numParamsTried * 3); // rough estimate
    const dsr = deflatedSharpe(sharpeAnnualized, n, skew, kurt, nStrategiesTried);

    return {
      n, mu, sigma, tStat, pValue, sharpeAnnualized, skew, kurt,
      sharpeLo, sharpeHi, meanLo, meanHi, dsr, nStrategiesTried,
    };
  }, [pnls, result]);

  // Equity curve of bootstrapped mean trajectories
  const bootstrapPaths = useMemo(() => {
    if (!pnls.length || pnls.length < 10) return [];
    const paths: number[][] = [];
    for (let r = 0; r < 100; r++) {
      let equity = 100;
      const path = [equity];
      for (let i = 0; i < pnls.length; i++) {
        const p = pnls[Math.floor(Math.random() * pnls.length)]!;
        equity *= 1 + p / 100;
        path.push(equity);
      }
      paths.push(path);
    }
    // Compute percentiles at each step
    const steps = pnls.length + 1;
    return Array.from({ length: steps }, (_, i) => {
      const vals = paths.map((p) => p[i] ?? 100).sort((a, b) => a - b);
      return {
        step: i,
        p5: vals[Math.floor(0.05 * vals.length)] ?? 100,
        p25: vals[Math.floor(0.25 * vals.length)] ?? 100,
        p50: vals[Math.floor(0.5 * vals.length)] ?? 100,
        p75: vals[Math.floor(0.75 * vals.length)] ?? 100,
        p95: vals[Math.floor(0.95 * vals.length)] ?? 100,
      };
    });
  }, [pnls]);

  if (!stats || pnls.length < 5) {
    return (
      <div className="text-center text-zinc-500 py-10">
        Need at least 5 trades for significance testing (have {pnls.length}).
      </div>
    );
  }

  const isSignificant = stats.pValue < 0.05;
  const isHighlySignificant = stats.pValue < 0.01;

  return (
    <div className="space-y-5">
      {/* Alert banner */}
      <div
        className={`border rounded-xl p-4 ${
          isHighlySignificant
            ? "bg-emerald-950/30 border-emerald-700/40"
            : isSignificant
            ? "bg-cyan-950/30 border-cyan-700/40"
            : "bg-yellow-950/20 border-yellow-700/40"
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="text-3xl">
            {isHighlySignificant ? "✓" : isSignificant ? "~" : "⚠"}
          </span>
          <div>
            <p
              className={`font-semibold text-sm ${
                isHighlySignificant
                  ? "text-emerald-300"
                  : isSignificant
                  ? "text-cyan-300"
                  : "text-yellow-300"
              }`}
            >
              {isHighlySignificant
                ? "Highly statistically significant (p < 0.01)"
                : isSignificant
                ? "Statistically significant (p < 0.05)"
                : "Not statistically significant (p ≥ 0.05)"}
            </p>
            <p className="text-xs text-zinc-400 mt-0.5">
              {isSignificant
                ? `Mean trade P&L of ${stats.mu.toFixed(3)}% is unlikely to be zero by chance.`
                : `With only ${stats.n} trades, the mean P&L of ${stats.mu.toFixed(3)}% cannot be distinguished from random noise at the 5% level.`}
            </p>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "t-Statistic",
            value: stats.tStat.toFixed(3),
            sub: `df=${stats.n - 1}`,
            color: Math.abs(stats.tStat) > 1.96 ? "text-emerald-400" : "text-zinc-300",
          },
          {
            label: "p-Value (two-tail)",
            value: stats.pValue < 0.001 ? "<0.001" : stats.pValue.toFixed(4),
            sub: stats.pValue < 0.05 ? "Significant" : "Not significant",
            color: stats.pValue < 0.05 ? "text-emerald-400" : "text-yellow-400",
          },
          {
            label: "Annualized Sharpe",
            value: stats.sharpeAnnualized.toFixed(3),
            sub: `95% CI: [${stats.sharpeLo.toFixed(2)}, ${stats.sharpeHi.toFixed(2)}]`,
            color: stats.sharpeAnnualized > 1 ? "text-emerald-400" : stats.sharpeAnnualized > 0 ? "text-zinc-300" : "text-red-400",
          },
          {
            label: "Deflated Sharpe Prob.",
            value: `${(stats.dsr * 100).toFixed(1)}%`,
            sub: `Tested ~${stats.nStrategiesTried} configs`,
            color: stats.dsr > 0.95 ? "text-emerald-400" : stats.dsr > 0.80 ? "text-yellow-400" : "text-red-400",
          },
        ].map((c) => (
          <div key={c.label} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
            <div className={`text-xl font-bold font-mono ${c.color}`}>{c.value}</div>
            <div className="text-[10px] text-zinc-600 mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Mean P&L confidence interval */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">
          Mean Trade P&L — 95% Bootstrap Confidence Interval
        </h4>
        <div className="flex items-center gap-4 mt-3">
          <div className="flex-1 h-6 bg-zinc-800 rounded-full overflow-hidden relative">
            {/* Zero line */}
            <div className="absolute top-0 bottom-0 w-0.5 bg-zinc-500" style={{ left: "50%" }} />
            {/* CI bar */}
            {(() => {
              const range = Math.max(Math.abs(stats.meanLo), Math.abs(stats.meanHi)) * 2;
              if (range === 0) return null;
              const loFrac = ((stats.meanLo + range / 2) / range) * 100;
              const hiFrac = ((stats.meanHi + range / 2) / range) * 100;
              const isPos = stats.meanLo > 0;
              const isNeg = stats.meanHi < 0;
              return (
                <div
                  className={`absolute top-1 bottom-1 rounded ${
                    isPos ? "bg-emerald-500" : isNeg ? "bg-red-500" : "bg-amber-500"
                  } opacity-60`}
                  style={{ left: `${loFrac}%`, width: `${Math.max(2, hiFrac - loFrac)}%` }}
                />
              );
            })()}
          </div>
          <div className="text-xs font-mono text-zinc-300 whitespace-nowrap">
            [{stats.meanLo.toFixed(3)}%, {stats.meanHi.toFixed(3)}%]
          </div>
        </div>
        <p className="text-[10px] text-zinc-600 mt-2">
          {stats.meanLo > 0
            ? "CI is entirely positive — strategy has a statistically robust edge."
            : stats.meanHi < 0
            ? "CI is entirely negative — strategy is likely unprofitable."
            : "CI crosses zero — edge is not statistically confirmed at the 95% level."}
          {" "}Computed via 300-iteration bootstrap resampling of {stats.n} trades.
        </p>
      </div>

      {/* Bootstrap equity fan */}
      {bootstrapPaths.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-1">
            Bootstrap Equity Fan (100 resamples, starting $100)
          </h4>
          <p className="text-[10px] text-zinc-600 mb-3">
            Each resampled path draws trades randomly with replacement from your actual trade set.
            Fan shows 5th–95th percentile range. Wide fan = high outcome uncertainty.
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={bootstrapPaths} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="step" tick={false} />
              <YAxis
                tick={{ fill: "#71717a", fontSize: 10 }}
                tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
              />
              <ReferenceLine y={100} stroke="#52525b" strokeDasharray="3 2" />
              <Line type="monotone" dataKey="p95" stroke="#22c55e" strokeWidth={1} dot={false} strokeOpacity={0.4} isAnimationActive={false} />
              <Line type="monotone" dataKey="p75" stroke="#22c55e" strokeWidth={1.5} dot={false} strokeOpacity={0.6} isAnimationActive={false} />
              <Line type="monotone" dataKey="p50" stroke="#06b6d4" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="p25" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeOpacity={0.6} isAnimationActive={false} />
              <Line type="monotone" dataKey="p5" stroke="#ef4444" strokeWidth={1} dot={false} strokeOpacity={0.4} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-4 text-[10px] text-zinc-600 mt-1 flex-wrap">
            <span><span className="text-cyan-400">─</span> Median (p50)</span>
            <span><span className="text-emerald-400">─</span> p75/p95</span>
            <span><span className="text-red-400">─</span> p25/p5</span>
          </div>
        </div>
      )}

      {/* Interpretation guide */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 text-xs text-zinc-400 space-y-2">
        <h4 className="text-zinc-300 font-semibold text-sm">How to Interpret</h4>
        <ul className="space-y-1.5">
          <li><strong className="text-zinc-300">t-test:</strong> Tests if mean trade return ≠ 0. Critical value: |t| &gt; 1.96 for p&lt;0.05, &gt;2.58 for p&lt;0.01.</li>
          <li><strong className="text-zinc-300">Deflated Sharpe:</strong> Adjusts Sharpe ratio for the number of parameter combinations tested. DSR &gt; 95% = edge survives the multiple-testing correction.</li>
          <li><strong className="text-zinc-300">Bootstrap fan:</strong> If the p50 line trends upward and the p5 is near or above $100, the strategy has a robust positive expectancy across resamples.</li>
          <li><strong className="text-zinc-300">CI crossing zero:</strong> Even if the mean return is positive, if the 95% CI crosses zero you cannot reject the null hypothesis of "this strategy is luck."</li>
        </ul>
        <p className="text-zinc-500 text-[10px] mt-1">
          Statistical significance does NOT guarantee future performance. It only indicates whether the past result is distinguishable from random chance.
        </p>
      </div>
    </div>
  );
}
