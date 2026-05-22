"use client";

import type { StrategyInfo } from "@/lib/backtest-api";

export function CategoryChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-xs transition ${
        active ? "bg-cyan-500 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}

export function NumberInput(props: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-zinc-400 flex-1">{props.label}</span>
      <input
        type="number"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-24 px-2 py-1 text-xs bg-zinc-950 border border-zinc-800 rounded text-right focus:border-cyan-500 focus:outline-none"
      />
    </div>
  );
}

export function StrategyParamsForm(props: {
  strategy: StrategyInfo;
  values: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
}) {
  const entries = Object.entries(props.strategy.params_schema);
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2 border-t border-zinc-800 pt-3">
      <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Parameters</label>
      <div className="space-y-2">
        {entries.map(([key, spec]) => (
          <NumberInput
            key={key}
            label={key}
            value={props.values[key] ?? spec.default}
            min={spec.min}
            max={spec.max}
            step={spec.type === "int" ? 1 : 0.1}
            onChange={(v) => props.onChange({ ...props.values, [key]: v })}
          />
        ))}
      </div>
    </div>
  );
}

export function StrategyPicker(props: {
  strategies: StrategyInfo[];
  selected: string;
  onSelect: (s: string) => void;
}) {
  const selected = props.strategies.find((s) => s.name === props.selected);
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Strategy</label>
      <select
        value={props.selected}
        onChange={(e) => props.onSelect(e.target.value)}
        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-sm focus:border-cyan-500 focus:outline-none"
      >
        {props.strategies.map((s) => (
          <option key={s.name} value={s.name}>{s.name}</option>
        ))}
      </select>
      {selected && (
        <p className="text-xs text-zinc-500 leading-relaxed">{selected.description}</p>
      )}
    </div>
  );
}

export function CostInputs(props: {
  capital: number; setCapital: (n: number) => void;
  commissionBps: number; setCommissionBps: (n: number) => void;
  slippageBps: number; setSlippageBps: (n: number) => void;
  positionPct: number; setPositionPct: (n: number) => void;
}) {
  return (
    <div className="space-y-2 border-t border-zinc-800 pt-3">
      <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Costs & sizing</label>
      <NumberInput label="Capital ($)" value={props.capital} min={100} max={10_000_000} step={100} onChange={props.setCapital} />
      <NumberInput label="Commission (bps)" value={props.commissionBps} min={0} max={100} step={1} onChange={props.setCommissionBps} />
      <NumberInput label="Slippage (bps)" value={props.slippageBps} min={0} max={50} step={1} onChange={props.setSlippageBps} />
      <NumberInput label="Position size (%)" value={props.positionPct} min={1} max={100} step={1} onChange={props.setPositionPct} />
    </div>
  );
}

export type Preset = { label: string; days: number };
export const PRESETS: Preset[] = [
  { label: "1D", days: 1 },
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
  { label: "5Y", days: 365 * 5 },
  { label: "10Y", days: 365 * 10 },
];

export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function PeriodPicker({ periodDays, onChange }: { periodDays: number; onChange: (d: number) => void }) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Period</label>
      <div className="grid grid-cols-4 gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onChange(p.days)}
            className={`px-2 py-1.5 rounded text-xs font-medium transition ${
              periodDays === p.days
                ? "bg-cyan-500 text-zinc-950"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const INTERVALS = [
  { v: "1s", l: "1 sec" },
  { v: "1m", l: "1 min" },
  { v: "5m", l: "5 min" },
  { v: "15m", l: "15 min" },
  { v: "30m", l: "30 min" },
  { v: "1h", l: "1 hour" },
  { v: "4h", l: "4 hour" },
  { v: "1d", l: "Daily" },
  { v: "1wk", l: "Weekly" },
];

export function IntervalPicker({ interval, onChange }: { interval: string; onChange: (i: string) => void }) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Bar interval</label>
      <div className="grid grid-cols-3 gap-1">
        {INTERVALS.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`px-2 py-1.5 rounded text-xs font-medium transition ${
              interval === o.v
                ? "bg-cyan-500 text-zinc-950"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {o.l}
          </button>
        ))}
      </div>
      {(interval === "1s" || interval === "1m") && (
        <p className="text-xs text-amber-500/80">
          {interval === "1s"
            ? "1-second bars: crypto only (Binance). Yahoo doesn't expose ticks."
            : "1-min bars: limited to last ~7 days for stocks, full history for crypto."}
        </p>
      )}
    </div>
  );
}
