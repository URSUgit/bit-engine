"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLivePrices } from "@/hooks/useLivePrices";
import { cn } from "@/lib/utils";

interface BasePosition {
  id: number;
  asset: string;
  liveSymbol: string;
  side: "Long" | "Short" | "Yes" | "No";
  sizeUsd: number;
  leverage: number;
  entryPrice: number;
  protocol: string;
}

const BASE_POSITIONS: BasePosition[] = [
  { id: 1, asset: "ETH-USD",    liveSymbol: "ETH",       side: "Long",  sizeUsd: 4_200,  leverage: 5,  entryPrice: 3_420.00,  protocol: "Hyperliquid" },
  { id: 2, asset: "BTC-USD",    liveSymbol: "BTC",       side: "Long",  sizeUsd: 8_000,  leverage: 3,  entryPrice: 68_200.00, protocol: "Hyperliquid" },
  { id: 3, asset: "SOL-USD",    liveSymbol: "SOL",       side: "Short", sizeUsd: 2_000,  leverage: 5,  entryPrice: 182.40,    protocol: "Hyperliquid" },
  { id: 4, asset: "TRUMP-2024", liveSymbol: "TRUMP-2024",side: "Yes",   sizeUsd: 1_500,  leverage: 1,  entryPrice: 0.42,      protocol: "Polymarket"  },
  { id: 5, asset: "ARB-USD",    liveSymbol: "ARB",       side: "Long",  sizeUsd: 800,    leverage: 10, entryPrice: 1.24,      protocol: "Hyperliquid" },
  { id: 6, asset: "DOGE-USD",   liveSymbol: "DOGE",      side: "Long",  sizeUsd: 600,    leverage: 5,  entryPrice: 0.1820,    protocol: "Hyperliquid" },
  { id: 7, asset: "SUI-USD",    liveSymbol: "SUI",       side: "Short", sizeUsd: 1_200,  leverage: 3,  entryPrice: 1.31,      protocol: "Drift"       },
];

function fmtPrice(p: number) {
  if (p >= 1000) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function PnlCell({ pnlUsd, pnlPct }: { pnlUsd: number; pnlPct: number }) {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prev = useRef(pnlUsd);

  useEffect(() => {
    if (Math.abs(pnlUsd - prev.current) > 0.001) {
      setFlash(pnlUsd > prev.current ? "up" : "down");
      prev.current = pnlUsd;
      const t = setTimeout(() => setFlash(null), 500);
      return () => clearTimeout(t);
    }
  }, [pnlUsd]);

  const positive = pnlUsd >= 0;
  return (
    <div
      className={cn(
        "number-font font-semibold text-sm transition-colors duration-300",
        flash === "up"
          ? "text-emerald-300"
          : flash === "down"
          ? "text-red-300"
          : positive
          ? "text-emerald-400"
          : "text-red-400"
      )}
    >
      {positive ? "+" : ""}${Math.abs(pnlUsd).toFixed(2)}
      <span className="ml-2 text-[10px] opacity-70 font-medium">
        {positive ? "+" : ""}
        {pnlPct.toFixed(2)}%
      </span>
    </div>
  );
}

export function PositionsTable() {
  const livePrices = useLivePrices();

  const rows = useMemo(() => {
    return BASE_POSITIONS.map((p) => {
      const livePrice = livePrices[p.liveSymbol]?.price ?? p.entryPrice;
      const isLong = p.side === "Long" || p.side === "Yes";
      const sign = isLong ? 1 : -1;
      const pnlPct = ((livePrice / p.entryPrice) - 1) * 100 * sign;
      const pnlUsd = (p.sizeUsd * pnlPct) / 100;
      return { ...p, livePrice, pnlUsd, pnlPct, isLong };
    });
  }, [livePrices]);

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="border-b border-slate-800">
            {["Asset", "Side", "Size", "Lev", "Entry", "Current", "P&L", "Venue"].map((h) => (
              <th
                key={h}
                className="pb-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {rows.map((p) => (
            <tr key={p.id} className="hover:bg-slate-800/30 transition-colors">
              <td className="py-3.5 font-mono font-medium text-slate-100">{p.asset}</td>
              <td className="py-3.5">
                <span
                  className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide",
                    p.isLong
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-red-500/15 text-red-400"
                  )}
                >
                  {p.side}
                </span>
              </td>
              <td className="py-3.5 text-slate-300 number-font">
                ${p.sizeUsd.toLocaleString()}
              </td>
              <td className="py-3.5">
                <span className="text-[10px] text-slate-400 font-mono px-1.5 py-0.5 rounded bg-slate-800">
                  {p.leverage}×
                </span>
              </td>
              <td className="py-3.5 text-slate-400 number-font">${fmtPrice(p.entryPrice)}</td>
              <td className="py-3.5 text-slate-200 number-font">${fmtPrice(p.livePrice)}</td>
              <td className="py-3.5">
                <PnlCell pnlUsd={p.pnlUsd} pnlPct={p.pnlPct} />
              </td>
              <td className="py-3.5 text-xs text-slate-500">{p.protocol}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
