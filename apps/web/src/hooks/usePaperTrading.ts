"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
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
  const { data: session, status: authStatus } = useSession();
  const isAuthed = authStatus === "authenticated";

  const [state, setStateRaw] = useState<PaperState>({ balance: 10_000, positions: [] });
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [mounted, setMounted] = useState(false);
  const stateRef = useRef(state);

  // ─── Local-storage helpers (used when not authenticated) ──────────────────
  function setLocalState(s: PaperState) {
    stateRef.current = s;
    saveState(s);
    setStateRaw(s);
  }

  // ─── Initial load ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (authStatus === "loading") return;

    if (isAuthed) {
      fetch("/api/paper/state")
        .then((r) => r.json())
        .then((res: { balance: number; positions: PaperPosition[] }) => {
          const s: PaperState = { balance: res.balance, positions: res.positions ?? [] };
          stateRef.current = s;
          setStateRaw(s);
          setMounted(true);
        })
        .catch(() => setMounted(true));
    } else {
      const local = loadState();
      stateRef.current = local;
      setStateRaw(local);
      setMounted(true);
    }
  }, [isAuthed, authStatus]);

  // ─── Price polling ────────────────────────────────────────────────────────
  const fetchPrices = useCallback(async () => {
    const openSymbols = stateRef.current.positions
      .filter((p) => p.status === "open")
      .map((p) => p.symbol.toUpperCase());
    const needed = [...new Set([...CRYPTO_SYMBOLS.slice(0, 6), ...openSymbols])];
    try {
      const res = await fetch(`/api/exchange/ticker?symbols=${needed.join(",")}`);
      const env = await res.json();
      if (env.data && Array.isArray(env.data)) {
        const map: Record<string, number> = {};
        for (const t of env.data) map[t.symbol] = t.price;
        setPrices(map);

        if (isAuthed) {
          // Server-side auto-close check: just refetch state every 30s (prices poll every 5s)
          // TP/SL enforcement on the server is done via the close endpoint on user action.
          // For liquidation we do it client-side still (no real money at stake).
        }

        setStateRaw((prev) => {
          if (isAuthed) return prev; // server owns state when authenticated
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
  }, [isAuthed]);

  useEffect(() => {
    if (!mounted) return;
    fetchPrices();
    const id = setInterval(fetchPrices, 5_000);
    return () => clearInterval(id);
  }, [mounted, fetchPrices]);

  // ─── Enrich open positions with live P&L ─────────────────────────────────
  const livePositions: LivePosition[] = state.positions
    .filter((p) => p.status === "open")
    .map((p) => {
      const price = prices[p.symbol] ?? p.entry_price;
      const { pnl, pnl_pct, liq_price } = calcUnrealizedPnl(p, price);
      return { ...p, current_price: price, unrealized_pnl: pnl, unrealized_pnl_pct: pnl_pct, liq_price };
    });

  const closedPositions = state.positions.filter((p) => p.status === "closed");

  // ─── Actions ──────────────────────────────────────────────────────────────
  async function placeOrder(params: {
    symbol: string;
    side: PaperSide;
    size_usd: number;
    leverage: number;
    take_profit?: number | null;
    stop_loss?: number | null;
  }): Promise<{ error?: string }> {
    const price = prices[params.symbol] ?? 0;
    if (!price) return { error: "Price not available yet" };

    if (isAuthed) {
      try {
        const res = await fetch("/api/paper/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...params, entry_price: price }),
        });
        const data = await res.json();
        if (!res.ok) return { error: data.error ?? "Order failed" };
        // Refresh state from server
        const stateRes = await fetch("/api/paper/state").then((r) => r.json());
        const s: PaperState = { balance: stateRes.balance, positions: stateRes.positions ?? [] };
        stateRef.current = s;
        setStateRaw(s);
        return {};
      } catch {
        return { error: "Network error" };
      }
    } else {
      const { state: next, error } = openPosition(stateRef.current, { ...params, entry_price: price });
      if (error) return { error };
      setLocalState(next);
      return {};
    }
  }

  async function closePos(positionId: string): Promise<void> {
    const pos = stateRef.current.positions.find((p) => p.id === positionId);
    if (!pos) return;
    const price = prices[pos.symbol] ?? pos.entry_price;

    if (isAuthed) {
      await fetch(`/api/paper/close/${positionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ close_price: price }),
      });
      const stateRes = await fetch("/api/paper/state").then((r) => r.json());
      const s: PaperState = { balance: stateRes.balance, positions: stateRes.positions ?? [] };
      stateRef.current = s;
      setStateRaw(s);
    } else {
      setLocalState(closePosition(stateRef.current, positionId, price));
    }
  }

  async function resetBalance(): Promise<void> {
    if (isAuthed) {
      await fetch("/api/paper/reset", { method: "POST" });
      const stateRes = await fetch("/api/paper/state").then((r) => r.json());
      const s: PaperState = { balance: stateRes.balance, positions: stateRes.positions ?? [] };
      stateRef.current = s;
      setStateRaw(s);
    } else {
      setLocalState({ balance: 10_000, positions: state.positions });
    }
  }

  const totalUnrealizedPnl = livePositions.reduce((s, p) => s + p.unrealized_pnl, 0);
  const totalEquity = state.balance + livePositions.reduce((s, p) => s + p.size_usd / p.leverage, 0) + totalUnrealizedPnl;

  return {
    mounted,
    isAuthed,
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
