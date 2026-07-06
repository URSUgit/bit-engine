"use client";

import { useState, useMemo } from "react";
import type { BacktestResult, StrategyInfo } from "@/lib/backtest-api";

// ── Pine Script generators per strategy ───────────────────────────────────────

function generateScalpEMA(p: Record<string, number | boolean>): string {
  const fastLen = p["fast_len"] ?? 9;
  const slowLen = p["slow_len"] ?? 21;
  const atrLen = p["atr_len"] ?? 14;
  const tpMult = p["tp_atr"] ?? 2.0;
  const slMult = p["sl_atr"] ?? 1.0;
  const volMultiple = p["volume_filter"] ?? 1.5;

  return `//@version=5
strategy("ScalpEMA — Bit-Engine", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=95, commission_type=strategy.commission.percent, commission_value=0.04)

// ── Inputs
fastLen = input.int(${fastLen}, "Fast EMA", minval=2)
slowLen = input.int(${slowLen}, "Slow EMA", minval=4)
atrLen  = input.int(${atrLen}, "ATR Period")
tpMult  = input.float(${tpMult}, "TP ATR mult", step=0.1)
slMult  = input.float(${slMult}, "SL ATR mult", step=0.1)
volMultiple = input.float(${volMultiple}, "Volume filter (x avg)", step=0.1)

// ── Indicators
emaFast = ta.ema(close, fastLen)
emaSlow = ta.ema(close, slowLen)
atr     = ta.atr(atrLen)
volAvg  = ta.sma(volume, 20)

// Volume filter
volOk = volume > volAvg * volMultiple

// ── Signals
longEntry  = ta.crossover(emaFast, emaSlow) and volOk
shortEntry = ta.crossunder(emaFast, emaSlow) and volOk

// ── Execution
if longEntry
    strategy.entry("Long", strategy.long)
    strategy.exit("Long TP/SL", "Long", limit=close + atr * tpMult, stop=close - atr * slMult)

if shortEntry
    strategy.entry("Short", strategy.short)
    strategy.exit("Short TP/SL", "Short", limit=close - atr * tpMult, stop=close + atr * slMult)

// ── Visuals
plot(emaFast, "EMA Fast", color=color.cyan, linewidth=1)
plot(emaSlow, "EMA Slow", color=color.orange, linewidth=1)
bgcolor(longEntry ? color.new(color.green, 90) : shortEntry ? color.new(color.red, 90) : na)`;
}

function generateRSIDivergence(p: Record<string, number | boolean>): string {
  const rsiLen = p["rsi_len"] ?? 14;
  const oversold = p["oversold"] ?? 30;
  const overbought = p["overbought"] ?? 70;
  const holdBars = p["hold_bars"] ?? 10;

  return `//@version=5
strategy("RSI Divergence Scalp — Bit-Engine", overlay=false, default_qty_type=strategy.percent_of_equity, default_qty_value=95, commission_type=strategy.commission.percent, commission_value=0.04)

// ── Inputs
rsiLen    = input.int(${rsiLen}, "RSI Length")
oversold  = input.int(${oversold}, "Oversold Level")
overbought = input.int(${overbought}, "Overbought Level")
holdBars  = input.int(${holdBars}, "Hold Bars")

// ── RSI
rsi = ta.rsi(close, rsiLen)

// ── Simple divergence detection (price makes lower low, RSI makes higher low)
priceLL = close < ta.lowest(close, 5)[1]
rsiHL   = rsi > ta.lowest(rsi, 5)[1]
bullDiv = priceLL and rsiHL and rsi < oversold

// Price makes higher high, RSI makes lower high
priceHH = close > ta.highest(close, 5)[1]
rsiLH   = rsi < ta.highest(rsi, 5)[1]
bearDiv = priceHH and rsiLH and rsi > overbought

// ── Execution
var int barsSinceEntry = 0
if strategy.position_size != 0
    barsSinceEntry += 1
else
    barsSinceEntry := 0

if bullDiv
    strategy.entry("Long", strategy.long)
    barsSinceEntry := 0

if bearDiv
    strategy.entry("Short", strategy.short)
    barsSinceEntry := 0

if barsSinceEntry >= holdBars
    strategy.close_all("Time Exit")

// ── Plot
plot(rsi, "RSI", color=color.purple)
hline(oversold, "Oversold", color=color.green, linestyle=hline.style_dashed)
hline(overbought, "Overbought", color=color.red, linestyle=hline.style_dashed)
hline(50, "Midline", color=color.gray, linestyle=hline.style_dotted)
bgcolor(bullDiv ? color.new(color.green, 85) : bearDiv ? color.new(color.red, 85) : na)`;
}

