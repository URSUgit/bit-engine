"use client";

import { useEffect, useState } from "react";

export type BacktestConfig = {
  symbol: string;
  strategy: string;
  interval: string;
  periodDays: number;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  positionPct: number;
  strategyParams: Record<string, number>;
  spreadBps: number;
  leverage: number;
  latencyMs: number;
  enableMarketImpact: boolean;
  useFundingRates: boolean;
};

type Preset = {
  id: string;
  name: string;
  createdAt: string;
  config: BacktestConfig;
};

const STORAGE_KEY = "bt_presets_v1";

function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePresets(presets: Preset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {}
}

export function ConfigPresets({
  current,
  onLoad,
}: {
  current: BacktestConfig;
  onLoad: (config: BacktestConfig) => void;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [nameInput, setNameInput] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setPresets(loadPresets());
  }, []);

  function savePreset() {
    const name = nameInput.trim() || `${current.strategy}/${current.symbol} ${new Date().toLocaleDateString()}`;
    const preset: Preset = {
      id: Date.now().toString(),
      name,
      createdAt: new Date().toISOString(),
      config: current,
    };
    const next = [preset, ...presets].slice(0, 20);
    setPresets(next);
    savePresets(next);
    setNameInput("");
  }

  function deletePreset(id: string) {
    const next = presets.filter((p) => p.id !== id);
    setPresets(next);
    savePresets(next);
  }

  function exportAll() {
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backtester-presets-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target?.result as string) as Preset[];
        if (Array.isArray(imported)) {
          const merged = [...imported, ...presets]
            .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i)
            .slice(0, 20);
          setPresets(merged);
          savePresets(merged);
        }
      } catch {}
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800/50 transition"
      >
        <span className="flex items-center gap-2">
          <span>💾</span>
          Presets
          {presets.length > 0 && (
            <span className="text-xs bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded-full">{presets.length}</span>
          )}
        </span>
        <span className="text-zinc-600 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 p-3 space-y-3">
          {/* Save current */}
          <div className="flex gap-2">
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") savePreset(); }}
              placeholder={`${current.strategy} / ${current.symbol}`}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={savePreset}
              className="px-3 py-1.5 rounded bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-medium transition"
            >
              Save
            </button>
          </div>

          {/* Saved presets */}
          {presets.length === 0 && (
            <div className="text-xs text-zinc-600 text-center py-2">No saved presets yet.</div>
          )}
          <div className="space-y-1.5 max-h-52 overflow-y-auto">
            {presets.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 bg-zinc-800/50 border border-zinc-700/50 rounded px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-zinc-200 truncate">{p.name}</div>
                  <div className="text-[10px] text-zinc-600">
                    {p.config.symbol} · {p.config.strategy} · {p.config.interval} · {p.config.periodDays}d
                  </div>
                </div>
                <button
                  onClick={() => { onLoad(p.config); setOpen(false); }}
                  className="text-xs px-2 py-1 rounded bg-cyan-900/50 hover:bg-cyan-800/60 text-cyan-400 border border-cyan-900 transition shrink-0"
                >
                  Load
                </button>
                <button
                  onClick={() => deletePreset(p.id)}
                  className="text-xs px-1.5 py-1 rounded hover:bg-zinc-700 text-zinc-600 hover:text-red-400 transition shrink-0"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {/* Import / Export */}
          {presets.length > 0 && (
            <div className="flex gap-2 pt-1 border-t border-zinc-800">
              <button
                onClick={exportAll}
                className="flex-1 text-xs py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700 transition"
              >
                ↓ Export JSON
              </button>
              <label className="flex-1 text-xs py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700 transition cursor-pointer text-center">
                ↑ Import
                <input type="file" accept=".json" className="hidden" onChange={importFile} />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
