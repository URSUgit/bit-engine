"use client";

import { useEffect, useState } from "react";
import type { BacktestResult } from "@/lib/backtest-api";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TradeTag =
  | "clean_setup"
  | "fomo"
  | "overlevered"
  | "news_driven"
  | "trend_follow"
  | "counter_trend"
  | "revenge"
  | "runner"
  | "stopped_out"
  | "early_exit";

type JournalEntry = {
  id: string;          // `${symbol}_${strategy}_${entry_time}`
  notes: string;
  tags: TradeTag[];
  rating: 1 | 2 | 3 | 4 | 5;
  updatedAt: string;
};

const TAG_META: Record<TradeTag, { label: string; color: string }> = {
  clean_setup:    { label: "Clean Setup",     color: "bg-emerald-900/60 text-emerald-300 border-emerald-800" },
  fomo:           { label: "FOMO",            color: "bg-red-900/60 text-red-300 border-red-800" },
  overlevered:    { label: "Over-leveraged",  color: "bg-orange-900/60 text-orange-300 border-orange-800" },
  news_driven:    { label: "News Driven",     color: "bg-blue-900/60 text-blue-300 border-blue-800" },
  trend_follow:   { label: "Trend Follow",    color: "bg-cyan-900/60 text-cyan-300 border-cyan-800" },
  counter_trend:  { label: "Counter Trend",   color: "bg-violet-900/60 text-violet-300 border-violet-800" },
  revenge:        { label: "Revenge Trade",   color: "bg-red-900/60 text-red-300 border-red-800" },
  runner:         { label: "Runner",          color: "bg-yellow-900/60 text-yellow-300 border-yellow-800" },
  stopped_out:    { label: "Stopped Out",     color: "bg-zinc-700/60 text-zinc-300 border-zinc-600" },
  early_exit:     { label: "Early Exit",      color: "bg-amber-900/60 text-amber-300 border-amber-800" },
};

const STORAGE_KEY = "bt_journal_v1";

function loadEntries(): Record<string, JournalEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveEntries(entries: Record<string, JournalEntry>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {}
}

