"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadState, saveState, openPosition, closePosition, checkAutoClose,
  calcUnrealizedPnl,
  type PaperState, type PaperPosition, type PaperSide,
} from "@/lib/paper-trading";

export type { PaperPosition, PaperSide };

export interface LivePosition extends PaperPosition {
  current_price: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  liq_price: number;
}

const CRYPTO_SYMBOLS = ["BTC","ETH","SOL","BNB","XRP","ADA","DOGE","AVAX","MATIC","DOT","LINK","LTC","ATOM","UNI","ARB","OP"];

export function usePaperTrading() {
  const [state, setStateRaw] = useState<PaperState>({ balance: 10_000, positions: [] });
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [mounted, setMounted] = useState(false);
  const stateRef = useRef(state);

  function setState(s: PaperState) {
    stateRef.current = s;
    saveState(s);
    setStateRaw(s);
  }

  useEffect(() => {
    setStateRaw(loadState());
    setMounted(true);
  }, []);

  // Poll Binance ticker for real prices
  const fetchPrices = useCallback(async () => {
    const openSymbols = stateRef.current.positions
      .filter((p) => p.status === "open")
      .map((p) => p.symbol.toUpperCase());
    // Always include majors so order panel has data
    const needed = [...new Set([...CRYPTO_SYMBOLS.slice(0, 6), ...openSymbols])];
    try {
      const res = await fetch(`/api/exchange/ticker?symbols=${needed.join(",")}`);
      const env = await res.json();
      if (env.data && Array.isArray(env.data)) {
        const map: Record<string, number> = {};
        for (const t of env.data) map[t.symbol] = t.price;
        setPrices(map);
        // Check auto-close (TP/SL/liq) after price update
        setStateRaw((prev) => {
          const next = checkAutoClose(prev, map);
          if (next !== prev) {
            stateRef.current = next;
            saveState(next);
            return next;
          }
          return prev;
        });
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    fetchPrices();
    const id = setInterval(fetchPrices, 5_000);
    return () => clearInterval(id);
  }, [mounted, fetchPrices]);

  // Enrich open positions with live P&L
  const livePositions: LivePosition[] = state.positions
    .filter((p) => p.status === "open")
    .map((p) => {
      const price = prices[p.symbol] ?? p.entry_price;
      const { pnl, pnl_pct, liq_price } = calcUnrealizedPnl(p, price);
      return { ...p, current_price: price, unrealized_pnl: pnl, unrealized_pnl_pct: pnl_pct, liq_price };
    });

  const closedPositions = state.positions.filter((p) => p.status === "closed");

  function placeOrder(params: {
    symbol: string;
    side: PaperSide;
    size_usd: number;
    leverage: number;
    take_profit?: number | null;
    stop_loss?: number | null;
  }): { error?: string } {
    const price = prices[params.symbol] ?? 0;
    if (!price) return { error: "Price not available yet" };
    const { state: next, error } = openPosition(stateRef.current, { ...params, entry_price: price });
    if (error) return { error };
    setState(next);
    return {};
  }

  function closePos(positionId: string): void {
    const pos = stateRef.current.positions.find((p) => p.id === positionId);
    if (!pos) return;
    const price = prices[pos.symbol] ?? pos.entry_price;
    setState(closePosition(stateRef.current, positionId, price));
  }

  function resetBalance() {
    setState({ balance: 10_000, positions: state.positions });
  }

  const totalUnrealizedPnl = livePositions.reduce((s, p) => s + p.unrealized_pnl, 0);
  const totalEquity = state.balance + livePositions.reduce((s, p) => s + p.size_usd / p.leverage, 0) + totalUnrealizedPnl;

  return {
    mounted,
    balance: state.balance,
    equity: totalEquity,
    livePositions,
    closedPositions,
    prices,
    totalUnrealizedPnl,
    placeOrder,
    closePos,
    resetBalance,
  };
}
