"use client";

import { useMemo } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  Line,
  ComposedChart,
} from "recharts";

// ── Math helpers ──────────────────────────────────────────────────────────────

function sampleMean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sampleVariance(arr: number[], mu: number): number {
  return arr.reduce((s, x) => s + (x - mu) ** 2, 0) / arr.length;
}

function acf(values: number[], mu: number, variance: number, lag: number): number {
  if (variance === 0) return 0;
  const n = values.length;
  let cov = 0;
  for (let i = 0; i < n - lag; i++) {
    cov += (values[i] - mu) * (values[i + lag] - mu);
  }
  return cov / (n * variance);
}

function ljungBox(
  values: number[],
  acfValues: number[],
  maxLag: number,
): { Q: number; isSignificant: boolean } {
  const n = values.length;
  let Q = 0;
  for (let k = 1; k <= maxLag; k++) {
    const rk = acfValues[k - 1];
    Q += (rk * rk) / (n - k);
  }
  Q *= n * (n + 2);
  // Chi-squared critical value at df=maxLag, alpha=0.05 approximation
  // chi2_crit ≈ maxLag + 1.645 * sqrt(2 * maxLag)  (Wilson-Hilferty)
  const chiCrit = maxLag + 1.645 * Math.sqrt(2 * maxLag);
  return { Q, isSignificant: Q > chiCrit };
}

function computeRunsTest(wins: boolean[]): {
  runs: number;
  expected: number;
  z: number;
  isSignificant: boolean;
} {
  const n = wins.length;
  const n1 = wins.filter(Boolean).length;
  const n2 = n - n1;
  if (n1 === 0 || n2 === 0) return { runs: 0, expected: 0, z: 0, isSignificant: false };

  let runs = 1;
  for (let i = 1; i < n; i++) {
    if (wins[i] !== wins[i - 1]) runs++;
  }

  const expected = (2 * n1 * n2) / n + 1;
  const variance = (2 * n1 * n2 * (2 * n1 * n2 - n)) / (n * n * (n - 1));
  const z = variance > 0 ? (runs - expected) / Math.sqrt(variance) : 0;
  return { runs, expected, z, isSignificant: Math.abs(z) > 1.96 };
}

// ── Component ─────────────────────────────────────────────────────────────────

const MAX_LAG = 20;

