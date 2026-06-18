"use client";

import { useState, useId, useMemo } from "react";
import { backtestApi, type BacktestResult } from "@/lib/backtest-api";
import { MetricsGrid, EquityChart } from "./results";
import { isoDaysAgo } from "./shared";

// ─── Types ────────────────────────────────────────────────────────────────────

type Indicator =
  | "close"
  | "rsi"
  | "ema"
  | "sma"
  | "macd_line"
  | "macd_signal"
  | "bb_upper"
  | "bb_lower"
  | "bb_mid"
  | "volume"
  | "atr";

type Operator = ">" | "<" | ">=" | "<=" | "crosses_above" | "crosses_below";

interface Condition {
  id: string;
  indicator_a: Indicator;
  param_a: number;
  operator: Operator;
  indicator_b: Indicator | "value";
  param_b: number;
}

interface RuleSet {
  entry_conditions: Condition[];
  exit_conditions: Condition[];
  stop_loss_pct: number;
  take_profit_pct: number;
  direction: "long" | "short" | "both";
}

export interface ConditionBuilderProps {
  symbol: string;
  interval: string;
  periodDays: number;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  positionPct: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const INDICATORS: Record<Indicator, { label: string; defaultPeriod: number }> = {
  close:       { label: "Close Price",       defaultPeriod: 0 },
  rsi:         { label: "RSI",               defaultPeriod: 14 },
  ema:         { label: "EMA",               defaultPeriod: 20 },
  sma:         { label: "SMA",               defaultPeriod: 20 },
  macd_line:   { label: "MACD Line",         defaultPeriod: 12 },
  macd_signal: { label: "MACD Signal",       defaultPeriod: 9 },
  bb_upper:    { label: "Bollinger Upper",   defaultPeriod: 20 },
  bb_lower:    { label: "Bollinger Lower",   defaultPeriod: 20 },
  bb_mid:      { label: "Bollinger Mid",     defaultPeriod: 20 },
  volume:      { label: "Volume",            defaultPeriod: 0 },
  atr:         { label: "ATR",               defaultPeriod: 14 },
};

const INDICATOR_KEYS = Object.keys(INDICATORS) as Indicator[];

const OPERATORS: { value: Operator; label: string }[] = [
  { value: ">",             label: ">" },
  { value: "<",             label: "<" },
  { value: ">=",            label: ">=" },
  { value: "<=",            label: "<=" },
  { value: "crosses_above", label: "crosses above" },
  { value: "crosses_below", label: "crosses below" },
];

// ─── ID generator ─────────────────────────────────────────────────────────────

let _idSeq = 0;
function newId(): string {
  _idSeq += 1;
  return `cond_${_idSeq}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Default ruleset ──────────────────────────────────────────────────────────

function defaultRuleset(): RuleSet {
  return {
    entry_conditions: [
      {
        id: newId(),
        indicator_a: "rsi",
        param_a: 14,
        operator: "<",
        indicator_b: "value",
        param_b: 30,
      },
    ],
    exit_conditions: [
      {
        id: newId(),
        indicator_a: "rsi",
        param_a: 14,
        operator: ">",
        indicator_b: "value",
        param_b: 70,
      },
    ],
    stop_loss_pct: 0,
    take_profit_pct: 0,
    direction: "long",
  };
}

// ─── Code generation ──────────────────────────────────────────────────────────

function indicatorVarName(ind: Indicator, period: number): string {
  switch (ind) {
    case "close":       return "closes";
    case "rsi":         return `rsi_${period}`;
    case "ema":         return `ema_${period}`;
    case "sma":         return `sma_${period}`;
    case "macd_line":   return `macd_line_${period}`;
    case "macd_signal": return `macd_sig_${period}`;
    case "bb_upper":    return `bb_upper_${period}`;
    case "bb_lower":    return `bb_lower_${period}`;
    case "bb_mid":      return `bb_mid_${period}`;
    case "volume":      return "volumes";
    case "atr":         return `atr_${period}`;
  }
}

function generateComputations(conditions: Condition[]): string {
  const needed = new Set<string>();

  function collect(ind: Indicator | "value", period: number) {
    if (ind === "value") return;
    needed.add(`${ind}:${period}`);
  }

  for (const c of conditions) {
    collect(c.indicator_a, c.param_a);
    collect(c.indicator_b, c.param_b);
  }

  const lines: string[] = [];
  const seen = new Set<string>();

  for (const key of needed) {
    if (seen.has(key)) continue;
    seen.add(key);
    const colonIdx = key.indexOf(":");
    const ind = key.slice(0, colonIdx) as Indicator;
    const period = Number(key.slice(colonIdx + 1));
    const varName = indicatorVarName(ind, period);

    switch (ind) {
      case "close":
      case "volume":
        // already available as closes / volumes — no computation needed
        break;
      case "rsi":
        lines.push(`        ${varName} = _compute_rsi(closes, period=${period})`);
        break;
      case "ema":
        lines.push(`        ${varName} = _compute_ema(closes, period=${period})`);
        break;
      case "sma":
        lines.push(`        ${varName} = _compute_sma(closes, period=${period})`);
        break;
      case "macd_line": {
        const rawKey = `macd_raw:${period}`;
        if (!seen.has(rawKey)) {
          seen.add(rawKey);
          lines.push(`        _macd_line_${period}, _macd_sig_${period} = _compute_macd(closes, fast=${period})`);
        }
        lines.push(`        ${varName} = _macd_line_${period}`);
        break;
      }
      case "macd_signal": {
        const rawKey2 = `macd_raw:${period}`;
        if (!seen.has(rawKey2)) {
          seen.add(rawKey2);
          lines.push(`        _macd_line_${period}, _macd_sig_${period} = _compute_macd(closes, sig=${period})`);
        }
        lines.push(`        ${varName} = _macd_sig_${period}`);
        break;
      }
      case "bb_upper":
      case "bb_lower":
      case "bb_mid": {
        const bbKey = `bb_raw:${period}`;
        if (!seen.has(bbKey)) {
          seen.add(bbKey);
          lines.push(`        _bb_lower_${period}, _bb_mid_${period}, _bb_upper_${period} = _compute_bb(closes, period=${period})`);
        }
        if (ind === "bb_lower") {
          lines.push(`        ${varName} = _bb_lower_${period}`);
        } else if (ind === "bb_mid") {
          lines.push(`        ${varName} = _bb_mid_${period}`);
        } else {
          // bb_upper — the raw computation already uses _bb_upper_N
          lines.push(`        ${varName} = _bb_upper_${period}`);
        }
        break;
      }
      case "atr":
        lines.push(`        ${varName} = _compute_atr(highs, lows, closes, period=${period})`);
        break;
    }
  }

  return lines.join("\n") || "        pass  # no indicator computations needed";
}

function makeEntryCondLine(condition: Condition, index: number): string {
  const aVar = indicatorVarName(condition.indicator_a, condition.param_a);
  const aCurr = `${aVar}[-1]`;
  const aPrev = `${aVar}[-2]`;

  const bCurrStr =
    condition.indicator_b === "value"
      ? String(condition.param_b)
      : `${indicatorVarName(condition.indicator_b as Indicator, condition.param_b)}[-1]`;
  const bPrevStr =
    condition.indicator_b === "value"
      ? String(condition.param_b)
      : `${indicatorVarName(condition.indicator_b as Indicator, condition.param_b)}[-2]`;

  switch (condition.operator) {
    case ">":
      return `        entry = entry and (${aCurr} > ${bCurrStr})  # cond ${index + 1}`;
    case "<":
      return `        entry = entry and (${aCurr} < ${bCurrStr})  # cond ${index + 1}`;
    case ">=":
      return `        entry = entry and (${aCurr} >= ${bCurrStr})  # cond ${index + 1}`;
    case "<=":
      return `        entry = entry and (${aCurr} <= ${bCurrStr})  # cond ${index + 1}`;
    case "crosses_above":
      return `        entry = entry and (not (${aPrev} > ${bPrevStr}) and (${aCurr} > ${bCurrStr}))  # cond ${index + 1}`;
    case "crosses_below":
      return `        entry = entry and (not (${aPrev} < ${bPrevStr}) and (${aCurr} < ${bCurrStr}))  # cond ${index + 1}`;
  }
}

