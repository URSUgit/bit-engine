"use client";

import { useCallback, useEffect, useState } from "react";
import { backtestApi, type CorrelationResult } from "@/lib/backtest-api";
import { isoDaysAgo } from "./shared";

const DEFAULT_SYMBOLS = ["BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD", "AAPL", "SPY", "GLD"];

function corrColor(value: number | null): string {
  if (value === null) return "bg-zinc-800 text-zinc-600";
  const v = Math.max(-1, Math.min(1, value));
  if (v > 0.8) return "bg-emerald-600/80 text-emerald-100";
  if (v > 0.5) return "bg-emerald-700/60 text-emerald-200";
  if (v > 0.2) return "bg-emerald-900/50 text-emerald-300";
  if (v > -0.2) return "bg-zinc-700/50 text-zinc-300";
  if (v > -0.5) return "bg-red-900/50 text-red-300";
  if (v > -0.8) return "bg-red-700/60 text-red-200";
  return "bg-red-600/80 text-red-100";
}

function fmtCorr(v: number | null): string {
  if (v === null) return "—";
  return v.toFixed(2);
}

export function CorrelationHeatmap({
  activeSymbols,
  periodDays = 365,
}: {
  activeSymbols?: string[];
  periodDays?: number;
}) {
  const [symbols, setSymbols] = useState<string[]>(activeSymbols ?? DEFAULT_SYMBOLS);
  const [customInput, setCustomInput] = useState("");
  const [result, setResult] = useState<CorrelationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localPeriod, setLocalPeriod] = useState(periodDays);

  const compute = useCallback(async () => {
    if (symbols.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const r = await backtestApi.correlations({
        symbols,
        start_date: isoDaysAgo(localPeriod),
        end_date: isoDaysAgo(0),
        interval: "1d",
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [symbols, localPeriod]);

  useEffect(() => {
    compute();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function addSymbol() {
    const s = customInput.trim().toUpperCase();
    if (s && !symbols.includes(s)) setSymbols((prev) => [...prev, s]);
    setCustomInput("");
  }

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-semibold text-sm uppercase tracking-wide text-zinc-300">
          Correlation Heatmap
        </h3>
        <div className="flex items-center gap-2 text-xs">
          <select
            value={localPeriod}
            onChange={(e) => setLocalPeriod(Number(e.target.value))}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 focus:outline-none focus:border-cyan-500"
          >
            <option value={90}>90 days</option>
            <option value={180}>6 months</option>
            <option value={365}>1 year</option>
            <option value={730}>2 years</option>
          </select>
          <button
            onClick={compute}
            disabled={loading || symbols.length < 2}
            className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-zinc-950 rounded font-semibold transition"
          >
            {loading ? "…" : "Compute"}
          </button>
        </div>
      </div>

      {/* Symbol chips */}
      <div className="flex flex-wrap gap-1.5 items-center">
        {symbols.map((s) => (
          <span key={s} className="flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-200">
            {s}
            <button
              onClick={() => setSymbols((prev) => prev.filter((x) => x !== s))}
              className="text-zinc-500 hover:text-red-400 ml-0.5"
            >×</button>
          </span>
        ))}
        <input
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addSymbol()}
          placeholder="Add symbol…"
          className="bg-zinc-800/50 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-200 w-28 focus:outline-none focus:border-cyan-500"
        />
        <button onClick={addSymbol} className="text-xs text-cyan-400 hover:text-cyan-300">+Add</button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-950/30 border border-red-900 rounded p-2">{error}</div>
      )}

      {loading && (
        <div className="py-8 text-center text-zinc-500 text-sm">Computing correlations…</div>
      )}

      {result && !loading && (
        <div className="overflow-x-auto">
          <table className="text-xs border-separate" style={{ borderSpacing: "2px" }}>
            <thead>
              <tr>
                <th className="w-20" />
                {result.symbols.map((s) => (
                  <th key={s} className="text-zinc-400 font-medium pb-1 text-center min-w-[60px]">
                    {s.replace("-USD", "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.symbols.map((rowSym) => (
                <tr key={rowSym}>
                  <td className="text-zinc-400 font-medium pr-2 text-right">
                    {rowSym.replace("-USD", "")}
                  </td>
                  {result.symbols.map((colSym) => {
                    const val = result.matrix[rowSym]?.[colSym] ?? null;
                    return (
                      <td
                        key={colSym}
                        className={`text-center font-semibold rounded py-1.5 px-2 tabular-nums ${corrColor(val)}`}
                        title={`${rowSym} vs ${colSym}: ${fmtCorr(val)}`}
                      >
                        {fmtCorr(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex items-center gap-4 text-[10px] text-zinc-500">
            <span>Period: {result.start_date} → {result.end_date}</span>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-emerald-600/80 inline-block" />
              <span>high +</span>
              <span className="w-3 h-3 rounded-sm bg-zinc-700/50 inline-block ml-2" />
              <span>neutral</span>
              <span className="w-3 h-3 rounded-sm bg-red-600/80 inline-block ml-2" />
              <span>high −</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
