"use client";

import { useEffect, useState } from "react";

const SYMBOLS = ["BTC","ETH","SOL","ARB","OP","AVAX","LINK","MATIC","DOGE","BNB","ADA","DOT","LTC","ATOM","UNI","XRP"];

interface Tick { symbol: string; price: number; change: number; }

const FALLBACK: Tick[] = [
  { symbol: "BTC",   price: 67_842.50, change:  2.34 },
  { symbol: "ETH",   price:  3_412.18, change:  1.87 },
  { symbol: "SOL",   price:    178.42, change: -0.92 },
  { symbol: "ARB",   price:      1.24, change:  4.18 },
  { symbol: "OP",    price:      2.41, change:  3.02 },
  { symbol: "AVAX",  price:     38.21, change: -1.43 },
  { symbol: "LINK",  price:     14.82, change:  0.78 },
  { symbol: "MATIC", price:      0.71, change: -2.14 },
  { symbol: "DOGE",  price:     0.182, change:  5.62 },
  { symbol: "BNB",   price:    572.30, change:  1.12 },
  { symbol: "ADA",   price:      0.46, change: -0.33 },
  { symbol: "DOT",   price:      7.82, change:  0.55 },
  { symbol: "LTC",   price:     84.50, change: -1.01 },
  { symbol: "ATOM",  price:      9.10, change:  1.44 },
  { symbol: "UNI",   price:      9.88, change:  2.71 },
  { symbol: "XRP",   price:      0.62, change:  0.89 },
];

function formatPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

export function LiveTicker() {
  const [ticks, setTicks] = useState<Tick[]>(FALLBACK);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/exchange/ticker?symbols=${SYMBOLS.join(",")}`);
        const json = await res.json();
        if (json.data && Array.isArray(json.data)) {
          setTicks(
            (json.data as { symbol: string; price: number; price_change_pct: number }[]).map((t) => ({
              symbol: t.symbol,
              price: t.price,
              change: t.price_change_pct,
            }))
          );
        }
      } catch { /* keep fallback */ }
    }
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  const doubled = [...ticks, ...ticks];

  return (
    <div className="relative border-y border-slate-800 bg-slate-950/80 backdrop-blur overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-slate-950 to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-slate-950 to-transparent z-10 pointer-events-none" />

      <div className="ticker-track flex items-center gap-8 py-3 whitespace-nowrap will-change-transform">
        {doubled.map((t, i) => {
          const positive = t.change >= 0;
          return (
            <div key={i} className="flex items-center gap-2.5 shrink-0">
              <span className="text-xs font-bold text-slate-300 tracking-wide">{t.symbol}</span>
              <span className="text-xs font-mono text-slate-100">${formatPrice(t.price)}</span>
              <span className={`text-xs font-mono font-medium ${positive ? "text-emerald-400" : "text-red-400"}`}>
                {positive ? "▲" : "▼"} {Math.abs(t.change).toFixed(2)}%
              </span>
              <span className="w-1 h-1 rounded-full bg-slate-800" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
