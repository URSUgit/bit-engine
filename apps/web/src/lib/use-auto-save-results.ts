"use client";

import { useCallback, useEffect, useState } from "react";
import type { BacktestResult } from "./backtest-api";

const STORAGE_KEY = "bt_auto_history_v1";
const MAX_ENTRIES = 20;

export type AutoSaveEntry = {
  id: string;
  savedAt: string;
  result: BacktestResult;
};

function load(): AutoSaveEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(entries: AutoSaveEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {}
}

export function useAutoSaveResults() {
  const [history, setHistory] = useState<AutoSaveEntry[]>([]);

  useEffect(() => { setHistory(load()); }, []);

  const push = useCallback((result: BacktestResult) => {
    setHistory((prev) => {
      const entry: AutoSaveEntry = {
        id: `${result.symbol}_${result.strategy}_${Date.now()}`,
        savedAt: new Date().toISOString(),
        result,
      };
      // Deduplicate: remove same symbol+strategy+interval runs older than 5min
      const deduped = prev.filter((e) => {
        const sameRun = e.result.symbol === result.symbol &&
          e.result.strategy === result.strategy &&
          e.result.interval === result.interval &&
          e.result.start_date === result.start_date;
        if (!sameRun) return true;
        // Keep if saved more than 5min ago (user likely wanted the earlier one)
        return (Date.now() - new Date(e.savedAt).getTime()) > 5 * 60_000;
      });
      const next = [entry, ...deduped].slice(0, MAX_ENTRIES);
      save(next);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setHistory((prev) => {
      const next = prev.filter((e) => e.id !== id);
      save(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    save([]);
    setHistory([]);
  }, []);

  return { history, push, remove, clear };
}
