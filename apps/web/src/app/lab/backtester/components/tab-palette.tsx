"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PaletteEntry<T extends string> = { group: string; label: string; value: T };

// Rank a query against a label: exact prefix > word prefix > substring >
// subsequence > no match (null). Lower score = better.
function matchScore(query: string, label: string, group: string): number | null {
  const q = query.toLowerCase();
  const l = label.toLowerCase();
  const g = group.toLowerCase();
  if (!q) return 100;
  if (l.startsWith(q)) return 0;
  if (l.split(/\s+/).some((w) => w.startsWith(q))) return 1;
  if (l.includes(q)) return 2;
  if (g.includes(q)) return 3;
  // subsequence match on the label
  let i = 0;
  for (const ch of l) {
    if (ch === q[i]) i++;
    if (i === q.length) return 4;
  }
  return null;
}

export function TabPalette<T extends string>({
  groups,
  onSelect,
}: {
  groups: { label: string; tabs: { value: T; label: string }[] }[];
  onSelect: (tab: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const entries = useMemo<PaletteEntry<T>[]>(
    () => groups.flatMap((g) => g.tabs.map((t) => ({ group: g.label, label: t.label, value: t.value }))),
    [groups],
  );

  const results = useMemo(() => {
    return entries
      .map((e) => ({ e, score: matchScore(query, e.label, e.group) }))
      .filter((r): r is { e: PaletteEntry<T>; score: number } => r.score !== null)
      .sort((a, b) => a.score - b.score)
      .map((r) => r.e);
  }, [entries, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCursor(0);
  }, []);

  const pick = useCallback(
    (value: T) => {
      onSelect(value);
      close();
    },
    [onSelect, close],
  );

  // Global Cmd/Ctrl+J toggle (⌘K belongs to the site-wide search palette)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Keep the highlighted row in view
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 rounded transition-colors"
        title="Jump to any analysis panel"
      >
        <span>Jump to panel</span>
        <kbd className="px-1 py-0.5 bg-zinc-800 rounded text-[9px] font-mono">⌘J</kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") { close(); return; }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor((c) => Math.min(c + 1, results.length - 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                  return;
                }
                if (e.key === "Enter" && results[cursor]) {
                  pick(results[cursor].value);
                }
              }}
              placeholder="Search panels… (e.g. benford, sharpe, drawdown)"
              className="w-full px-4 py-3 bg-transparent text-sm text-zinc-100 placeholder-zinc-600 outline-none border-b border-zinc-800"
            />
            <div ref={listRef} className="max-h-[45vh] overflow-y-auto py-1">
              {results.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-zinc-600">No matching panel.</div>
              )}
              {results.map((r, i) => (
                <button
                  key={`${r.group}-${r.value}`}
                  data-idx={i}
                  onClick={() => pick(r.value)}
                  onMouseEnter={() => setCursor(i)}
                  className={`w-full flex items-center justify-between px-4 py-2 text-left text-sm transition-colors ${
                    i === cursor ? "bg-indigo-600/20 text-zinc-100" : "text-zinc-400"
                  }`}
                >
                  <span>{r.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    i === cursor ? "bg-indigo-600/40 text-indigo-200" : "bg-zinc-800 text-zinc-500"
                  }`}>
                    {r.group}
                  </span>
                </button>
              ))}
            </div>
            <div className="px-4 py-2 border-t border-zinc-800 flex gap-3 text-[9px] text-zinc-600">
              <span><kbd className="px-1 bg-zinc-800 rounded font-mono">↑↓</kbd> navigate</span>
              <span><kbd className="px-1 bg-zinc-800 rounded font-mono">↵</kbd> open</span>
              <span><kbd className="px-1 bg-zinc-800 rounded font-mono">esc</kbd> close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