function makeExitCondLine(condition: Condition, index: number): string {
  const aVar = indicatorVarName(condition.indicator_a, condition.param_a);
  const aCurr = `${aVar}[-1]`;
  const aPrev = `${aVar}[-2]`;

  const bCurrStr =
    condition.indicator_b === "value"
      ? String(condition.param_b)
      : `${indicatorVarName(condition.indicator_b as Indicator, condition.param_b)}[-1]`;
  const bPrevStr =
    condition.indicator_b === "value"
      ? String(condition.param_b)
      : `${indicatorVarName(condition.indicator_b as Indicator, condition.param_b)}[-2]`;

  switch (condition.operator) {
    case ">":
      return `        exit_triggered = exit_triggered or (${aCurr} > ${bCurrStr})  # exit cond ${index + 1}`;
    case "<":
      return `        exit_triggered = exit_triggered or (${aCurr} < ${bCurrStr})  # exit cond ${index + 1}`;
    case ">=":
      return `        exit_triggered = exit_triggered or (${aCurr} >= ${bCurrStr})  # exit cond ${index + 1}`;
    case "<=":
      return `        exit_triggered = exit_triggered or (${aCurr} <= ${bCurrStr})  # exit cond ${index + 1}`;
    case "crosses_above":
      return `        exit_triggered = exit_triggered or (not (${aPrev} > ${bPrevStr}) and (${aCurr} > ${bCurrStr}))  # exit cond ${index + 1}`;
    case "crosses_below":
      return `        exit_triggered = exit_triggered or (not (${aPrev} < ${bPrevStr}) and (${aCurr} < ${bCurrStr}))  # exit cond ${index + 1}`;
  }
}

