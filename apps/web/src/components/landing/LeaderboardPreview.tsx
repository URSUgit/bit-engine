"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, TrendingUp, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Trader {
  rank: number;
  handle: string;
  address: string;
  winRate: number;
  pnl: string;
  pnlValue: number;
  followers: number;
  badge?: "verified" | "elite";
  avatarColor: string;
}

const traders: Trader[] = [
  { rank: 1, handle: "0xAlpha.eth", address: "0x1a2b…3c4d", winRate: 78.4, pnl: "+$842,210", pnlValue: 842210, followers: 4821, badge: "elite", avatarColor: "from-cyan-500 to-blue-600" },
  { rank: 2, handle: "defiwhale", address: "0x9f8e…7d6c", winRate: 71.8, pnl: "+$610,400", pnlValue: 610400, followers: 3914, badge: "verified", avatarColor: "from-violet-500 to-purple-600" },
  { rank: 3, handle: "polyking",  address: "0x5e4f…1a0b", winRate: 69.2, pnl: "+$477,500", pnlValue: 477500, followers: 2876, badge: "verified", avatarColor: "from-emerald-500 to-teal-600" },
  { rank: 4, handle: "sigmatrade.eth", address: "0x3c2d…9e8f", winRate: 73.1, pnl: "+$410,000", pnlValue: 410000, followers: 2143, badge: "verified", avatarColor: "from-amber-500 to-orange-600" },
  { rank: 5, handle: "chainmaxi", address: "0x7b6a…5c4d", winRate: 65.7, pnl: "+$345,000", pnlValue: 345000, followers: 1789, avatarColor: "from-pink-500 to-rose-600" },
];

export function LeaderboardPreview() {
  const [following, setFollowing] = useState<Set<string>>(new Set());

  const toggle = (handle: string) =>
    setFollowing((s) => {
      const next = new Set(s);
      if (next.has(handle)) next.delete(handle); else next.add(handle);
      return next;
    });

  return (
    <section id="leaderboard" className="relative py-24 px-4 sm:px-8 border-t border-slate-800/60">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-end justify-between mb-12 flex-wrap gap-4">
          <div>
            <p className="text-cyan-400 text-xs font-bold uppercase tracking-[0.2em] mb-3">Leaderboard</p>
            <h2 className="text-3xl sm:text-5xl font-bold text-slate-50 mb-3 tracking-tight">
              Top 5 traders <span className="text-gradient-static">this week</span>
            </h2>
            <p className="text-slate-400">Verified on-chain — no self-reporting, no manipulated stats.</p>
          </div>
          <Link
            href="/dashboard/leaderboard"
            className="hidden sm:flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300 transition-colors group"
          >
            Full Leaderboard
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>

        <div className="card-dark overflow-hidden">
          <div className="grid grid-cols-[40px_2fr_1fr_1fr_1fr_auto] gap-4 px-5 py-3 border-b border-slate-800 bg-slate-900/40 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <div>#</div>
            <div>Trader</div>
            <div className="text-right">Win Rate</div>
            <div className="text-right">30d P&L</div>
            <div className="text-right hidden sm:block">Followers</div>
            <div className="w-24"></div>
          </div>

          <div className="divide-y divide-slate-800/60">
            {traders.map((t) => {
              const isFollowing = following.has(t.handle);
              return (
                <div
                  key={t.handle}
                  className="grid grid-cols-[40px_2fr_1fr_1fr_1fr_auto] gap-4 px-5 py-4 items-center hover:bg-slate-900/40 transition-colors"
                >
                  <div className="text-slate-500 number-font font-mono text-sm">{t.rank}</div>

                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn("w-9 h-9 rounded-full bg-gradient-to-br flex items-center justify-center text-xs font-bold text-white shrink-0", t.avatarColor)}>
                      {t.handle[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-slate-100 truncate">{t.handle}</p>
                        {t.badge === "elite" && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950">
                            ELITE
                          </span>
                        )}
                        {t.badge === "verified" && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400">
                            ✓
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 font-mono truncate">{t.address}</p>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-sm font-semibold text-slate-200 number-font">{t.winRate.toFixed(1)}%</div>
                    <div className="hidden sm:block w-full h-1 bg-slate-800 rounded-full mt-1 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-500 to-blue-500"
                        style={{ width: `${t.winRate}%` }}
                      />
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-sm font-bold text-emerald-400 number-font flex items-center justify-end gap-1">
                      <TrendingUp className="w-3 h-3" />
                      {t.pnl}
                    </div>
                  </div>

                  <div className="text-right text-sm text-slate-400 number-font hidden sm:block">
                    {t.followers.toLocaleString()}
                  </div>

                  <button
                    onClick={() => toggle(t.handle)}
                    className={cn(
                      "h-8 px-3 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 w-24 justify-center",
                      isFollowing
                        ? "bg-slate-800 text-slate-300 border border-slate-700 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30"
                        : "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                    )}
                  >
                    {isFollowing ? (
                      <>
                        <Check className="w-3 h-3" />
                        Following
                      </>
                    ) : (
                      "+ Follow"
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-6 text-center sm:hidden">
          <Link href="/dashboard/leaderboard" className="text-sm text-cyan-400 hover:underline">
            See full leaderboard →
          </Link>
        </div>
      </div>
    </section>
  );
}
