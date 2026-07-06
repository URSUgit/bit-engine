"use client";

import { useEffect, useMemo, useState } from "react";
import { backtestApi, type BacktestResult, type Bar } from "@/lib/backtest-api";
import { SourceBadge, describeSource } from "./data-source";
import {
  XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, Legend, Line, ComposedChart, Bar as RBar, Cell,
} from "recharts";

type DigitMode = "first" | "second";
type Source = "trades" | "ohlcv";

const TRADE_FIELDS = [
  { key: "pnl_pct", label: "Trade PnL %" },
  { key: "pnl_abs", label: "Trade PnL $" },
  { key: "entry_price", label: "Entry Price" },
  { key: "exit_price", label: "Exit Price" },
  { key: "size", label: "Position Size" },
] as const;

const OHLCV_FIELDS = [
  { key: "volume", label: "Volume" },
  { key: "abs_return", label: "|Daily Return|" },
  { key: "close", label: "Close" },
  { key: "open", label: "Open" },
  { key: "high", label: "High" },
  { key: "low", label: "Low" },
] as const;

type FieldKey =
  | (typeof TRADE_FIELDS)[number]["key"]
  | (typeof OHLCV_FIELDS)[number]["key"];

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
  const frac = (v - Math.floor(v)) * 10;
  return Math.floor(frac);
}

function tradeValues(trades: BacktestResult["trades"], field: FieldKey): number[] {
  return trades.map((t) => {
    switch (field) {
      case "pnl_pct": return t.pnl_pct;
      case "pnl_abs": return t.pnl;
      case "entry_price": return t.entry_price;
      case "exit_price": return t.exit_price;
      case "size": return t.size;
      default: return NaN;
    }
  });
}