function generateStrategyCode(ruleset: RuleSet, strategyName: string): string {
  const allConditions = [...ruleset.entry_conditions, ...ruleset.exit_conditions];
  const indicatorComputations = generateComputations(allConditions);

  const entryChecks =
    ruleset.entry_conditions.length > 0
      ? ruleset.entry_conditions.map(makeEntryCondLine).join("\n")
      : "        pass  # no entry conditions";

  const exitChecks =
    ruleset.exit_conditions.length > 0
      ? ruleset.exit_conditions.map(makeExitCondLine).join("\n")
      : "        pass  # no exit conditions";

  let slTpCode = "        pass  # no SL/TP";
  if (ruleset.stop_loss_pct > 0 || ruleset.take_profit_pct > 0) {
    const lines: string[] = [];
    if (ruleset.stop_loss_pct > 0) {
      lines.push(`        # Stop loss: ${ruleset.stop_loss_pct}%`);
      lines.push(`        if has_pos and hasattr(pos, 'entry_price') and pos.entry_price:`);
      lines.push(`            sl_price = pos.entry_price * (1 - ${ruleset.stop_loss_pct / 100})`);
      lines.push(`            if bar.close <= sl_price:`);
      lines.push(`                exit_triggered = True`);
    }
    if (ruleset.take_profit_pct > 0) {
      lines.push(`        # Take profit: ${ruleset.take_profit_pct}%`);
      lines.push(`        if has_pos and hasattr(pos, 'entry_price') and pos.entry_price:`);
      lines.push(`            tp_price = pos.entry_price * (1 + ${ruleset.take_profit_pct / 100})`);
      lines.push(`            if bar.close >= tp_price:`);
      lines.push(`                exit_triggered = True`);
    }
    slTpCode = lines.join("\n");
  }

  const directionSignal =
    ruleset.direction === "short" ? "SELL_SHORT" : "BUY";

  const safeName = strategyName.replace(/[^a-zA-Z0-9_\s]/g, "").trim() || "BuiltStrategy";

  return `import numpy as np
from app.backtest.strategies.base import Signal, SignalType

def _compute_rsi(closes, period=14):
    deltas = np.diff(closes)
    seed = deltas[:period+1]
    up = seed[seed >= 0].sum()/period
    down = -seed[seed < 0].sum()/period
    rs = up/down if down != 0 else 1e9
    rsi = np.zeros_like(closes)
    rsi[:period] = 100. - 100./(1.+rs)
    for i in range(period, len(closes)):
        delta = deltas[i-1]
        upval = max(delta, 0)
        downval = max(-delta, 0)
        up = (up*(period-1) + upval)/period
        down = (down*(period-1) + downval)/period
        rs = up/down if down != 0 else 1e9
        rsi[i] = 100. - 100./(1.+rs)
    return rsi

def _compute_ema(closes, period=20):
    ema = np.zeros_like(closes)
    k = 2.0 / (period + 1)
    ema[period-1] = closes[:period].mean()
    for i in range(period, len(closes)):
        ema[i] = closes[i] * k + ema[i-1] * (1 - k)
    return ema

def _compute_sma(closes, period=20):
    return np.array([closes[max(0,i-period):i].mean() for i in range(1, len(closes)+1)])

def _compute_bb(closes, period=20):
    mid = _compute_sma(closes, period)
    std = np.array([closes[max(0,i-period):i].std() for i in range(1, len(closes)+1)])
    return mid - 2*std, mid, mid + 2*std

def _compute_macd(closes, fast=12, sig=9):
    slow = 26
    ema_fast = _compute_ema(closes, period=fast)
    ema_slow = _compute_ema(closes, period=slow)
    macd_line = ema_fast - ema_slow
    signal_line = _compute_ema(macd_line, period=sig)
    return macd_line, signal_line

def _compute_atr(highs, lows, closes, period=14):
    tr = np.maximum(highs - lows, np.maximum(abs(highs - np.roll(closes,1)), abs(lows - np.roll(closes,1))))
    atr = np.zeros_like(closes)
    atr[period-1] = tr[:period].mean()
    for i in range(period, len(closes)):
        atr[i] = (atr[i-1]*(period-1) + tr[i]) / period
    return atr

class BuiltStrategy:
    name = "${safeName}"
    description = "Built with Condition Builder"
    params = {}

    def on_bar(self, bar, context):
        closes = context.closes
        highs = context.highs
        lows = context.lows
        volumes = context.volumes
        n = len(closes)
        if n < 30:
            return None

        # Compute indicators
${indicatorComputations}

        # Entry conditions (AND logic)
        entry = True
${entryChecks}

        # Exit conditions (OR logic)
        exit_triggered = False
${exitChecks}

        # Stop loss / take profit
${slTpCode}

        pos = getattr(context, 'position', None) or getattr(bar, 'position', None)
        has_pos = pos is not None and getattr(pos, 'size', 0) != 0

        if not has_pos:
            if entry:
                return Signal(signal_type=SignalType.${directionSignal}, price=bar.close)
        else:
            if exit_triggered:
                return Signal(signal_type=SignalType.EXIT, price=bar.close)
        return None
`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function IndicatorSelect({
  value,
  onChange,
  id,
}: {
  value: Indicator;
  onChange: (v: Indicator) => void;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as Indicator)}
      className="px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
    >
      {INDICATOR_KEYS.map((k) => (
        <option key={k} value={k}>
          {INDICATORS[k].label}
        </option>
      ))}
    </select>
  );
}

