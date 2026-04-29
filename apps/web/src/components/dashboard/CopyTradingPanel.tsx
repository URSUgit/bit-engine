"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface FollowedTrader {
  id: string;
  handle: string;
  avatar: string;
  color: string;
  pnl30d: number;
  winRate: number;
  allocation: number;
  copies: number;
  active: boolean;
}

const initial: FollowedTrader[] = [
  { id: "1", handle: "0xAlpha.eth",    avatar: "0",  color: "from-cyan-500 to-blue-600",     pnl30d: 312.4, winRate: 78.4, allocation: 8000, copies: 142, active: true },
  { id: "2", handle: "defiwhale",      avatar: "D",  color: "from-violet-500 to-purple-600", pnl30d: 248.1, winRate: 71.8, allocation: 5000, copies: 96,  active: true },
  { id: "3", handle: "polyking",       avatar: "P",  color: "from-emerald-500 to-teal-600",  pnl30d: 191.2, winRate: 69.2, allocation: 3500, copies: 78,  active: true },
  { id: "4", handle: "sigmatrade.eth", avatar: "S",  color: "from-amber-500 to-orange-600",  pnl30d: 164.0, winRate: 73.1, allocation: 2000, copies: 54,  active: false },
  { id: "5", handle: "chainmaxi",      avatar: "C",  color: "from-pink-500 to-rose-600",     pnl30d: -8.3,  winRate: 52.1, allocation: 1500, copies: 41,  active: false },
];

export function CopyTradingPanel() {
  const [traders, setTraders] = useState(initial);

  const toggle = (id: string) =>
    setTraders((prev) => prev.map((t) => (t.id === id ? { ...t, active: !t.active } : t)));

  const totalAllocation = traders.filter((t) => t.active).reduce((sum, t) => sum + t.allocation, 0);
  const activeCount = traders.filter((t) => t.active).length;

  return (
    <div className="card-dark">
      <div className="flex items-center justify-between p-4 border-b border-slate-800">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Copy Trading</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            <span className="text-slate-300 font-semibold">{activeCount}</span> active ·{" "}
            <span className="text-slate-300 font-semibold number-font">${totalAllocation.toLocaleString()}</span> allocated
          </p>
        </div>
        <button className="text-xs font-semibold text-cyan-400 hover:text-cyan-300">+ Add Trader</button>
      </div>

      <div className="divide-y divide-slate-800/60">
        {traders.map((t) => {
          const isProfit = t.pnl30d >= 0;
          return (
            <div key={t.id} className="flex items-center gap-3 p-3.5 hover:bg-slate-900/40 transition-colors">
              <div className={cn("w-9 h-9 rounded-full bg-gradient-to-br flex items-center justify-center text-xs font-bold text-white shrink-0", t.color)}>
                {t.avatar}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-semibold text-slate-100 truncate">{t.handle}</p>
                  {t.active && (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-soft" />
                      LIVE
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span className={cn("flex items-center gap-0.5 number-font font-semibold", isProfit ? "text-emerald-400" : "text-red-400")}>
                    {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {isProfit ? "+" : ""}
                    {t.pnl30d.toFixed(1)}%
                  </span>
                  <span className="text-slate-700">·</span>
                  <span>WR {t.winRate.toFixed(1)}%</span>
                  <span className="text-slate-700">·</span>
                  <span className="number-font">${t.allocation.toLocaleString()}</span>
                </div>
              </div>

              <button
                onClick={() => toggle(t.id)}
                className={cn(
                  "relative w-9 h-5 rounded-full transition-colors shrink-0",
                  t.active ? "bg-cyan-500" : "bg-slate-700"
                )}
                aria-label={`Toggle copy ${t.handle}`}
              >
                <span
                  className={cn(
                    "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all",
                    t.active ? "left-[18px]" : "left-0.5"
                  )}
                />
              </button>

              <button className="w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors">
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
