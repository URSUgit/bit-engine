import { cn } from "@/lib/utils";

const positions = [
  { id: 1, asset: "ETH-USD",   side: "Long",  size: "$4,200",  leverage: "5x", entry: "3,420.00",  current: "3,612.50",  pnl: "+$192.50",   pct: "+5.63%",  protocol: "Hyperliquid" },
  { id: 2, asset: "BTC-USD",   side: "Long",  size: "$8,000",  leverage: "3x", entry: "68,200.00", current: "69,840.00", pnl: "+$1,640.00", pct: "+2.40%",  protocol: "Hyperliquid" },
  { id: 3, asset: "SOL-USD",   side: "Short", size: "$2,000",  leverage: "5x", entry: "182.40",    current: "178.20",    pnl: "+$84.00",    pct: "+2.30%",  protocol: "Hyperliquid" },
  { id: 4, asset: "TRUMP-2024",side: "Yes",   size: "$1,500",  leverage: "1x", entry: "0.42",      current: "0.51",      pnl: "+$135.00",   pct: "+21.4%",  protocol: "Polymarket" },
  { id: 5, asset: "ARB-USD",   side: "Long",  size: "$800",    leverage: "10x",entry: "1.24",      current: "1.19",      pnl: "-$40.00",    pct: "-4.03%",  protocol: "Hyperliquid" },
  { id: 6, asset: "DOGE-USD",  side: "Long",  size: "$600",    leverage: "5x", entry: "0.1820",    current: "0.1842",    pnl: "+$13.20",    pct: "+1.21%",  protocol: "Hyperliquid" },
  { id: 7, asset: "SUI-USD",   side: "Short", size: "$1,200",  leverage: "3x", entry: "1.31",      current: "1.28",      pnl: "+$36.00",    pct: "+2.29%",  protocol: "Drift" },
];

export function PositionsTable() {
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="border-b border-slate-800">
            {["Asset", "Side", "Size", "Lev", "Entry", "Current", "P&L", "Venue"].map((h) => (
              <th key={h} className="pb-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {positions.map((p) => {
            const isProfit = p.pnl.startsWith("+");
            const isLong = p.side === "Long" || p.side === "Yes";
            return (
              <tr key={p.id} className="hover:bg-slate-800/30 transition-colors">
                <td className="py-3.5 font-mono font-medium text-slate-100">{p.asset}</td>
                <td className="py-3.5">
                  <span
                    className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide",
                      isLong ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
                    )}
                  >
                    {p.side}
                  </span>
                </td>
                <td className="py-3.5 text-slate-300 number-font">{p.size}</td>
                <td className="py-3.5">
                  <span className="text-[10px] text-slate-400 font-mono px-1.5 py-0.5 rounded bg-slate-800">
                    {p.leverage}
                  </span>
                </td>
                <td className="py-3.5 text-slate-400 number-font">${p.entry}</td>
                <td className="py-3.5 text-slate-200 number-font">${p.current}</td>
                <td className="py-3.5">
                  <div className={cn("number-font font-semibold text-sm", isProfit ? "text-emerald-400" : "text-red-400")}>
                    {p.pnl}
                    <span className="ml-2 text-[10px] opacity-70 font-medium">{p.pct}</span>
                  </div>
                </td>
                <td className="py-3.5 text-xs text-slate-500">{p.protocol}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
