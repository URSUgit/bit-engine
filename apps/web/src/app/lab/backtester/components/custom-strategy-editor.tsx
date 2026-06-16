"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { backtestApi, type BacktestResult } from "@/lib/backtest-api";
import { MetricsGrid, EquityChart } from "./results";
import { isoDaysAgo } from "./shared";

// Lazy-load Monaco to avoid SSR issues
const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="h-[420px] bg-zinc-900 rounded animate-pulse flex items-center justify-center text-zinc-600 text-sm">
        Loading editor…
      </div>
    ),
  },
);

const STARTER_TEMPLATE = `from app.backtest.strategies.base import Strategy, StrategyContext
from app.backtest.models import Signal

class MyStrategy(Strategy):
    name = "custom"
    description = "My custom strategy"
    params_schema = {
        "period": {"type": "int", "default": 14, "min": 2, "max": 50, "label": "RSI Period"},
        "threshold": {"type": "float", "default": 30.0, "min": 10, "max": 45, "label": "Oversold"},
    }

    def on_bar(self, ctx: StrategyContext) -> Signal:
        closes = ctx.closes
        period = int(self.params["period"])
        threshold = float(self.params["threshold"])

        if len(closes) < period + 2:
            return "hold"

        # Simple momentum: buy if price rose last N bars
        if closes[-1] > closes[-period] * 1.02:
            if ctx.position is None:
                return "buy"
        elif closes[-1] < closes[-period] * 0.98:
            if ctx.position is not None:
                return "close"

        return "hold"
`;

export interface CustomStrategyEditorProps {
  symbol: string;
  strategy: string;
  interval: string;
  periodDays: number;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  positionPct: number;
  onSuccess?: (result: BacktestResult) => void;
}

export function CustomStrategyEditor({
  symbol,
  interval,
  periodDays,
  initialCapital,
  commissionPct,
  slippagePct,
  positionPct,
  onSuccess,
}: CustomStrategyEditorProps) {
  const [code, setCode] = useState(STARTER_TEMPLATE);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);

  async function runCustomBacktest() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await backtestApi.runCustomStrategy(code, {
        symbol,
        start_date: isoDaysAgo(periodDays),
        end_date: isoDaysAgo(0),
        interval,
        initial_capital: initialCapital,
        commission_pct: commissionPct / 100,
        slippage_pct: slippagePct / 100,
        position_size_pct: positionPct / 100,
      });
      setResult(res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">Custom Strategy Editor</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Write a Python strategy class and run it against the backtester instantly — no deployment needed.
          </p>
        </div>
        <button
          onClick={() => {
            setCode(STARTER_TEMPLATE);
            setResult(null);
            setError(null);
          }}
          className="px-3 py-1.5 rounded-md text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition"
        >
          Load Example
        </button>
      </div>

      {/* Monaco editor */}
      <div className="rounded-lg overflow-hidden border border-zinc-700">
        <MonacoEditor
          height="420px"
          language="python"
          theme="vs-dark"
          value={code}
          onChange={(val) => setCode(val ?? "")}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            tabSize: 4,
            insertSpaces: true,
            wordWrap: "on",
            automaticLayout: true,
          }}
        />
      </div>

      {/* Run config row */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-zinc-500">Running against:</span>
        <span className="px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 font-mono">
          {symbol}
        </span>
        <span className="px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 font-mono">
          {interval}
        </span>
        <span className="px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 font-mono">
          {periodDays}d
        </span>
        <span className="text-zinc-600">·</span>
        <span className="text-zinc-500">Capital: ${initialCapital.toLocaleString()}</span>
        <span className="text-zinc-500">· Commission: {commissionPct}%</span>
        <span className="text-zinc-500">· Slippage: {slippagePct}%</span>
        <span className="text-zinc-500">· Position: {positionPct}%</span>
      </div>

      {/* Run button */}
      <button
        onClick={runCustomBacktest}
        disabled={running}
        className={`w-full py-3 rounded-md font-semibold transition text-zinc-950 ${
          running
            ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
            : "bg-cyan-500 hover:bg-cyan-400"
        }`}
      >
        {running ? "Running custom backtest…" : "Run Custom Backtest"}
      </button>

      {/* Error panel */}
      {error && (
        <div className="bg-red-950/30 border border-red-800 rounded-lg p-4 space-y-1">
          <p className="text-red-400 text-sm font-semibold">Strategy Error</p>
          <pre className="text-red-300 text-xs whitespace-pre-wrap font-mono leading-relaxed">
            {error}
          </pre>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          <MetricsGrid result={result} />
          <EquityChart result={result} />
          {onSuccess && (
            <button
              onClick={() => onSuccess(result)}
              className="w-full py-2.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition text-sm"
            >
              Use This Strategy — Load into Single Mode
            </button>
          )}
        </div>
      )}
    </div>
  );
}
