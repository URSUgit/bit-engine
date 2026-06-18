"use client";

import { useEffect, useState } from "react";
import type { StrategyInfo } from "@/lib/backtest-api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParamTunerProps {
  strategy: StrategyInfo | undefined;
  params: Record<string, number>;
  onParamsChange: (params: Record<string, number>) => void;
  onRunNow: () => void;
  running: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ParamTuner({ strategy, params, onParamsChange, onRunNow, running }: ParamTunerProps) {
  const [open, setOpen] = useState(false);

  if (!strategy || Object.keys(strategy.params_schema).length === 0) return null;

  const paramEntries = Object.entries(strategy.params_schema);

  function nudge(key: string, spec: StrategyInfo["params_schema"][string], dir: 1 | -1) {
    const isInt = spec.type === "int";
    const step  = isInt ? 1 : 0.1;
    const cur   = params[key] ?? (typeof spec.default === "boolean" ? (spec.default ? 1 : 0) : spec.default);
    const next  = Math.max(spec.min ?? -Infinity, Math.min(spec.max ?? Infinity, cur + dir * step));
    const updated = { ...params, [key]: +next.toFixed(6) };
    onParamsChange(updated);
  }

  function setValue(key: string, spec: StrategyInfo["params_schema"][string], raw: string) {
    const v = parseFloat(raw);
    if (isNaN(v)) return;
    const clamped = Math.max(spec.min ?? -Infinity, Math.min(spec.max ?? Infinity, v));
    onParamsChange({ ...params, [key]: clamped });
  }

  function reset() {
    const defaults: Record<string, number> = {};
    paramEntries.forEach(([k, v]) => {
      defaults[k] = typeof v.default === "boolean" ? (v.default ? 1 : 0) : v.default;
    });
    onParamsChange(defaults);
  }

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800/50 transition"
      >
        <span className="flex items-center gap-2">
          <span>🎛</span>
          Quick Tune
          <span className="text-[10px] text-zinc-600 font-normal">{strategy.name}</span>
        </span>
        <span className="text-zinc-600 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 p-3 space-y-2">
          {paramEntries.map(([key, spec]) => {
            const rawDefault = typeof spec.default === "boolean" ? (spec.default ? 1 : 0) : spec.default;
            const value = params[key] ?? rawDefault;
            const isInt  = spec.type === "int";
            const pct    = spec.max !== undefined && spec.min !== undefined && spec.max !== spec.min
              ? ((value - spec.min) / (spec.max - spec.min)) * 100
              : 50;

            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-zinc-400">{spec.label ?? key}</label>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => nudge(key, spec, -1)}
                      className="w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs leading-none flex items-center justify-center transition"
                    >
                      –
                    </button>
                    <input
                      type="number"
                      value={isInt ? Math.round(value) : value}
                      step={isInt ? 1 : 0.1}
                      min={spec.min}
                      max={spec.max}
                      onChange={(e) => setValue(key, spec, e.target.value)}
                      className="w-16 text-center bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-xs text-zinc-200 focus:outline-none focus:border-cyan-600"
                    />
                    <button
                      onClick={() => nudge(key, spec, 1)}
                      className="w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs leading-none flex items-center justify-center transition"
                    >
                      +
                    </button>
                  </div>
                </div>
                {/* Micro slider track */}
                {spec.min !== undefined && spec.max !== undefined && (
                  <div className="relative h-1 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 bg-cyan-500/60 rounded-full transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {/* Run + Reset */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onRunNow}
              disabled={running}
              className={`flex-1 py-1.5 rounded text-xs font-semibold transition ${
                running
                  ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                  : "bg-cyan-600 hover:bg-cyan-500 text-white"
              }`}
            >
              {running ? "Running…" : "▶ Run Now"}
            </button>
            <button
              onClick={reset}
              className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-500 text-xs transition"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
