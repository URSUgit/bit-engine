"use client";

import { useEffect, useRef, useState } from "react";

export interface LivePrice {
  price: number;
  change24hPct: number;
  direction: "up" | "down" | "flat";
}

export type LivePriceMap = Record<string, LivePrice>;

const SYMBOLS = ["BTC","ETH","SOL","BNB","XRP","ADA","DOGE","AVAX","MATIC","DOT","LINK","LTC","ATOM","UNI","ARB","OP"];

const initial: LivePriceMap = Object.fromEntries(
  SYMBOLS.map((s) => [s, { price: 0, change24hPct: 0, direction: "flat" as const }])
);

export function useLivePrices(focusSymbol?: string): LivePriceMap {
  const [prices, setPrices] = useState<LivePriceMap>(initial);
  const prevRef = useRef<LivePriceMap>(initial);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const symbols = focusSymbol ? [focusSymbol] : SYMBOLS;
        const res = await fetch(`/api/exchange/ticker?symbols=${symbols.join(",")}`, { cache: "no-store" });
        if (!res.ok) return;
        const envelope = await res.json();
        if (!envelope.data || !Array.isArray(envelope.data)) return;
        if (cancelled) return;

        setPrices((prev) => {
          const next = { ...prev };
          for (const t of envelope.data as { symbol: string; price: number; price_change_pct: number }[]) {
            const sym = t.symbol.toUpperCase();
            const oldPrice = prevRef.current[sym]?.price ?? t.price;
            const dir = t.price > oldPrice ? "up" : t.price < oldPrice ? "down" : "flat";
            next[sym] = { price: t.price, change24hPct: t.price_change_pct ?? 0, direction: dir };
          }
          prevRef.current = next;
          return next;
        });
      } catch {
        // silently keep previous prices on error
      }
    }

    poll();
    const ms = focusSymbol ? 5_000 : 15_000;
    const id = setInterval(poll, ms);
    return () => { cancelled = true; clearInterval(id); };
  }, [focusSymbol]);

  return prices;
}
