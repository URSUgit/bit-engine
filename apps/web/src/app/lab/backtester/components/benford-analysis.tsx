"use client";

import { useMemo, useState } from "react";
import type { BacktestResult } from "@/lib/backtest-api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, Legend, Line, ComposedChart, Cell,
} from "recharts";

type DigitMode = "first" | "second";
type FieldKey = "pnl_pct" | "pnl_abs" | "entry_price" | "exit_price" | "size";

const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "pnl_pct", label: "Trade PnL %" },
  { key: "pnl_abs", label: "Trade PnL $" },
  { key: "entry_price", label: "Entry Price" },
  { key: "exit_price", label: "Exit Price" },
  { key: "size", label: "Position Size" },
];

// Benford expected probability for first digit d (1..9)
function benfordFirst(d: number): number {
  return Math.log10(1 + 1 / d);
}

// Benford expected probability for second digit d (0..9)
function benfordSecond(d: number): number {
  let p = 0;
  for (let d1 = 1; d1 <= 9; d1++) {
    p += Math.log10(1 + 1 / (10 * d1 + d));
  }
  return p;
}

// Leading significant digit (1..9) of |x|, or null if x is 0/invalid
function firstDigit(x: number): number | null {
  let v = Math.abs(x);
  if (!isFinite(v) || v === 0) return null;
  while (v < 1) v *= 10;
  while (v >= 10) v /= 10;
  return Math.floor(v);
}

// Second significant digit (0..9) of |x|, or null
function secondDigit(x: number): number | null {
  let v = Math.abs(x);
  if (!isFinite(v) || v === 0) return null;
  while (v < 1) v *= 10;
  while (v >= 10) v /= 10;
  // v in [1,10); strip first digit
  const frac = (v - Math.floor(v)) * 10;
  return Math.floor(frac);
}

function extractValues(trades: BacktestResult["trades"], field: FieldKey): number[] {
  return trades.map((t) => {
    switch (field) {
      case "pnl_pct": return t.pnl_pct;
      case "pnl_abs": return t.pnl;
      case "entry_price": return t.entry_price;
      case "exit_price": return t.exit_price;
      case "size": return t.size;
    }
  });
}

// Nigrini MAD conformance thresholds
function firstDigitVerdict(mad: number): { label: string; color: string } {
  if (mad < 0.006) return { label: "Close conformance", color: "text-emerald-400" };
  if (mad < 0.012) return { label: "Acceptable conformance", color: "text-lime-400" };
  if (mad < 0.015) return { label: "Marginally acceptable", color: "text-amber-400" };
  return { label: "Nonconformance", color: "text-red-400" };
}
function secondDigitVerdict(mad: number): { label: string; color: string } {
  if (mad < 0.008) return { label: "Close conformance", color: "text-emerald-400" };
  if (mad < 0.01) return { label: "Acceptable conformance", color: "text-lime-400" };
  if (mad < 0.012) return { label: "Marginally acceptable", color: "text-amber-400" };
  return { label: "Nonconformance", color: "text-red-400" };
}