export function TradeAutocorrelation({ result }: { result: BacktestResult }) {
  const pnls = useMemo(() => result.trades.map((t) => t.pnl_pct), [result.trades]);

  const { mu, variance, acfValues, ci95, lb, runsTest } = useMemo(() => {
    if (pnls.length < 10) {
      return { mu: 0, variance: 0, acfValues: [], ci95: 0, lb: null, runsTest: null };
    }
    const mu = sampleMean(pnls);
    const variance = sampleVariance(pnls, mu);
    const maxLag = Math.min(MAX_LAG, Math.floor(pnls.length / 3));
    const acfValues = Array.from({ length: maxLag }, (_, i) =>
      acf(pnls, mu, variance, i + 1),
    );
    const ci95 = 1.96 / Math.sqrt(pnls.length);
    const lb = ljungBox(pnls, acfValues, Math.min(10, maxLag));
    const wins = pnls.map((p) => p > 0);
    const runsTest = computeRunsTest(wins);
    return { mu, variance, acfValues, ci95, lb, runsTest };
  }, [pnls]);

  // Lag-1 scatter: pnl[n] vs pnl[n-1]
  const lagScatter = useMemo(
    () =>
      pnls.slice(1).map((y, i) => ({ x: pnls[i], y })),
    [pnls],
  );

  // Compute linear regression line for scatter
  const regressionLine = useMemo(() => {
    if (lagScatter.length < 4) return null;
    const xs = lagScatter.map((p) => p.x);
    const ys = lagScatter.map((p) => p.y);
    const mx = sampleMean(xs);
    const my = sampleMean(ys);
    const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    if (den === 0) return null;
    const slope = num / den;
    const intercept = my - slope * mx;
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    return [
      { x: xMin, y: slope * xMin + intercept },
      { x: xMax, y: slope * xMax + intercept },
    ];
  }, [lagScatter]);

  const acfChartData = acfValues.map((r, i) => ({ lag: i + 1, r }));

  if (pnls.length < 10) {
    return (
      <div className="text-center text-zinc-500 py-10">
        Need at least 10 trades for autocorrelation analysis (have {pnls.length}).
      </div>
    );
  }

  const lag1 = acfValues[0] ?? 0;
  const serialCorrelationInterpretation =
    lag1 > ci95
      ? "momentum (wins follow wins)"
      : lag1 < -ci95
      ? "mean-reversion (wins follow losses)"
      : "no significant serial correlation";

  return (
    <div className="space-y-5">
      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
          <div className="text-xs text-zinc-500 mb-1">Lag-1 ACF</div>
          <div
            className={`text-xl font-bold font-mono ${
              Math.abs(lag1) > ci95 ? "text-yellow-400" : "text-zinc-200"
            }`}
          >
            {lag1.toFixed(3)}
          </div>
          <div className="text-[10px] text-zinc-600 mt-0.5">
            95% CI: ±{ci95.toFixed(3)}
          </div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
          <div className="text-xs text-zinc-500 mb-1">Ljung-Box Q (lag 10)</div>
          <div
            className={`text-xl font-bold font-mono ${
              lb?.isSignificant ? "text-red-400" : "text-emerald-400"
            }`}
          >
            {lb?.Q.toFixed(2) ?? "—"}
          </div>
          <div className="text-[10px] text-zinc-600 mt-0.5">
            {lb?.isSignificant ? "Significant (p<0.05)" : "Not significant"}
          </div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
          <div className="text-xs text-zinc-500 mb-1">Runs Test Z</div>
          <div
            className={`text-xl font-bold font-mono ${
              runsTest?.isSignificant ? "text-yellow-400" : "text-zinc-200"
            }`}
          >
            {runsTest?.z.toFixed(3) ?? "—"}
          </div>
          <div className="text-[10px] text-zinc-600 mt-0.5">
            {runsTest?.isSignificant ? "Non-random (|z|>1.96)" : "Random sequence"}
          </div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
          <div className="text-xs text-zinc-500 mb-1">Interpretation</div>
          <div className="text-sm font-semibold text-zinc-300 capitalize">
            {serialCorrelationInterpretation}
          </div>
        </div>
      </div>

      {/* ACF Correlogram */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">
          Autocorrelation Function (ACF)
        </h4>
        <p className="text-[10px] text-zinc-600 mb-3">
          Bars outside the shaded band (±1.96/√n) indicate statistically significant
          autocorrelation at that lag. Positive = momentum, Negative = mean-reversion.
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={acfChartData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="lag" tick={{ fill: "#71717a", fontSize: 10 }} label={{ value: "Lag", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }} />
            <YAxis
              domain={[-1, 1]}
              tick={{ fill: "#71717a", fontSize: 10 }}
              tickFormatter={(v) => `${Number(v).toFixed(1)}`}
            />
            <ReferenceLine y={0} stroke="#3f3f46" />
            <ReferenceLine y={ci95} stroke="#f59e0b" strokeDasharray="4 2" opacity={0.7} />
            <ReferenceLine y={-ci95} stroke="#f59e0b" strokeDasharray="4 2" opacity={0.7} />
            <Bar dataKey="r" maxBarSize={28}>
              {acfChartData.map((d, i) => (
                <Cell
                  key={i}
                  fill={
                    Math.abs(d.r) > ci95
                      ? d.r > 0
                        ? "#22c55e"
                        : "#ef4444"
                      : "#71717a"
                  }
                  fillOpacity={0.8}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Lag-1 Scatter */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-1">
            Lag-1 Scatter: P&L(n) vs P&L(n-1)
          </h4>
          <p className="text-[10px] text-zinc-600 mb-3">
            Upward slope = momentum. Downward slope = mean-reversion.
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis
                type="number"
                dataKey="x"
                name="P&L(n-1)"
                tick={{ fill: "#71717a", fontSize: 10 }}
                label={{ value: "P&L(n-1) %", position: "insideBottomRight", fill: "#52525b", fontSize: 10 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="P&L(n)"
                tick={{ fill: "#71717a", fontSize: 10 }}
                label={{ value: "P&L(n) %", angle: -90, position: "insideLeft", fill: "#52525b", fontSize: 10 }}
              />
              <ReferenceLine x={0} stroke="#3f3f46" />
              <ReferenceLine y={0} stroke="#3f3f46" />
              <Scatter
                data={lagScatter}
                fill="#06b6d4"
                fillOpacity={0.5}
                shape={(props) => {
                  const p = props as unknown as { cx: number; cy: number; payload: { x: number; y: number } };
                  return <circle cx={p.cx} cy={p.cy} r={3} fill={p.payload.y > 0 ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)"} />;
                }}
              />
              {regressionLine && (
                <Line
                  data={regressionLine}
                  type="linear"
                  dataKey="y"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Win/Loss streak autocorrelation */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-zinc-300">Serial Independence Tests</h4>

          <div className="space-y-2">
            {/* Runs test */}
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-zinc-300">Wald-Wolfowitz Runs Test</span>
                <span
                  className={`text-xs font-bold ${
                    runsTest?.isSignificant ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {runsTest?.isSignificant ? "NOT random" : "Random"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-zinc-500">Observed runs: </span>
                  <span className="text-zinc-200 font-mono">{runsTest?.runs ?? "—"}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Expected runs: </span>
                  <span className="text-zinc-200 font-mono">
                    {runsTest?.expected.toFixed(1) ?? "—"}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500">Z-score: </span>
                  <span
                    className={`font-mono font-bold ${
                      Math.abs(runsTest?.z ?? 0) > 1.96 ? "text-yellow-400" : "text-zinc-200"
                    }`}
                  >
                    {runsTest?.z.toFixed(3) ?? "—"}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500">Trades: </span>
                  <span className="text-zinc-200 font-mono">{pnls.length}</span>
                </div>
              </div>
              <p className="text-[10px] text-zinc-600 mt-2">
                Tests if win/loss sequence is random. Fewer runs than expected = clustering (hot hands). More runs = alternating pattern.
              </p>
            </div>

            {/* Ljung-Box */}
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-zinc-300">Ljung-Box Test (lag 10)</span>
                <span
                  className={`text-xs font-bold ${
                    lb?.isSignificant ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {lb?.isSignificant ? "Significant" : "Not significant"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-zinc-500">Q statistic: </span>
                  <span className="text-zinc-200 font-mono">{lb?.Q.toFixed(3) ?? "—"}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Degrees of freedom: </span>
                  <span className="text-zinc-200 font-mono">10</span>
                </div>
              </div>
              <p className="text-[10px] text-zinc-600 mt-2">
                Jointly tests all lags 1–10. Significant result suggests P&L values are not independent — a sign of strategy regime dependence or overfitting.
              </p>
            </div>

            {/* Interpretation */}
            <div
              className={`border rounded-lg p-3 ${
                lb?.isSignificant || runsTest?.isSignificant
                  ? "bg-yellow-950/20 border-yellow-800/40"
                  : "bg-emerald-950/20 border-emerald-800/40"
              }`}
            >
              <p
                className={`text-xs font-semibold ${
                  lb?.isSignificant || runsTest?.isSignificant
                    ? "text-yellow-300"
                    : "text-emerald-300"
                }`}
              >
                {lb?.isSignificant || runsTest?.isSignificant
                  ? "Warning: Non-independent P&L sequence detected"
                  : "Trade P&L appears statistically independent"}
              </p>
              <p className="text-[10px] text-zinc-400 mt-1">
                {lb?.isSignificant || runsTest?.isSignificant
                  ? "Consider position sizing that adapts to recent performance, or investigate if results are regime-dependent."
                  : "Each trade's outcome appears independent of prior results, which is consistent with a robust, non-data-mined strategy."}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
