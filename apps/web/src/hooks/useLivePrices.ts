"use client";

import { useEffect, useRef, useState } from "react";
import { mockAssets } from "@/lib/mock-data";

export interface LivePrice {
  price: number;
  change24hPct: number;
  direction: "up" | "down" | "flat";
}

export type LivePriceMap = Record<string, LivePrice>;

const initial: LivePriceMap = Object.fromEntries(
  mockAssets.map((a) => [
    a.symbol,
    { price: a.price, change24hPct: a.priceChange24hPct, direction: "flat" as const },
  ])
);

/**
 * Polls /api/market/crypto for real prices. Falls back to mock data if the
 * API is unreachable. Updates every 15s (list) or 5s (focused single asset).
 */
export function useLivePrices(focusSymbol?: string): LivePriceMap {
  const [prices, setPrices] = useState<LivePriceMap>(initial);
  const prevRef = useRef<LivePriceMap>(initial);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const symbols = focusSymbol
          ? [focusSymbol]
          : Object.keys(initial);
        const cryptoSymbols = symbols.filter((s) =>
          ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "MATIC", "DOT", "LINK", "LTC", "ATOM", "UNI", "ARB", "OP"].includes(s)
        );
        if (cryptoSymbols.length === 0) return;

        const res = await fetch(`/api/market/crypto?symbols=${cryptoSymbols.join(",")}`, { cache: "no-store" });
        if (!res.ok) return;
        const envelope = await res.json();
        if (!envelope.data || !Array.isArray(envelope.data)) return;
        if (cancelled) return;

        setPrices((prev) => {
          const next = { ...prev };
          for (const coin of envelope.data) {
            const sym = coin.symbol?.toUpperCase();
            if (!sym) continue;
            const oldPrice = prevRef.current[sym]?.price ?? coin.price_usd;
            const dir = coin.price_usd > oldPrice ? "up" : coin.price_usd < oldPrice ? "down" : "flat";
            next[sym] = {
              price: coin.price_usd,
              change24hPct: coin.change_24h_pct ?? 0,
              direction: dir,
            };
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