function generateVWAPReversion(p: Record<string, number | boolean>): string {
  const sigma = p["sigma"] ?? 1.5;
  const holdBars = p["hold_bars"] ?? 8;

  return `//@version=5
strategy("VWAP Reversion — Bit-Engine", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=95, commission_type=strategy.commission.percent, commission_value=0.04)

// ── Inputs
sigmaMult = input.float(${sigma}, "Standard Deviation Threshold", step=0.1)
holdBars  = input.int(${holdBars}, "Hold Bars")

// ── VWAP + rolling standard deviation
vwapVal = ta.vwap(hlc3)
vwapStd = ta.stdev(close, 20)

upperBand = vwapVal + sigmaMult * vwapStd
lowerBand = vwapVal - sigmaMult * vwapStd

// ── Signals: fade when price is far from VWAP
longEntry  = close < lowerBand and close[1] >= lowerBand[1]  // cross below lower band
shortEntry = close > upperBand and close[1] <= upperBand[1]  // cross above upper band
longExit   = close >= vwapVal
shortExit  = close <= vwapVal

// ── Execution
var int bars = 0
if strategy.position_size != 0
    bars += 1
else
    bars := 0

if longEntry
    strategy.entry("Long", strategy.long)
    bars := 0
if shortEntry
    strategy.entry("Short", strategy.short)
    bars := 0

if longExit or bars >= holdBars
    strategy.close("Long")
if shortExit or bars >= holdBars
    strategy.close("Short")

// ── Visuals
plot(vwapVal, "VWAP", color=color.yellow, linewidth=2)
plot(upperBand, "Upper Band", color=color.new(color.red, 50), linewidth=1)
plot(lowerBand, "Lower Band", color=color.new(color.green, 50), linewidth=1)`;
}

function generateBreakoutScalp(p: Record<string, number | boolean>): string {
  const lookback = p["lookback"] ?? 20;
  const volMult = p["volume_mult"] ?? 1.5;
  const holdBars = p["hold_bars"] ?? 12;

  return `//@version=5
strategy("Breakout Scalp — Bit-Engine", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=95, commission_type=strategy.commission.percent, commission_value=0.04)

// ── Inputs
lookback = input.int(${lookback}, "Breakout Lookback")
volMult  = input.float(${volMult}, "Volume Confirmation Mult", step=0.1)
holdBars = input.int(${holdBars}, "Max Hold Bars")

// ── Levels
highLevel = ta.highest(high, lookback)[1]
lowLevel  = ta.lowest(low, lookback)[1]
volAvg    = ta.sma(volume, lookback)

// ── Signals
breakoutUp   = close > highLevel and volume > volAvg * volMult
breakoutDown = close < lowLevel  and volume > volAvg * volMult

// ── Execution
var int holdCount = 0
if strategy.position_size != 0
    holdCount += 1
else
    holdCount := 0

if breakoutUp
    strategy.entry("Long", strategy.long)
    holdCount := 0

if breakoutDown
    strategy.entry("Short", strategy.short)
    holdCount := 0

if holdCount >= holdBars
    strategy.close_all("Time Exit")

// ── Visuals
plot(highLevel, "High Level", color=color.new(color.green, 40), style=plot.style_linebr)
plot(lowLevel,  "Low Level",  color=color.new(color.red, 40),   style=plot.style_linebr)
bgcolor(breakoutUp ? color.new(color.green, 85) : breakoutDown ? color.new(color.red, 85) : na)`;
}

function generateGeneric(strategyName: string, p: Record<string, number | boolean>): string {
  const paramLines = Object.entries(p)
    .map(([k, v]) => {
      if (typeof v === "boolean") return `// ${k} = ${v}`;
      return `float ${k.replace(/[^a-zA-Z0-9_]/g, "_")} = input.float(${Number(v).toFixed(4)}, "${k}")`;
    })
    .join("\n");

  return `//@version=5
// Auto-generated stub for strategy: ${strategyName}
// NOTE: This is a structural stub. Implement the full signal logic manually.
strategy("${strategyName} — Bit-Engine", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=95, commission_type=strategy.commission.percent, commission_value=0.04)

// ── Strategy Parameters
${paramLines || "// (no parameters)"}

// ── TODO: Implement signal logic
// longCondition = ...
// shortCondition = ...

// strategy.entry("Long",  strategy.long,  when=longCondition)
// strategy.entry("Short", strategy.short, when=shortCondition)
// strategy.close_all()`;
}

