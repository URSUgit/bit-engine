import { cn } from "@/lib/utils";

const signals = [
  { asset: "ETH", direction: "BUY", confidence: 92, source: "FinBERT", time: "2m ago" },
  { asset: "BTC", direction: "HOLD", confidence: 71, source: "On-Chain", time: "5m ago" },
  { asset: "SOL", direction: "BUY", confidence: 88, source: "Twitter", time: "8m ago" },
  { asset: "ARB", direction: "SELL", confidence: 79, source: "FinBERT", time: "12m ago" },
  { asset: "DOGE", direction: "BUY", confidence: 61, source: "Reddit", time: "18m ago" },
];

export function SignalsFeed() {
  return (
    <div className="flex flex-col gap-2">
      {signals.map((s, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-2.5 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 transition-colors"
        >
          <div className="w-8 h-8 rounded-lg bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-200 shrink-0">
            {s.asset.slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-200">{s.asset}</span>
              <span
                className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded",
                  s.direction === "BUY" && "bg-green-500/15 text-green-400",
                  s.direction === "SELL" && "bg-red-500/15 text-red-400",
                  s.direction === "HOLD" && "bg-yellow-500/15 text-yellow-400"
                )}
              >
                {s.direction}
              </span>
            </div>
            <p className="text-xs text-zinc-500">
              {s.source} · {s.time}
            </p>
          </div>
          <div className="text-right shrink-0">
            <div
              className={cn(
                "text-sm font-bold number-font",
                s.confidence >= 85 ? "text-cyan-400" : s.confidence >= 70 ? "text-zinc-300" : "text-zinc-500"
              )}
            >
              {s.confidence}%
            </div>
            <p className="text-[10px] text-zinc-600">conf.</p>
          </div>
        </div>
      ))}
    </div>
  );
}
