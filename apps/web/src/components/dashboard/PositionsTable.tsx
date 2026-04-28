import { cn } from "@/lib/utils";

const positions = [
  { id: 1, asset: "ETH-USD", side: "Long", size: "$4,200", entry: "$3,420.00", current: "$3,612.50", pnl: "+$192.50", pct: "+5.63%", protocol: "Hyperliquid" },
  { id: 2, asset: "BTC-USD", side: "Long", size: "$8,000", entry: "$68,200.00", current: "$69,840.00", pnl: "+$1,640.00", pct: "+2.40%", protocol: "Hyperliquid" },
  { id: 3, asset: "SOL-USD", side: "Short", size: "$2,000", entry: "$182.40", current: "$178.20", pnl: "+$84.00", pct: "+2.30%", protocol: "Hyperliquid" },
  { id: 4, asset: "TRUMP 2024", side: "Yes", size: "$1,500", entry: "$0.42", current: "$0.51", pnl: "+$135.00", pct: "+21.4%", protocol: "Polymarket" },
  { id: 5, asset: "ARB-USD", side: "Long", size: "$800", entry: "$1.24", current: "$1.19", pnl: "-$40.00", pct: "-4.03%", protocol: "Hyperliquid" },
];

export function PositionsTable() {
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-sm min-w-[600px]">
        <thead>
          <tr className="border-b border-zinc-800">
            {["Asset", "Side", "Size", "Entry", "Current", "P&L", "Protocol"].map((h) => (
              <th key={h} className="pb-2 text-left text-xs font-medium text-zinc-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {positions.map((p) => (
            <tr key={p.id} className="hover:bg-zinc-800/30 transition-colors">
              <td className="py-3 font-mono font-medium text-zinc-200">{p.asset}</td>
              <td className="py-3">
                <span
                  className={cn(
                    "text-xs font-semibold px-1.5 py-0.5 rounded",
                    p.side === "Long" || p.side === "Yes"
                      ? "bg-green-500/10 text-green-400"
                      : "bg-red-500/10 text-red-400"
                  )}
                >
                  {p.side}
                </span>
              </td>
              <td className="py-3 text-zinc-300 number-font">{p.size}</td>
              <td className="py-3 text-zinc-400 number-font">{p.entry}</td>
              <td className="py-3 text-zinc-300 number-font">{p.current}</td>
              <td className="py-3">
                <div className={cn("number-font text-sm", p.pnl.startsWith("+") ? "text-green-400" : "text-red-400")}>
                  {p.pnl}
                  <span className="ml-1 text-xs opacity-70">{p.pct}</span>
                </div>
              </td>
              <td className="py-3 text-xs text-zinc-500">{p.protocol}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
