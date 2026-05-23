"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { usePaperTrading, type LivePosition } from "@/hooks/usePaperTrading";
import { cn } from "@/lib/utils";

function fmtPrice(p: number) {
  if (p >= 1000) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function PnlCell({ pnl, pct }: { pnl: number; pct: number }) {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prev = useRef(pnl);

  useEffect(() => {
    if (Math.abs(pnl - prev.current) > 0.01) {
      setFlash(pnl > prev.current ? "up" : "down");
      prev.current = pnl;
      const t = setTimeout(() => setFlash(null), 400);
      return () => clearTimeout(t);
    }
  }, [pnl]);

  const positive = pnl >= 0;
  return (
    <div className={cn("number-font font-semibold text-sm transition-colors duration-300",
      flash === "up" ? "text-emerald-300" : flash === "down" ? "text-red-300"
        : positive ? "text-emerald-400" : "text-red-400"
    )}>
      {positive ? "+" : ""}${Math.abs(pnl).toFixed(2)}
      <span className="ml-2 text-[10px] opacity-70">{positive ? "+" : ""}{pct.toFixed(2)}%</span>
    </div>
  );
}

function PositionRow({ pos, onClose }: { pos: LivePosition; onClose: (id: string) => void }) {
  const isLong = pos.side === "long";
  return (
    <tr className="hover:bg-slate-800/30 transition-colors">
      <td className="py-3.5 font-mono font-medium text-slate-100">{pos.symbol}</td>
      <td className="py-3.5">
        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
          isLong ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>
          {pos.side}
        </span>
      </td>
      <td className="py-3.5 text-slate-300 number-font">${pos.size_usd.toLocaleString()}</td>
      <td className="py-3.5">
        <span className="text-[10px] text-slate-400 font-mono px-1.5 py-0.5 rounded bg-slate-800">{pos.leverage}×</span>
      </td>
      <td className="py-3.5 text-slate-400 number-font">${fmtPrice(pos.entry_price)}</td>
      <td className="py-3.5 text-slate-200 number-font">${fmtPrice(pos.current_price)}</td>
      <td className="py-3.5"><PnlCell pnl={pos.unrealized_pnl} pct={pos.unrealized_pnl_pct} /></td>
      <td className="py-3.5 text-[10px] text-slate-600 number-font">${fmtPrice(pos.liq_price)}</td>
      <td className="py-3.5">
        <button onClick={() => onClose(pos.id)}
          className="p-1 rounded hover:bg-red-500/20 text-slate-600 hover:text-red-400 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </td>
    </tr>
  );
}

export function PositionsTable() {
  const { livePositions, closePos, mounted } = usePaperTrading();

  if (!mounted) return null;

  if (livePositions.length === 0) {
    return (
      <div className="text-center py-8 text-xs text-slate-500">
        No open positions · Go to <span className="text-cyan-400">Markets</span> to open a paper trade
      </div>
    );
  }

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-sm min-w-[780px]">
        <thead>
          <tr className="border-b border-slate-800">
            {["Asset", "Side", "Size", "Lev", "Entry", "Current", "P&L", "Liq. Price", ""].map((h) => (
              <th key={h} className="pb-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {livePositions.map((p) => <PositionRow key={p.id} pos={p} onClose={closePos} />)}
        </tbody>
      </table>
    </div>
  );
}
