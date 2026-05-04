"use client";

import { useEffect, useRef, useState } from "react";
import { mockAssets } from "@/lib/mock-data";

export interface LivePrice {
  price: number;
  change24hPct: number;
  direction: "up" | "down" | "flat";
}

export type LivePriceMap = Record<string, LivePrice>;

function seededRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const initial: LivePriceMap = Object.fromEntries(
  mockAssets.map((a) => [
    a.symbol,
    { price: a.price, change24hPct: a.priceChange24hPct, direction: "flat" as const },
  ])
);

// Base open prices for continuous 24h-change calculation
const opens: Record<string, number> = Object.fromEntries(
  mockAssets.map((a) => [a.symbol, a.price / (1 + a.priceChange24hPct / 100)])
);

/**
 * Simulates live price ticking via seeded Brownian motion.
 * Pass `focusSymbol` to get 800ms updates on a single asset (for detail pages).
 * Without it, ~28% of all assets update per 1500ms tick (for list pages).
 */
export function useLivePrices(focusSymbol?: string): LivePriceMap {
  const [prices, setPrices] = useState<LivePriceMap>(initial);
  const tick = useRef(0);

  useEffect(() => {
    const ms = focusSymbol ? 800 : 1500;
    const id = setInterval(() => {
      const r = seededRng(++tick.current * 8191);
      setPrices((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (!focusSymbol && r() > 0.28) continue;
          const entry = next[key]!;
          const vol =
            entry.price >= 1000 ? 0.0003 : entry.price >= 1 ? 0.0006 : 0.0011;
          const drift = (r() - 0.499) * vol;
          const newPrice = Math.max(entry.price * 0.3, entry.price * (1 + drift));
          const open = opens[key] ?? newPrice;
          next[key] = {
            price:
              newPrice >= 100
                ? +newPrice.toFixed(2)
                : newPrice >= 1
                ? +newPrice.toFixed(4)
                : +newPrice.toFixed(6),
            change24hPct: +((newPrice / open - 1) * 100).toFixed(2),
            direction:
              Math.abs(drift) < 0.00005 ? "flat" : drift > 0 ? "up" : "down",
          };
        }
        return next;
      });
    }, ms);
    return () => clearInterval(id);
  }, [focusSymbol]);

  return prices;
}
