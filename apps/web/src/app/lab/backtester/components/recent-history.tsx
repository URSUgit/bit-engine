"use client";

import { useState } from "react";
import type { AutoSaveEntry } from "@/lib/use-auto-save-results";
import type { BacktestResult } from "@/lib/backtest-api";

interface RecentHistoryProps {
  history: AutoSaveEntry[];
  onLoad: (result: BacktestResult) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

export function RecentHistory({ history, onLoad, onRemove, onClear }: RecentHistoryProps) {
  const [open, setOpen] = useState(false);

  if (history.length === 0) return null;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800/50 transition"
      >
        <span className="flex items-center gap-2">
          <span>🕐</span>
          Recent Runs
          <span className="text-xs bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded-full">{history.length}</span>
        </span>
        <span className="text-zinc-600 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 p-2 space-y-1">
          <div className="flex justify-end px-1 pb-1">
            <button
              onClick={onClear}
              className="text-[10px] text-zinc-600 hover:text-red-400 transition"
            >
              Clear all
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {history.map((entry) => {
              const m = entry.result.metrics;
              const isPositive = m.total_return_pct >= 0;
              const timeAgo = (() => {
                const diff = Date.now() - new Date(entry.savedAt).getTime();
                if (diff < 60_000) return "just now";
                if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
                if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
                return `${Math.floor(diff / 86_400_000)}d ago`;
              })();

              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-2 bg-zinc-800/30 border border-zinc-700/40 rounded px-2.5 py-1.5 hover:bg-zinc-800/60 transition cursor-pointer group"
                  onClick={() => onLoad(entry.result)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-zinc-200">{entry.result.symbol}</span>
                      <span className="text-[10px] text-zinc-500">{entry.result.strategy}</span>
                      <span className="text-[10px] text-zinc-600">{entry.result.interval}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[11px] font-semibold ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
                        {isPositive ? "+" : ""}{m.total_return_pct.toFixed(1)}%
                      </span>
                      <span className="text-[10px] text-zinc-600">Sh {m.sharpe_ratio.toFixed(2)}</span>
                      <span className="text-[10px] text-zinc-600">{m.total_trades}T</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[9px] text-zinc-600">{timeAgo}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemove(entry.id); }}
                      className="text-zinc-700 hover:text-red-400 transition text-xs opacity-0 group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
