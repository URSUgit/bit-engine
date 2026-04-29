import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Pause } from "lucide-react";

interface SignalRow {
  id: number;
  asset: string;
  direction: "BUY" | "SELL" | "HOLD";
  confidence: number;
  source: string;
  trader?: { handle: string; color: string };
  time: string;
}

const signals: SignalRow[] = [
  { id: 1, asset: "ETH",  direction: "BUY",  confidence: 92, source: "FinBERT",  trader: { handle: "0xAlpha.eth",   color: "from-cyan-500 to-blue-600" },     time: "12s ago" },
  { id: 2, asset: "SOL",  direction: "BUY",  confidence: 88, source: "Twitter",  trader: { handle: "polyking",      color: "from-emerald-500 to-teal-600" },  time: "2m ago" },
  { id: 3, asset: "BTC",  direction: "HOLD", confidence: 71, source: "On-Chain",                                                                            time: "5m ago" },
  { id: 4, asset: "ARB",  direction: "SELL", confidence: 79, source: "FinBERT",  trader: { handle: "defiwhale",     color: "from-violet-500 to-purple-600" }, time: "8m ago" },
  { id: 5, asset: "DOGE", direction: "BUY",  confidence: 61, source: "Reddit",                                                                              time: "14m ago" },
  { id: 6, asset: "TIA",  direction: "BUY",  confidence: 84, source: "Whale Alert", trader: { handle: "sigmatrade", color: "from-amber-500 to-orange-600" }, time: "21m ago" },
];

const directionConfig = {
  BUY:  { color: "text-emerald-400", bg: "bg-emerald-500/15", icon: ArrowUpRight },
  SELL: { color: "text-red-400",     bg: "bg-red-500/15",     icon: ArrowDownRight },
  HOLD: { color: "text-amber-400",   bg: "bg-amber-500/15",   icon: Pause },
};

export function SignalsFeed() {
  return (
    <div className="flex flex-col gap-1.5">
      {signals.map((s) => {
        const cfg = directionConfig[s.direction];
        const DirIcon = cfg.icon;
        return (
          <div
            key={s.id}
            className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-900/40 hover:bg-slate-800/60 transition-colors group cursor-pointer"
          >
            <div className="w-9 h-9 rounded-lg bg-slate-800 border border-slate-700/50 flex items-center justify-center text-xs font-bold text-slate-200 shrink-0">
              {s.asset.slice(0, 3)}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-semibold text-slate-100">{s.asset}</span>
                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5", cfg.bg, cfg.color)}>
                  <DirIcon className="w-2.5 h-2.5" />
                  {s.direction}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span>{s.source}</span>
                {s.trader && (
                  <>
                    <span className="text-slate-700">·</span>
                    <div className={cn("w-3 h-3 rounded-full bg-gradient-to-br shrink-0", s.trader.color)} />
                    <span className="truncate">{s.trader.handle}</span>
                  </>
                )}
                <span className="text-slate-700">·</span>
                <span>{s.time}</span>
              </div>
            </div>

            <div className="text-right shrink-0">
              <div
                className={cn(
                  "text-sm font-bold number-font",
                  s.confidence >= 85 ? "text-cyan-400" : s.confidence >= 70 ? "text-slate-200" : "text-slate-500"
                )}
              >
                {s.confidence}%
              </div>
              <p className="text-[10px] text-slate-600 uppercase tracking-wider">conf.</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