function barValues(bars: Bar[], field: FieldKey): number[] {
  if (field === "abs_return") {
    // |relative change| between consecutive closes — the cleanest Benford
    // candidate for a price feed (price *levels* dwell in regimes and deviate).
    const out: number[] = [];
    for (let i = 1; i < bars.length; i++) {
      const prev = bars[i - 1].c;
      if (prev) out.push(Math.abs((bars[i].c - prev) / prev));
    }
    return out;
  }
  return bars.map((b) => {
    switch (field) {
      case "open": return b.o;
      case "high": return b.h;
      case "low": return b.l;
      case "close": return b.c;
      case "volume": return b.v;
      default: return NaN;
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

function analyze(values: number[], mode: DigitMode) {
  const digits = mode === "first" ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const getDigit = mode === "first" ? firstDigit : secondDigit;
  const benford = mode === "first" ? benfordFirst : benfordSecond;

  const counts: Record<number, number> = {};
  for (const d of digits) counts[d] = 0;
  let total = 0;
  for (const v of values) {
    const d = getDigit(v);
    if (d === null || !(d in counts)) continue;
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
    return { digit: d, observed: observedProp * 100, expected: expectedProp * 100, observedCount };
  });
  mad /= digits.length;
  const df = digits.length - 1;
  const chiCrit = mode === "first" ? 15.507 : 16.919;
  return { dist, total, chiSq, mad, df, chiCrit, passesChi: chiSq < chiCrit };
}

export function BenfordAnalysis({ result }: { result: BacktestResult }) {
  const { trades } = result;
  const [mode, setMode] = useState<DigitMode>("first");
  const [source, setSource] = useState<Source>("trades");
  const [tradeField, setTradeField] = useState<FieldKey>("pnl_abs");
  const [ohlcvField, setOhlcvField] = useState<FieldKey>("volume");

  // OHLCV bars (fetched on demand)
  const [bars, setBars] = useState<Bar[] | null>(null);
  const [barsSource, setBarsSource] = useState<string | null>(null);
  const [loadingBars, setLoadingBars] = useState(false);
  const [barsError, setBarsError] = useState<string | null>(null);

  useEffect(() => {
    if (source !== "ohlcv") return;
    // `stale` only guards against out-of-order responses from superseded
    // effect runs — every state write happens in the latest run, so a
    // StrictMode double-invoke can never wedge the loading flag.
    let stale = false;
    setLoadingBars(true);
    setBarsError(null);
    backtestApi
      .data(result.symbol, result.start_date, result.end_date, result.interval)
      .then((data) => {
        if (stale) return;
        setBars(data.bars ?? []);
        setBarsSource(data.source ?? null);
      })
      .catch((e: unknown) => {
        if (!stale) setBarsError(e instanceof Error ? e.message : "Failed to load price data");
      })
      .finally(() => {
        if (!stale) setLoadingBars(false);
      });
    return () => { stale = true; };
  }, [source, result.symbol, result.start_date, result.end_date, result.interval]);

  const field = source === "trades" ? tradeField : ohlcvField;
  const fields = source === "trades" ? TRADE_FIELDS : OHLCV_FIELDS;

  const values = useMemo(() => {
    if (source === "trades") return tradeValues(trades, field);
    return bars ? barValues(bars, field) : [];
  }, [source, trades, bars, field]);

  const analysis = useMemo(() => analyze(values, mode), [values, mode]);

  // Guard: trades source needs trades
  if (source === "trades" && trades.length < 30) {
    return (
      <div className="space-y-4">
        <SourceTabs source={source} setSource={setSource} />
        <div className="flex items-center justify-center h-40 text-zinc-500 text-sm px-6 text-center">
          Benford&apos;s Law on trade values needs ~30+ trades. Switch to <strong className="text-zinc-300 mx-1">Raw OHLCV</strong> to
          test the underlying price series instead, which usually has far more data points.
        </div>
      </div>
    );
  }

  const verdict = analysis
    ? mode === "first" ? firstDigitVerdict(analysis.mad) : secondDigitVerdict(analysis.mad)
    : null;
  const fieldLabel = fields.find((f) => f.key === field)?.label ?? field;

  return (
    <div className="space-y-5">
      <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-3 text-[11px] text-zinc-400 leading-relaxed">
        <strong className="text-zinc-300">Benford&apos;s Law</strong> predicts the frequency of leading digits in naturally
        occurring numeric data: digit <span className="font-mono">d</span> leads with probability{" "}
        <span className="font-mono text-zinc-300">log₁₀(1 + 1/d)</span>. Strong deviation is a classic{" "}
        <em>forensic flag</em> for manipulated, rounded, capped, or synthetic data. Use <strong className="text-zinc-300">Trade values</strong>{" "}
        to vet strategy output, or <strong className="text-zinc-300">Raw OHLCV</strong> to validate the price feed itself.
      </div>

      {/* Source + mode controls */}
      <SourceTabs source={source} setSource={setSource} />

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
          {fields.map((f) => (
            <button
              key={f.key}
              onClick={() => (source === "trades" ? setTradeField(f.key) : setOhlcvField(f.key))}
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

      {/* Loading / error / empty states for OHLCV */}
      {source === "ohlcv" && loadingBars && (
        <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">
          Loading {result.symbol} {result.interval} price data…
        </div>
      )}
      {source === "ohlcv" && barsError && (
        <div className="flex items-center justify-center h-40 text-red-400 text-sm px-6 text-center">
          Couldn&apos;t load price data: {barsError}
        </div>
      )}

      {analysis && verdict && !(source === "ohlcv" && loadingBars) && (
        <>
          {source === "ohlcv" && bars && (
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-zinc-500">
              <span>
                Testing <span className="text-zinc-300 font-mono">{bars.length}</span> {result.symbol} {result.interval} bars
                ({result.start_date} → {result.end_date}).
              </span>
              <SourceBadge source={barsSource} />
              {describeSource(barsSource).isSynthetic && (
                <span className="text-amber-500/80">
                  — this is GBM demo data; Benford conformance here reflects the generator, not a real feed.
                </span>
              )}
            </div>
          )}

          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Sample Size", value: String(analysis.total), color: "text-zinc-300", note: "usable values", small: false },
              { label: "MAD", value: analysis.mad.toFixed(4), color: verdict.color, note: "mean abs deviation", small: false },
              { label: "Conformance", value: verdict.label, color: verdict.color, note: "Nigrini MAD scale", small: true },
              {
                label: "χ² Test",
                value: `${analysis.chiSq.toFixed(1)} / ${analysis.chiCrit}`,
                color: analysis.passesChi ? "text-emerald-400" : "text-red-400",
                note: analysis.passesChi ? `pass (df=${analysis.df}, α=.05)` : `reject (df=${analysis.df}, α=.05)`,
                small: false,
              },
            ].map((c) => (
              <div key={c.label} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
                <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
                <div className={`font-bold font-mono ${c.color} ${c.small ? "text-sm leading-tight" : "text-xl"}`}>{c.value}</div>
                <div className="text-[10px] text-zinc-600 mt-1">{c.note}</div>
              </div>
            ))}
          </div>

          {/* Observed vs expected chart */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-zinc-300 mb-1">
              {mode === "first" ? "First" : "Second"}-Digit Distribution — {fieldLabel}
              {source === "ohlcv" ? ` (${result.symbol})` : ""}
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
                <RBar dataKey="observed" name="Observed %" isAnimationActive={false} maxBarSize={42}>
                  {analysis.dist.map((d, i) => {
                    const gap = Math.abs(d.observed - d.expected);
                    return <Cell key={i} fill={gap > 4 ? "#ef4444" : gap > 2 ? "#f59e0b" : "#818cf8"} fillOpacity={0.85} />;
                  })}
                </RBar>
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
        </>
      )}

      {analysis === null && !(source === "ohlcv" && (loadingBars || barsError)) && (
        <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">No usable values for this field.</div>
      )}

      <div className="text-[10px] text-zinc-600 leading-relaxed">
        Note on price feeds: a single asset&apos;s <em>price level</em> (Open/High/Low/Close) usually <strong>fails</strong> Benford
        even on perfectly real data — price is autocorrelated and dwells in regimes (e.g. BTC spending long stretches near
        $6k / $16k / $60k inflates the leading digit there), so it isn&apos;t a Benford-style sample. The meaningful integrity
        tests for a feed are <strong>Volume</strong> and <strong>|Daily Return|</strong>, which span magnitudes cleanly — real
        BTC passes both (volume ≈ acceptable, returns ≈ close conformance). A strong deviation on <em>those</em> would point to a
        data-pipeline issue (capping, rounding, a bad feed) or synthetic generation.
      </div>
    </div>
  );
}

function SourceTabs({ source, setSource }: { source: Source; setSource: (s: Source) => void }) {
  return (
    <div className="flex gap-1 bg-zinc-900 border border-zinc-700 rounded-lg p-0.5 w-fit">
      {([
        { key: "trades" as Source, label: "Trade values" },
        { key: "ohlcv" as Source, label: "Raw OHLCV" },
      ]).map((s) => (
        <button
          key={s.key}
          onClick={() => setSource(s.key)}
          className={`px-3 py-1 text-xs rounded-md transition-colors ${
            source === s.key ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
