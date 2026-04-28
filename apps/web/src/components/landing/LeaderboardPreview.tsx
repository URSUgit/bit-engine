import Link from "next/link";
import { ArrowRight, TrendingUp, TrendingDown } from "lucide-react";

const traders = [
  { rank: 1, handle: "0xAlpha", address: "0x1a2b…3c4d", roi: "+312%", pnl: "+$84,200", sharpe: "3.8", win: "78%", trend: "up" },
  { rank: 2, handle: "defi_whale", address: "0x9f8e…7d6c", roi: "+248%", pnl: "+$61,040", sharpe: "3.1", win: "72%", trend: "up" },
  { rank: 3, handle: "polyking", address: "0x5e4f…1a0b", roi: "+191%", pnl: "+$47,750", sharpe: "2.9", win: "69%", trend: "up" },
  { rank: 4, handle: "sigma_trader", address: "0x3c2d…9e8f", roi: "+164%", pnl: "+$41,000", sharpe: "2.7", win: "71%", trend: "up" },
  { rank: 5, handle: "chainmaxi", address: "0x7b6a…5c4d", roi: "+138%", pnl: "+$34,500", sharpe: "2.4", win: "65%", trend: "down" },
];

export function LeaderboardPreview() {
  return (
    <section id="leaderboard" className="py-20 px-4 sm:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-end justify-between mb-10">
          <div>
            <h2 className="text-3xl sm:text-4xl font-bold text-zinc-50 mb-2">
              Verified On-Chain <span className="text-gradient-cyan">Leaderboard</span>
            </h2>
            <p className="text-zinc-400">Performance verified directly from blockchain state — no self-reporting.</p>
          </div>
          <Link
            href="/dashboard"
            className="hidden sm:flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            Full Leaderboard <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900">
                {["#", "Trader", "30d ROI", "30d P&L", "Sharpe", "Win Rate", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {traders.map((t) => (
                <tr key={t.rank} className="bg-zinc-950 hover:bg-zinc-900/50 transition-colors">
                  <td className="px-4 py-3.5 text-zinc-500 font-mono text-xs">{t.rank}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
                        {t.handle[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-zinc-200 font-medium">{t.handle}</p>
                        <p className="text-zinc-600 text-xs font-mono">{t.address}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 font-semibold text-green-400 number-font">{t.roi}</td>
                  <td className="px-4 py-3.5 text-green-400 number-font">{t.pnl}</td>
                  <td className="px-4 py-3.5 text-zinc-300 number-font">{t.sharpe}</td>
                  <td className="px-4 py-3.5 text-zinc-300 number-font">{t.win}</td>
                  <td className="px-4 py-3.5">
                    {t.trend === "up" ? (
                      <TrendingUp className="w-4 h-4 text-green-500" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-500" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 text-center sm:hidden">
          <Link href="/dashboard" className="text-sm text-cyan-400 hover:underline">
            See full leaderboard →
          </Link>
        </div>
      </div>
    </section>
  );
}