export function BenfordAnalysis({ result }: { result: BacktestResult }) {
  const { trades } = result;
  const [mode, setMode] = useState<DigitMode>("first");
  const [field, setField] = useState<FieldKey>("pnl_abs");

  const analysis = useMemo(() => {
    const values = extractValues(trades, field);
    const digits = mode === "first" ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const getDigit = mode === "first" ? firstDigit : secondDigit;
    const benford = mode === "first" ? benfordFirst : benfordSecond;

    const counts: Record<number, number> = {};
    for (const d of digits) counts[d] = 0;
    let total = 0;
    for (const v of values) {
      const d = getDigit(v);
      if (d === null) continue;
      if (!(d in counts)) continue;
      counts[d]++;
      total++;
    }

    if (total === 0) return null;

    let chiSq = 0;
    let mad = 0;
    const dist = digits.map((d) => {
      const observedCount = counts[d];
      const observedProp = observedCount / total;
      const expectedProp = benford(d);
      const expectedCount = expectedProp * total;
      if (expectedCount > 0) chiSq += ((observedCount - expectedCount) ** 2) / expectedCount;
      mad += Math.abs(observedProp - expectedProp);
      return {
        digit: d,
        observed: observedProp * 100,
        expected: expectedProp * 100,
        observedCount,
        expectedCount,
      };
    });
    mad /= digits.length;

    // df = digits - 1
    const df = digits.length - 1;
    // chi-square critical at alpha=0.05
    const chiCrit = mode === "first" ? 15.507 : 16.919; // df=8 / df=9
    return { dist, total, chiSq, mad, df, chiCrit, passesChi: chiSq < chiCrit };
  }, [trades, field, mode]);

  if (trades.length < 30) {
    return (
      <div className="flex items-center justify-center h-40 text-zinc-500 text-sm px-6 text-center">
        Benford&apos;s Law conformance needs a reasonable sample. Run a backtest with at least ~30 trades (more is better) for a meaningful test.
      </div>
    );
  }

  if (!analysis) {
    return <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">No usable values for this field.</div>;
  }

  const verdict = mode === "first" ? firstDigitVerdict(analysis.mad) : secondDigitVerdict(analysis.mad);

  return (
    <div className="space-y-5">
      <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-3 text-[11px] text-zinc-400 leading-relaxed">
        <strong className="text-zinc-300">Benford&apos;s Law</strong> predicts the frequency of leading digits in naturally
        occurring numeric data: digit <span className="font-mono">d</span> leads with probability{" "}
        <span className="font-mono text-zinc-300">log₁₀(1 + 1/d)</span>. Strong deviation in financial figures is a
        classic <em>forensic flag</em> — it can indicate manipulated, rounded, capped, or synthetically generated data.
        Here it&apos;s applied to your backtest&apos;s trade values as a data-integrity sanity check.
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1 bg-zinc-900 border border-zinc-700 rounded-lg p-0.5">
          {(["first", "second"] as DigitMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                mode === m ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {m === "first" ? "First Digit" : "Second Digit"}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {FIELDS.map((f) => (
            <button
              key={f.key}
              onClick={() => setField(f.key)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                field === f.key
                  ? "bg-zinc-100 border-zinc-100 text-zinc-900"
                  : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Sample Size", value: String(analysis.total), color: "text-zinc-300", note: "usable values" },
          { label: "MAD", value: analysis.mad.toFixed(4), color: verdict.color, note: "mean abs deviation" },
          { label: "Conformance", value: verdict.label, color: verdict.color, note: "Nigrini MAD scale", small: true },
          {
            label: "χ² Test",
            value: `${analysis.chiSq.toFixed(1)} / ${analysis.chiCrit}`,
            color: analysis.passesChi ? "text-emerald-400" : "text-red-400",
            note: analysis.passesChi ? `pass (df=${analysis.df}, α=.05)` : `reject (df=${analysis.df}, α=.05)`,
          },
        ].map((c) => (
          <div key={c.label} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
            <div className={`font-bold font-mono ${c.color} ${"small" in c && c.small ? "text-sm leading-tight" : "text-xl"}`}>{c.value}</div>
            <div className="text-[10px] text-zinc-600 mt-1">{c.note}</div>
          </div>
        ))}
      </div>

      {/* Observed vs expected chart */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-1">
          {mode === "first" ? "First" : "Second"}-Digit Distribution — {FIELDS.find((f) => f.key === field)?.label}
        </h4>
        <p className="text-[10px] text-zinc-600 mb-3">Bars = observed frequency, line = Benford expected. Large gaps flag non-natural data.</p>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={analysis.dist} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="digit" tick={{ fill: "#71717a", fontSize: 11 }} label={{ value: `${mode === "first" ? "First" : "Second"} digit`, position: "insideBottomRight", fill: "#52525b", fontSize: 10 }} />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
            <Tooltip
              content={({ payload, label }) => {
                if (!payload?.length) return null;
                const d = payload[0]?.payload as { digit: number; observed: number; expected: number; observedCount: number } | undefined;
                if (!d) return null;
                const gap = d.observed - d.expected;
                return (
                  <div style={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: "#a1a1aa", marginBottom: 4 }}>Digit {label}</div>
                    <div style={{ color: "#818cf8" }}>Observed: {d.observed.toFixed(1)}% ({d.observedCount})</div>
                    <div style={{ color: "#f59e0b" }}>Expected: {d.expected.toFixed(1)}%</div>
                    <div style={{ color: Math.abs(gap) > 3 ? "#ef4444" : "#71717a" }}>Gap: {gap > 0 ? "+" : ""}{gap.toFixed(1)}pp</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="observed" name="Observed %" isAnimationActive={false} maxBarSize={42}>
              {analysis.dist.map((d, i) => {
                const gap = Math.abs(d.observed - d.expected);
                return <Cell key={i} fill={gap > 4 ? "#ef4444" : gap > 2 ? "#f59e0b" : "#818cf8"} fillOpacity={0.85} />;
              })}
            </Bar>
            <Line dataKey="expected" name="Benford expected" stroke="#fbbf24" strokeWidth={2} dot={{ r: 3, fill: "#fbbf24" }} isAnimationActive={false} />
            <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Per-digit table */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-3">Per-Digit Breakdown</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500 border-b border-zinc-800">
                <th className="text-left pb-2 font-normal">Digit</th>
                <th className="text-right pb-2 font-normal">Count</th>
                <th className="text-right pb-2 font-normal">Observed</th>
                <th className="text-right pb-2 font-normal">Expected</th>
                <th className="text-right pb-2 font-normal">Gap (pp)</th>
              </tr>
            </thead>
            <tbody>
              {analysis.dist.map((d) => {
                const gap = d.observed - d.expected;
                return (
                  <tr key={d.digit} className="border-b border-zinc-800/50">
                    <td className="py-1.5 font-mono text-zinc-300">{d.digit}</td>
                    <td className="py-1.5 text-right font-mono text-zinc-400">{d.observedCount}</td>
                    <td className="py-1.5 text-right font-mono text-indigo-300">{d.observed.toFixed(2)}%</td>
                    <td className="py-1.5 text-right font-mono text-amber-300">{d.expected.toFixed(2)}%</td>
                    <td className={`py-1.5 text-right font-mono ${Math.abs(gap) > 3 ? "text-red-400" : Math.abs(gap) > 1.5 ? "text-amber-400" : "text-zinc-500"}`}>
                      {gap > 0 ? "+" : ""}{gap.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-[10px] text-zinc-600 leading-relaxed">
        Note: Benford conformance is most reliable on data spanning several orders of magnitude (e.g. prices, dollar PnL).
        Bounded or narrow-range fields (like percent returns clustered near zero) naturally deviate and should not be read
        as manipulation. Synthetic GBM price data typically shows acceptable first-digit conformance.
      </div>
    </div>
  );
}