function makeId(symbol: string, strategy: string, entry_time: string) {
  return `${symbol}_${strategy}_${entry_time}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StarRating({ value, onChange }: { value: number; onChange: (r: 1 | 2 | 3 | 4 | 5) => void }) {
  return (
    <div className="flex gap-0.5">
      {([1, 2, 3, 4, 5] as const).map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`text-lg leading-none transition-colors ${n <= value ? "text-yellow-400" : "text-zinc-700 hover:text-zinc-500"}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function TagPill({ tag, active, onToggle }: { tag: TradeTag; active: boolean; onToggle: () => void }) {
  const { label, color } = TAG_META[tag];
  return (
    <button
      onClick={onToggle}
      className={`px-2 py-0.5 rounded-full border text-[10px] font-medium transition-all ${
        active ? color : "bg-zinc-800/60 text-zinc-600 border-zinc-700 hover:text-zinc-400"
      }`}
    >
      {label}
    </button>
  );
}

type Trade = BacktestResult["trades"][number];

function TradeRow({
  trade, symbol, strategy, entry,
  onEdit, isEditing, onSave, onCancel,
}: {
  trade: Trade;
  symbol: string;
  strategy: string;
  entry: JournalEntry | undefined;
  onEdit: () => void;
  isEditing: boolean;
  onSave: (e: JournalEntry) => void;
  onCancel: () => void;
}) {
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [tags, setTags]   = useState<TradeTag[]>(entry?.tags ?? []);
  const [rating, setRating] = useState<1|2|3|4|5>(entry?.rating ?? 3);

  // Sync when entry changes externally
  useEffect(() => {
    setNotes(entry?.notes ?? "");
    setTags(entry?.tags ?? []);
    setRating(entry?.rating ?? 3);
  }, [entry]);

  const pnlColor = trade.pnl >= 0 ? "text-emerald-400" : "text-red-400";
  const pctStr   = `${trade.pnl >= 0 ? "+" : ""}${trade.pnl_pct.toFixed(2)}%`;

  const entryDate = new Date(trade.entry_time).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
  const exitDate  = new Date(trade.exit_time).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });

  const toggleTag = (t: TradeTag) => setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  return (
    <div className={`border rounded-lg transition-all ${isEditing ? "border-cyan-700 bg-zinc-900" : "border-zinc-800 bg-zinc-900/40"}`}>
      {/* Trade summary row */}
      <div className="flex items-center gap-3 px-3 py-2.5 cursor-pointer" onClick={isEditing ? onCancel : onEdit}>
        <div className="w-16 shrink-0">
          <div className={`text-sm font-bold ${pnlColor}`}>{pctStr}</div>
          <div className="text-[10px] text-zinc-500">${Math.abs(trade.pnl).toFixed(0)}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-zinc-300">
            <span>{entryDate}</span>
            <span className="text-zinc-600">→</span>
            <span>{exitDate}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${trade.side === "long" ? "bg-emerald-900/50 text-emerald-400" : "bg-red-900/50 text-red-400"}`}>
              {trade.side}
            </span>
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            {trade.entry_price.toLocaleString(undefined, { maximumFractionDigits: 2 })} → {trade.exit_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            <span className="ml-2 text-zinc-600">· {trade.duration_bars}b</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {entry && entry.tags.length > 0 && (
            <div className="flex gap-1 flex-wrap justify-end">
              {entry.tags.slice(0, 2).map((t) => (
                <span key={t} className={`px-1.5 py-0.5 rounded-full border text-[9px] font-medium ${TAG_META[t].color}`}>
                  {TAG_META[t].label}
                </span>
              ))}
              {entry.tags.length > 2 && <span className="text-[9px] text-zinc-600">+{entry.tags.length - 2}</span>}
            </div>
          )}
          {entry?.rating && (
            <span className="text-[11px] text-yellow-400">{"★".repeat(entry.rating)}</span>
          )}
          <span className="text-[10px] text-zinc-600">{entry ? "✎" : "+"}</span>
        </div>
      </div>

      {/* Edit panel */}
      {isEditing && (
        <div className="border-t border-zinc-800 p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-zinc-400">Trade Rating</span>
            <StarRating value={rating} onChange={setRating} />
          </div>

          <div>
            <div className="text-xs text-zinc-500 mb-1.5">Tags</div>
            <div className="flex gap-1.5 flex-wrap">
              {(Object.keys(TAG_META) as TradeTag[]).map((t) => (
                <TagPill key={t} tag={t} active={tags.includes(t)} onToggle={() => toggleTag(t)} />
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-zinc-500 mb-1.5">Notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What did you see? What did you miss? What would you do differently?"
              rows={3}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-600 resize-none"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onSave({ id: makeId(symbol, strategy, trade.entry_time), notes, tags, rating, updatedAt: new Date().toISOString() })}
              className="flex-1 py-1.5 rounded bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-medium transition"
            >
              Save Note
            </button>
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TradeJournal({ result }: { result: BacktestResult }) {
  const [entries, setEntries] = useState<Record<string, JournalEntry>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<TradeTag | "all">("all");
  const [ratingFilter, setRatingFilter] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "wins" | "losses">("all");
  const [sortBy, setSortBy] = useState<"pnl" | "pnl_pct" | "date">("date");

  useEffect(() => { setEntries(loadEntries()); }, []);

  function handleSave(entry: JournalEntry) {
    const next = { ...entries, [entry.id]: entry };
    setEntries(next);
    saveEntries(next);
    setEditingId(null);
  }

  function handleDelete(id: string) {
    const next = { ...entries };
    delete next[id];
    setEntries(next);
    saveEntries(next);
  }

  function exportJournal() {
    const relevant = result.trades.map((t) => {
      const id = makeId(result.symbol, result.strategy, t.entry_time);
      return { ...t, journal: entries[id] };
    });
    const blob = new Blob([JSON.stringify(relevant, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `journal-${result.symbol}-${result.strategy}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Filtered + sorted trades
  const filteredTrades = result.trades
    .filter((t) => {
      if (outcomeFilter === "wins" && t.pnl < 0) return false;
      if (outcomeFilter === "losses" && t.pnl >= 0) return false;
      const id = makeId(result.symbol, result.strategy, t.entry_time);
      const entry = entries[id];
      if (tagFilter !== "all" && (!entry || !entry.tags.includes(tagFilter))) return false;
      if (ratingFilter > 0 && (!entry || entry.rating !== ratingFilter)) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "pnl")     return b.pnl - a.pnl;
      if (sortBy === "pnl_pct") return b.pnl_pct - a.pnl_pct;
      return new Date(b.entry_time).getTime() - new Date(a.entry_time).getTime();
    });

  const annotatedCount = result.trades.filter((t) => entries[makeId(result.symbol, result.strategy, t.entry_time)]).length;
  const coverage = result.trades.length > 0 ? ((annotatedCount / result.trades.length) * 100).toFixed(0) : "0";

  // Tag frequency summary
  const tagCounts: Partial<Record<TradeTag, number>> = {};
  result.trades.forEach((t) => {
    const entry = entries[makeId(result.symbol, result.strategy, t.entry_time)];
    if (entry) entry.tags.forEach((tag) => { tagCounts[tag] = (tagCounts[tag] ?? 0) + 1; });
  });

  return (
    <div className="space-y-4">
      {/* Header stats */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
          <div>
            <h3 className="font-semibold text-zinc-100">Trade Journal</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {annotatedCount} of {result.trades.length} trades annotated ({coverage}% coverage)
            </p>
          </div>
          <button
            onClick={exportJournal}
            className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700 transition"
          >
            ↓ Export JSON
          </button>
        </div>

        {/* Tag frequency */}
        {Object.keys(tagCounts).length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {(Object.entries(tagCounts) as [TradeTag, number][])
              .sort((a, b) => b[1] - a[1])
              .map(([tag, count]) => (
                <button
                  key={tag}
                  onClick={() => setTagFilter(tagFilter === tag ? "all" : tag)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium transition-all ${
                    tagFilter === tag ? TAG_META[tag].color : "bg-zinc-800/60 text-zinc-500 border-zinc-700 hover:text-zinc-300"
                  }`}
                >
                  {TAG_META[tag].label}
                  <span className="opacity-70">{count}</span>
                </button>
              ))}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1 bg-zinc-900/50 border border-zinc-800 rounded p-1">
          {(["all", "wins", "losses"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setOutcomeFilter(f)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                outcomeFilter === f ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {f === "all" ? "All" : f === "wins" ? "Wins" : "Losses"}
            </button>
          ))}
        </div>

        <div className="flex gap-1 items-center">
          <span className="text-[11px] text-zinc-600">Rating:</span>
          <button
            onClick={() => setRatingFilter(0)}
            className={`px-2 py-0.5 rounded text-[11px] transition ${ratingFilter === 0 ? "bg-zinc-700 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"}`}
          >
            Any
          </button>
          {([1, 2, 3, 4, 5] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRatingFilter(ratingFilter === r ? 0 : r)}
              className={`text-sm transition ${ratingFilter === r ? "text-yellow-400" : "text-zinc-700 hover:text-zinc-400"}`}
            >
              {"★".repeat(r)}
            </button>
          ))}
        </div>

        <div className="ml-auto flex gap-1 items-center">
          <span className="text-[11px] text-zinc-600">Sort:</span>
          {(["date", "pnl", "pnl_pct"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`px-2 py-0.5 rounded text-[11px] transition ${
                sortBy === s ? "bg-zinc-700 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
              }`}
            >
              {s === "date" ? "Date" : s === "pnl" ? "P&L $" : "P&L %"}
            </button>
          ))}
        </div>
      </div>

      {/* Trades list */}
      <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
        {filteredTrades.length === 0 && (
          <div className="text-center text-zinc-600 text-sm py-8">No trades match the current filters.</div>
        )}
        {filteredTrades.map((trade) => {
          const id = makeId(result.symbol, result.strategy, trade.entry_time);
          return (
            <TradeRow
              key={id}
              trade={trade}
              symbol={result.symbol}
              strategy={result.strategy}
              entry={entries[id]}
              isEditing={editingId === id}
              onEdit={() => setEditingId(id)}
              onCancel={() => setEditingId(null)}
              onSave={handleSave}
            />
          );
        })}
      </div>

      {/* Quick stats for annotated trades */}
      {annotatedCount > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wide text-zinc-600 mb-2">Annotated Trades Breakdown</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {(Object.keys(tagCounts) as TradeTag[]).map((tag) => {
              const taggedTrades = result.trades.filter((t) => {
                const e = entries[makeId(result.symbol, result.strategy, t.entry_time)];
                return e?.tags.includes(tag);
              });
              const wins  = taggedTrades.filter((t) => t.pnl >= 0).length;
              const total = taggedTrades.length;
              const avgPct = total > 0 ? taggedTrades.reduce((s, t) => s + t.pnl_pct, 0) / total : 0;
              return (
                <div key={tag} className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border inline-block ${TAG_META[tag].color} mb-1`}>
                    {TAG_META[tag].label}
                  </div>
                  <div className="text-xs text-zinc-400">{wins}/{total} wins</div>
                  <div className={`text-sm font-semibold ${avgPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {avgPct >= 0 ? "+" : ""}{avgPct.toFixed(1)}% avg
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
