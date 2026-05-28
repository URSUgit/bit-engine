"use client";

import type { SymbolEntry } from "@/lib/backtest-api";
import { CategoryChip } from "./shared";

export function SymbolPicker(props: {
  symbols: SymbolEntry[];
  allCategories: string[];
  selectedCategory: string;
  onCategoryChange: (c: string) => void;
  search: string;
  onSearchChange: (s: string) => void;
  selected: string;
  onSelect: (s: string) => void;
  totalCount: number;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">Pair</label>
      <div className="flex gap-1 flex-wrap">
        <CategoryChip
          active={props.selectedCategory === "all"}
          onClick={() => props.onCategoryChange("all")}
        >
          All ({props.totalCount})
        </CategoryChip>
        {props.allCategories.map((c) => (
          <CategoryChip
            key={c}
            active={props.selectedCategory === c}
            onClick={() => props.onCategoryChange(c)}
          >
            {c}
          </CategoryChip>
        ))}
      </div>
      <input
        type="text"
        value={props.search}
        onChange={(e) => props.onSearchChange(e.target.value)}
        placeholder="Search…"
        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-sm focus:border-cyan-500 focus:outline-none"
      />
      <select
        value={props.selected}
        onChange={(e) => props.onSelect(e.target.value)}
        size={6}
        className="w-full px-2 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-sm focus:border-cyan-500 focus:outline-none"
      >
        {props.symbols.map((s) => (
          <option key={s.symbol} value={s.symbol}>
            {s.symbol} · {s.category === "custom" ? "★ custom" : s.category}
          </option>
        ))}
      </select>
    </div>
  );
}

export function MultiSymbolPicker(props: {
  symbols: SymbolEntry[];
  allCategories: string[];
  selectedCategory: string;
  onCategoryChange: (c: string) => void;
  search: string;
  onSearchChange: (s: string) => void;
  selected: string[];
  onToggle: (sym: string) => void;
  onClear: () => void;
  totalCount: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">
          Pairs ({props.selected.length} selected)
        </label>
        {props.selected.length > 0 && (
          <button
            onClick={props.onClear}
            className="text-xs text-zinc-500 hover:text-cyan-400"
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex gap-1 flex-wrap">
        <CategoryChip
          active={props.selectedCategory === "all"}
          onClick={() => props.onCategoryChange("all")}
        >
          All ({props.totalCount})
        </CategoryChip>
        {props.allCategories.map((c) => (
          <CategoryChip
            key={c}
            active={props.selectedCategory === c}
            onClick={() => props.onCategoryChange(c)}
          >
            {c}
          </CategoryChip>
        ))}
      </div>
      <input
        type="text"
        value={props.search}
        onChange={(e) => props.onSearchChange(e.target.value)}
        placeholder="Search…"
        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-sm focus:border-cyan-500 focus:outline-none"
      />
      <div className="max-h-48 overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-md p-1">
        {props.symbols.map((s) => {
          const checked = props.selected.includes(s.symbol);
          return (
            <button
              key={s.symbol}
              onClick={() => props.onToggle(s.symbol)}
              className={`w-full text-left px-2 py-1 rounded text-xs flex items-center gap-2 transition ${
                checked ? "bg-cyan-500/20 text-cyan-300" : "hover:bg-zinc-800 text-zinc-300"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                readOnly
                className="accent-cyan-500"
              />
              <span>{s.symbol}</span>
              {s.category === "custom" ? (
                <span className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-semibold bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                  custom
                </span>
              ) : (
                <span className="text-zinc-500 ml-auto">{s.category}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
