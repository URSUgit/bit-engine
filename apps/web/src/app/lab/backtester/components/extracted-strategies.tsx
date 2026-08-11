"use client";

import { useEffect, useState } from "react";
import { Pencil, Check, X, RefreshCw, Sparkles } from "lucide-react";
import {
  scoutStrategiesApi,
  toBacktestSymbol,
  type ExtractedStrategy,
  type StrategyPatch,
} from "@/lib/scout-strategies-api";

interface ExtractedStrategiesProps {
  onLoad: (cfg: { symbol: string; strategy: string; positionPct?: number; leverage?: number }) => void;
}

type Draft = {
  name: string;
  pairs: string;
  position_pct: string;
  risk_pct: string;
  stop_loss_pct: string;
  take_profit_pct: string;
  leverage: string;
};

function toDraft(e: ExtractedStrategy): Draft {
  return {
    name: e.name ?? "",
    pairs: e.pairs.join(", "),
    position_pct: e.position_pct?.toString() ?? "",
    risk_pct: e.risk_pct?.toString() ?? "",
    stop_loss_pct: e.stop_loss_pct?.toString() ?? "",
    take_profit_pct: e.take_profit_pct?.toString() ?? "",
    leverage: e.leverage?.toString() ?? "",
  };
}

function numOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function ExtractedStrategies({ onLoad }: ExtractedStrategiesProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ExtractedStrategy[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const refresh = () => {
    setLoading(true);
    scoutStrategiesApi
      .list()
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, []);

  const startEdit = (e: ExtractedStrategy) => {
    setEditingId(e.id);
    setDraft(toDraft(e));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEdit = async (e: ExtractedStrategy) => {
    if (!draft) return;
    const patch: StrategyPatch = {
      name: draft.name.trim() || e.name,
      pairs: draft.pairs.split(",").map((p) => p.trim()).filter(Boolean),
      position_pct: numOrNull(draft.position_pct),
      risk_pct: numOrNull(draft.risk_pct),
      stop_loss_pct: numOrNull(draft.stop_loss_pct),
      take_profit_pct: numOrNull(draft.take_profit_pct),
      leverage: numOrNull(draft.leverage),
    };
    try {
      const updated = await scoutStrategiesApi.update(e.id, patch);
      setEntries((prev) => prev.map((x) => (x.id === e.id ? updated : x)));
    } finally {
      cancelEdit();
    }
  };

  const remove = async (id: number) => {
    setEntries((prev) => prev.filter((x) => x.id !== id));
    scoutStrategiesApi.remove(id).catch(refresh);
  };

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800/50 transition"
      >
        <span className="flex items-center gap-2">
          <Sparkles size={12} className="text-cyan-400" />
          Extracted Strategies
          <span className="text-xs bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded-full">{entries.length}</span>
        </span>
        <span className="text-zinc-600 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 p-2 space-y-1">
          <div className="flex justify-end px-1 pb-1">
            <button
              onClick={refresh}
              className="flex items-center gap-1 text-[10px] text-zinc-600 hover:text-cyan-400 transition"
            >
              <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          {entries.length === 0 && (
            <p className="text-[11px] text-zinc-600 px-2 py-3 text-center">
              No strategies extracted yet — analyze a video in Scout.
            </p>
          )}

          <div className="max-h-96 overflow-y-auto space-y-1">
            {entries.map((e) => {
              const isEditing = editingId === e.id;
              return (
                <div
                  key={e.id}
                  className={`rounded px-2.5 py-1.5 border transition ${
                    e.edited
                      ? "bg-amber-500/10 border-amber-500/40"
                      : "bg-zinc-800/30 border-zinc-700/40 hover:bg-zinc-800/60"
                  }`}
                >
                  {!isEditing ? (
                    <div
                      className="cursor-pointer group"
                      onClick={() =>
                        onLoad({
                          symbol: toBacktestSymbol(e.pairs[0] ?? "BTCUSDT"),
                          strategy: e.strategy,
                          positionPct: e.position_pct ?? undefined,
                          leverage: e.leverage ?? undefined,
                        })
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-zinc-200 truncate">{e.label}</span>
                            {e.edited && (
                              <span className="text-[9px] bg-amber-500/20 text-amber-400 px-1 py-0.5 rounded">
                                edited
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-zinc-500 truncate">{e.trader}</div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={(ev) => { ev.stopPropagation(); startEdit(e); }}
                            className="text-zinc-600 hover:text-cyan-400 transition opacity-0 group-hover:opacity-100"
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            onClick={(ev) => { ev.stopPropagation(); remove(e.id); }}
                            className="text-zinc-700 hover:text-red-400 transition text-xs opacity-0 group-hover:opacity-100"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[9px] text-zinc-600">
                        {e.pairs.length > 0 && <span>{e.pairs.join(", ")}</span>}
                        {e.position_pct != null && <span>pos {e.position_pct}%</span>}
                        {e.risk_pct != null && <span>risk {e.risk_pct}%</span>}
                        {e.stop_loss_pct != null && <span>SL {e.stop_loss_pct}%</span>}
                        {e.take_profit_pct != null && <span>TP {e.take_profit_pct}%</span>}
                        {e.leverage != null && <span>{e.leverage}x lev</span>}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5 py-1">
                      <input
                        value={draft?.name ?? ""}
                        onChange={(ev) => setDraft((d) => (d ? { ...d, name: ev.target.value } : d))}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-zinc-200"
                        placeholder="Name"
                      />
                      <input
                        value={draft?.pairs ?? ""}
                        onChange={(ev) => setDraft((d) => (d ? { ...d, pairs: ev.target.value } : d))}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-[10px] text-zinc-300"
                        placeholder="Pairs, comma separated"
                      />
                      <div className="grid grid-cols-3 gap-1">
                        {(
                          [
                            ["position_pct", "pos %"],
                            ["risk_pct", "risk %"],
                            ["stop_loss_pct", "SL %"],
                            ["take_profit_pct", "TP %"],
                            ["leverage", "lev x"],
                          ] as const
                        ).map(([key, label]) => (
                          <input
                            key={key}
                            value={draft?.[key] ?? ""}
                            onChange={(ev) => setDraft((d) => (d ? { ...d, [key]: ev.target.value } : d))}
                            placeholder={label}
                            className="bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-[10px] text-zinc-300"
                          />
                        ))}
                      </div>
                      <div className="flex justify-end gap-2 pt-0.5">
                        <button
                          onClick={cancelEdit}
                          className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition"
                        >
                          <X size={11} /> Cancel
                        </button>
                        <button
                          onClick={() => saveEdit(e)}
                          className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 transition"
                        >
                          <Check size={11} /> Save
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
