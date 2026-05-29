"use client";

import type { StrategyInfo, IntervalInfo } from "@/lib/backtest-api";

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

const EXCHANGE_PRESETS = [
  { label: "Binance",  commission: 0.1,  slippage: 0.05 },
  { label: "Coinbase", commission: 0.5,  slippage: 0.10 },
  { label: "Kraken",   commission: 0.16, slippage: 0.08 },
  { label: "IB",       commission: 0.10, slippage: 0.05 },
  { label: "Zero",     commission: 0.0,  slippage: 0.0  },
];

export function CostInputs(props: {
  capital: number; setCapital: (n: number) => void;
  commissionPct: number; setCommissionPct: (n: number) => void;
  slippagePct: number; setSlippagePct: (n: number) => void;
  positionPct: number; setPositionPct: (n: number) => void;
}) {
  const activePreset = EXCHANGE_PRESETS.find(
    (p) => p.commission === props.commissionPct && p.slippage === props.slippagePct,
  );

  return (
    <div className="space-y-2 border-t border-zinc-800 pt-3">
      <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Costs & sizing</label>

      {/* Exchange presets */}
      <div className="flex flex-wrap gap-1">
        {EXCHANGE_PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => { props.setCommissionPct(p.commission); props.setSlippagePct(p.slippage); }}
            className={`px-2 py-0.5 rounded text-xs transition ${
              activePreset?.label === p.label
                ? "bg-cyan-500 text-zinc-950"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <NumberInput label="Capital ($)" value={props.capital} min={100} max={10_000_000} step={100} onChange={props.setCapital} />

      {/* Commission % input */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-zinc-400 flex-1">Commission (%)</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={props.commissionPct}
            min={0}
            max={5}
            step={0.01}
            onChange={(e) => props.setCommissionPct(Number(e.target.value))}
            className="w-20 px-2 py-1 text-xs bg-zinc-950 border border-zinc-800 rounded text-right focus:border-cyan-500 focus:outline-none"
          />
          <span className="text-xs text-zinc-500">%</span>
        </div>
      </div>

      {/* Slippage % input */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-zinc-400 flex-1">Slippage (%)</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={props.slippagePct}
            min={0}
            max={5}
            step={0.01}
            onChange={(e) => props.setSlippagePct(Number(e.target.value))}
            className="w-20 px-2 py-1 text-xs bg-zinc-950 border border-zinc-800 rounded text-right focus:border-cyan-500 focus:outline-none"
          />
          <span className="text-xs text-zinc-500">%</span>
        </div>
      </div>

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

// Static fallback used until the backend interval metadata loads.
const INTERVALS_FALLBACK: IntervalInfo[] = [
  { value: "1s",  label: "1 sec",   sources: ["binance"],          asset_classes: ["crypto"] },
  { value: "1m",  label: "1 min",   sources: ["binance", "yahoo"], asset_classes: ["crypto", "stocks"], yahoo_max_days: 7 },
  { value: "5m",  label: "5 min",   sources: ["binance", "yahoo"], asset_classes: ["crypto", "stocks"], yahoo_max_days: 60 },
  { value: "15m", label: "15 min",  sources: ["binance", "yahoo"], asset_classes: ["crypto", "stocks"], yahoo_max_days: 60 },
  { value: "30m", label: "30 min",  sources: ["binance", "yahoo"], asset_classes: ["crypto", "stocks"], yahoo_max_days: 60 },
  { value: "1h",  label: "1 hour",  sources: ["binance", "yahoo"], asset_classes: ["crypto", "stocks"], yahoo_max_days: 730 },
  { value: "4h",  label: "4 hour",  sources: ["binance"],          asset_classes: ["crypto"] },
  { value: "1d",  label: "Daily",   sources: ["yahoo", "binance"], asset_classes: ["all"] },
  { value: "1wk", label: "Weekly",  sources: ["yahoo", "binance"], asset_classes: ["all"] },
];

const SHORT_LABELS: Record<string, string> = {
  "1s": "1 sec", "1m": "1 min", "5m": "5 min", "15m": "15 min", "30m": "30 min",
  "1h": "1 hour", "4h": "4 hour", "1d": "Daily", "1wk": "Weekly",
};

/**
 * Map a symbol's catalog category to the broad asset class the interval
 * metadata uses ("crypto" vs everything-Yahoo, treated as "stocks").
 * Returns null when unknown (e.g. custom symbols) → no fading.
 */
export function assetClassForCategory(category: string | undefined): string | null {
  if (!category) return null;
  if (category === "crypto") return "crypto";
  if (category === "custom") return null;  // unknown source — don't fade
  return "stocks";  // stocks, etfs, forex, commodities, indices are all Yahoo-sourced
}

function intervalAvailable(info: IntervalInfo, assetClass: string | null): boolean {
  if (!assetClass) return true;  // no symbol context → everything selectable
  return info.asset_classes.includes("all") || info.asset_classes.includes(assetClass);
}

export function IntervalPicker({
  interval, onChange, intervals, assetClass,
}: {
  interval: string;
  onChange: (i: string) => void;
  intervals?: IntervalInfo[];
  assetClass?: string | null;
}) {
  const list = (intervals && intervals.length > 0 ? intervals : INTERVALS_FALLBACK);
  const ac = assetClass ?? null;
  const selected = list.find((o) => o.value === interval);
  const selectedUnavailable = selected ? !intervalAvailable(selected, ac) : false;

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Bar interval</label>
      <div className="grid grid-cols-3 gap-1">
        {list.map((o) => {
          const available = intervalAvailable(o, ac);
          const active = interval === o.value && available;
          return (
            <button
              key={o.value}
              onClick={() => available && onChange(o.value)}
              disabled={!available}
              title={available
                ? `${o.label} · ${o.sources.join(", ")}`
                : `Not available for this ticker (${o.sources.join(", ")} only)`}
              className={`px-2 py-1.5 rounded text-xs font-medium transition ${
                active
                  ? "bg-cyan-500 text-zinc-950"
                  : available
                  ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  : "bg-zinc-900/60 text-zinc-600 cursor-not-allowed line-through opacity-50"
              }`}
            >
              {SHORT_LABELS[o.value] ?? o.label}
            </button>
          );
        })}
      </div>
      {selectedUnavailable && (
        <p className="text-xs text-red-400/90">
          This granularity isn&apos;t available for the selected ticker — pick a non-faded bar.
        </p>
      )}
      {!selectedUnavailable && (interval === "1s" || interval === "1m") && (
        <p className="text-xs text-amber-500/80">
          {interval === "1s"
            ? "1-second bars: crypto only (Binance). Yahoo doesn't expose ticks."
            : "1-min bars: limited to last ~7 days for stocks, full history for crypto."}
        </p>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-zinc-800 ${className ?? ""}`} />
  );
}