function buildPineScript(strategy: StrategyInfo, params: Record<string, number | boolean>): string {
  switch (strategy.name) {
    case "scalp_ema":
    case "ema_cross":
      return generateScalpEMA(params);
    case "rsi_divergence":
    case "rsi":
      return generateRSIDivergence(params);
    case "vwap_reversion":
    case "vwap":
      return generateVWAPReversion(params);
    case "breakout_scalp":
    case "breakout":
      return generateBreakoutScalp(params);
    default:
      return generateGeneric(strategy.name, params);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface PineScriptExportProps {
  result: BacktestResult;
  strategy: StrategyInfo;
  params: Record<string, number | boolean>;
}

export function PineScriptExport({ result, strategy, params }: PineScriptExportProps) {
  const [copied, setCopied] = useState(false);

  const code = useMemo(
    () => buildPineScript(strategy, params),
    [strategy, params],
  );

  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleDownload() {
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${strategy.name}.pine`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const isGenericStub = !["scalp_ema", "ema_cross", "rsi_divergence", "rsi", "vwap_reversion", "vwap", "breakout_scalp", "breakout"].includes(strategy.name);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-200">
              TradingView Pine Script v5 Export
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Strategy: <span className="text-cyan-400">{strategy.name}</span>
              {" · "}{Object.keys(params).length} parameters baked in
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={handleDownload}
              className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-xs font-medium text-cyan-300 transition"
            >
              Download .pine
            </button>
          </div>
        </div>
      </div>

      {/* Warnings */}
      {isGenericStub && (
        <div className="bg-yellow-950/20 border border-yellow-800/40 rounded-lg p-3 text-xs text-yellow-300">
          <strong>Structural stub:</strong> "{strategy.name}" doesn't have a full Pine Script template yet.
          The generated code includes your parameters as inputs but you'll need to implement the signal logic.
        </div>
      )}

      <div className="bg-blue-950/20 border border-blue-800/40 rounded-lg p-3 text-xs text-blue-300 space-y-1">
        <p><strong>How to use:</strong></p>
        <ol className="list-decimal list-inside space-y-0.5 text-blue-400">
          <li>Open TradingView → Pine Editor (bottom panel)</li>
          <li>Clear existing code and paste this script</li>
          <li>Click "Add to chart" to backtest in TradingView</li>
          <li>Compare results with Bit-Engine for cross-validation</li>
        </ol>
        <p className="text-blue-500 mt-2">
          Note: TradingView backtests use OHLC bars. This script approximates the strategy —
          results may differ from Bit-Engine due to execution model and data differences.
        </p>
      </div>

      {/* Code block */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800">
          <span className="text-xs font-mono text-zinc-500">Pine Script v5</span>
          <span className="text-xs text-zinc-600">{code.split("\n").length} lines</span>
        </div>
        <pre className="p-4 text-xs font-mono text-zinc-300 overflow-x-auto leading-relaxed whitespace-pre">
          <code>{code}</code>
        </pre>
      </div>

      {/* Backtest comparison */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
        <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">
          Bit-Engine Backtest Summary (for TradingView comparison)
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          {[
            { label: "Total Return", value: `${result.metrics.total_return_pct?.toFixed(2) ?? "—"}%` },
            { label: "Sharpe Ratio", value: result.metrics.sharpe_ratio?.toFixed(3) ?? "—" },
            { label: "Max Drawdown", value: `${result.metrics.max_drawdown_pct?.toFixed(2) ?? "—"}%` },
            { label: "Win Rate", value: `${result.metrics.win_rate_pct?.toFixed(1) ?? "—"}%` },
            { label: "Total Trades", value: String(result.trades.length) },
            { label: "Period", value: `${result.start_date} → ${result.end_date}` },
            { label: "Symbol", value: result.symbol ?? "—" },
            { label: "Interval", value: result.interval ?? "—" },
          ].map((item) => (
            <div key={item.label} className="bg-zinc-950/50 border border-zinc-800 rounded-lg p-2">
              <div className="text-zinc-500 mb-0.5">{item.label}</div>
              <div className="font-mono text-zinc-200 font-semibold">{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
