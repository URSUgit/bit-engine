"use client";

import { useEffect, useState } from "react";

interface Tick {
  symbol: string;
  price: number;
  change: number;
}

const initialTicks: Tick[] = [
  { symbol: "BTC", price: 67_842.50, change: 2.34 },
  { symbol: "ETH", price: 3_412.18, change: 1.87 },
  { symbol: "SOL", price: 178.42, change: -0.92 },
  { symbol: "ARB", price: 1.24, change: 4.18 },
  { symbol: "OP", price: 2.41, change: 3.02 },
  { symbol: "AVAX", price: 38.21, change: -1.43 },
  { symbol: "LINK", price: 14.82, change: 0.78 },
  { symbol: "MATIC", price: 0.71, change: -2.14 },
  { symbol: "DOGE", price: 0.182, change: 5.62 },
  { symbol: "INJ", price: 27.40, change: 1.92 },
  { symbol: "TIA", price: 8.94, change: -0.43 },
  { symbol: "SEI", price: 0.84, change: 7.21 },
  { symbol: "SUI", price: 1.31, change: 2.06 },
  { symbol: "APT", price: 9.18, change: -0.84 },
  { symbol: "RNDR", price: 9.42, change: 3.71 },
];

function formatPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

export function LiveTicker() {
  const [ticks, setTicks] = useState(initialTicks);

  useEffect(() => {
    const id = setInterval(() => {
      setTicks((prev) =>
        prev.map((t) => {
          const drift = (Math.random() - 0.5) * 0.004;
          const newPrice = t.price * (1 + drift);
          const newChange = t.change + (Math.random() - 0.5) * 0.1;
          return { ...t, price: newPrice, change: newChange };
        })
      );
    }, 2000);
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
              <span
                className={`text-xs font-mono font-medium ${positive ? "text-emerald-400" : "text-red-400"}`}
              >
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