function IndicatorBSelect({
  value,
  onChange,
  id,
}: {
  value: Indicator | "value";
  onChange: (v: Indicator | "value") => void;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as Indicator | "value")}
      className="px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
    >
      <option value="value">Value</option>
      {INDICATOR_KEYS.map((k) => (
        <option key={k} value={k}>
          {INDICATORS[k].label}
        </option>
      ))}
    </select>
  );
}

function ConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: Condition;
  onChange: (updated: Condition) => void;
  onRemove: () => void;
}) {
  const uid = useId();

  function setIndicatorA(v: Indicator) {
    onChange({
      ...condition,
      indicator_a: v,
      param_a: INDICATORS[v].defaultPeriod,
    });
  }

  function setIndicatorB(v: Indicator | "value") {
    onChange({
      ...condition,
      indicator_b: v,
      param_b: v === "value" ? 0 : INDICATORS[v as Indicator].defaultPeriod,
    });
  }

  const showPeriodA =
    condition.indicator_a !== "close" && condition.indicator_a !== "volume";
  const showPeriodB =
    condition.indicator_b !== "value" &&
    condition.indicator_b !== "close" &&
    condition.indicator_b !== "volume";

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-zinc-800/40 rounded-lg border border-zinc-700/50">
      {/* Indicator A */}
      <IndicatorSelect
        id={`${uid}-ind-a`}
        value={condition.indicator_a}
        onChange={setIndicatorA}
      />
      {showPeriodA && (
        <input
          type="number"
          min={1}
          max={200}
          value={condition.param_a}
          onChange={(e) => onChange({ ...condition, param_a: Number(e.target.value) })}
          className="w-16 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
          title="Period"
        />
      )}

      {/* Operator */}
      <select
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as Operator })}
        className="px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
      >
        {OPERATORS.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>

      {/* Indicator B */}
      <IndicatorBSelect
        id={`${uid}-ind-b`}
        value={condition.indicator_b}
        onChange={setIndicatorB}
      />
      {showPeriodB && (
        <input
          type="number"
          min={1}
          max={200}
          value={condition.param_b}
          onChange={(e) => onChange({ ...condition, param_b: Number(e.target.value) })}
          className="w-16 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
          title="Period"
        />
      )}
      {condition.indicator_b === "value" && (
        <input
          type="number"
          value={condition.param_b}
          step="any"
          onChange={(e) => onChange({ ...condition, param_b: Number(e.target.value) })}
          className="w-24 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
          title="Value"
          placeholder="0"
        />
      )}

      {/* Remove */}
      <button
        onClick={onRemove}
        className="ml-auto px-2 py-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-950/30 transition text-sm font-bold"
        title="Remove condition"
      >
        ×
      </button>
    </div>
  );
}

function ConditionSection({
  title,
  subtitle,
  conditions,
  onChange,
  onAdd,
}: {
  title: string;
  subtitle: string;
  conditions: Condition[];
  onChange: (updated: Condition[]) => void;
  onAdd: () => void;
}) {
  function updateCondition(id: string, updated: Condition) {
    onChange(conditions.map((c) => (c.id === id ? updated : c)));
  }

  function removeCondition(id: string) {
    onChange(conditions.filter((c) => c.id !== id));
  }

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
        <p className="text-xs text-zinc-500">{subtitle}</p>
      </div>
      {conditions.length === 0 && (
        <div className="p-3 bg-zinc-800/20 border border-dashed border-zinc-700 rounded-lg text-xs text-zinc-500 text-center">
          No conditions — add one below
        </div>
      )}
      {conditions.map((cond) => (
        <ConditionRow
          key={cond.id}
          condition={cond}
          onChange={(updated) => updateCondition(cond.id, updated)}
          onRemove={() => removeCondition(cond.id)}
        />
      ))}
      <button
        onClick={onAdd}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition"
      >
        <span className="text-cyan-400 font-bold">+</span>
        Add Condition
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ConditionBuilder({
  symbol,
  interval,
  periodDays,
  initialCapital,
  commissionPct,
  slippagePct,
  positionPct,
}: ConditionBuilderProps) {
  const [strategyName, setStrategyName] = useState("My Strategy");
  const [ruleset, setRuleset] = useState<RuleSet>(defaultRuleset);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);

  const generatedCode = useMemo(
    () => generateStrategyCode(ruleset, strategyName),
    [ruleset, strategyName],
  );

  function addEntryCondition() {
    setRuleset((prev) => ({
      ...prev,
      entry_conditions: [
        ...prev.entry_conditions,
        {
          id: newId(),
          indicator_a: "rsi",
          param_a: 14,
          operator: "<" as Operator,
          indicator_b: "value",
          param_b: 30,
        },
      ],
    }));
  }

  function addExitCondition() {
    setRuleset((prev) => ({
      ...prev,
      exit_conditions: [
        ...prev.exit_conditions,
        {
          id: newId(),
          indicator_a: "rsi",
          param_a: 14,
          operator: ">" as Operator,
          indicator_b: "value",
          param_b: 70,
        },
      ],
    }));
  }

  async function runBacktest() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await backtestApi.runCustomStrategy(generatedCode, {
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">Strategy Builder</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Build a strategy visually — no code required. Conditions are compiled to Python and run instantly.
          </p>
        </div>
        <input
          type="text"
          value={strategyName}
          onChange={(e) => setStrategyName(e.target.value)}
          placeholder="Strategy name"
          className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none min-w-[180px]"
        />
      </div>

      {/* Entry Conditions */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <ConditionSection
          title="Entry Conditions"
          subtitle="ALL conditions must be true to enter (AND logic)"
          conditions={ruleset.entry_conditions}
          onChange={(c) => setRuleset((prev) => ({ ...prev, entry_conditions: c }))}
          onAdd={addEntryCondition}
        />
      </div>

      {/* Exit Conditions */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <ConditionSection
          title="Exit Conditions"
          subtitle="ANY condition triggers exit (OR logic)"
          conditions={ruleset.exit_conditions}
          onChange={(c) => setRuleset((prev) => ({ ...prev, exit_conditions: c }))}
          onAdd={addExitCondition}
        />
      </div>

      {/* Risk Settings */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-zinc-200 mb-3">Risk Settings</h3>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <span>Stop Loss %</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={ruleset.stop_loss_pct}
              onChange={(e) =>
                setRuleset((prev) => ({ ...prev, stop_loss_pct: Number(e.target.value) }))
              }
              className="w-20 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:border-cyan-500 focus:outline-none"
            />
            <span className="text-zinc-600">(0 = disabled)</span>
          </label>

          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <span>Take Profit %</span>
            <input
              type="number"
              min={0}
              max={1000}
              step={0.1}
              value={ruleset.take_profit_pct}
              onChange={(e) =>
                setRuleset((prev) => ({ ...prev, take_profit_pct: Number(e.target.value) }))
              }
              className="w-20 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:border-cyan-500 focus:outline-none"
            />
            <span className="text-zinc-600">(0 = disabled)</span>
          </label>

          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <span>Direction</span>
            <select
              value={ruleset.direction}
              onChange={(e) =>
                setRuleset((prev) => ({
                  ...prev,
                  direction: e.target.value as RuleSet["direction"],
                }))
              }
              className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="long">Long</option>
              <option value="short">Short</option>
              <option value="both">Both</option>
            </select>
          </label>
        </div>
      </div>

      {/* Code Preview */}
      <details className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
        <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-zinc-300 hover:text-zinc-100 select-none flex items-center gap-2">
          <span>Code Preview</span>
          <span className="text-xs text-zinc-500">(updates live)</span>
        </summary>
        <div className="px-4 pb-4">
          <textarea
            readOnly
            value={generatedCode}
            rows={20}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-md p-3 text-xs font-mono text-zinc-300 leading-relaxed resize-none focus:outline-none"
          />
        </div>
      </details>

      {/* Run config info */}
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
        onClick={runBacktest}
        disabled={running}
        className={`w-full py-3 rounded-md font-semibold transition text-zinc-950 ${
          running
            ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
            : "bg-cyan-500 hover:bg-cyan-400"
        }`}
      >
        {running ? "Running backtest…" : "Run Backtest"}
      </button>

      {/* Error */}
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
        </div>
      )}
    </div>
  );
}
