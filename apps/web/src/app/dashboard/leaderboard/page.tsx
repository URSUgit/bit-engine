"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Search, ArrowUpDown, Check } from "lucide-react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { mockTraders } from "@/lib/mock-data";

type SortKey = "roi30d" | "roi90d" | "sharpe" | "winRate" | "drawdown" | "followers";

const protocolFilters = ["all", "hyperliquid", "polymarket", "drift", "gmx", "aevo"] as const;
const riskFilters = ["all", "low", "medium", "high"] as const;
const periodFilters = ["7d", "30d", "90d", "all"] as const;

export default function LeaderboardPage() {
  const [search, setSearch] = useState("");
  const [protocol, setProtocol] = useState<(typeof protocolFilters)[number]>("all");
  const [risk, setRisk] = useState<(typeof riskFilters)[number]>("all");
  const [period, setPeriod] = useState<(typeof periodFilters)[number]>("30d");
  const [sortKey, setSortKey] = useState<SortKey>("roi30d");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [following, setFollowing] = useState<Set<string>>(new Set(["trader-1", "trader-2", "trader-3"]));

  const { data: traders } = useQuery({
    queryKey: ["traders", "leaderboard", period],
    queryFn: () => api.traders.leaderboard(period === "all" ? "30d" : (period as "7d" | "30d" | "90d")),
    initialData: mockTraders,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const list = (traders ?? []) as typeof mockTraders;
    return list
      .filter((t) => {
        if (search && !t.handle?.toLowerCase().includes(search.toLowerCase())) return false;
        if (protocol !== "all" && !t.protocols.includes(protocol)) return false;
        if (risk !== "all" && t.riskLevel !== risk) return false;
        return true;
      })
      .sort((a, b) => {
        const av =
          sortKey === "roi30d"   ? a.stats?.roi30d ?? 0 :
          sortKey === "roi90d"   ? a.stats?.roi90d ?? 0 :
          sortKey === "sharpe"   ? a.stats?.sharpeRatio ?? 0 :
          sortKey === "winRate"  ? a.stats?.winRatePct ?? 0 :
          sortKey === "drawdown" ? -(a.stats?.maxDrawdownPct ?? 0) :
                                    a.followerCount;
        const bv =
          sortKey === "roi30d"   ? b.stats?.roi30d ?? 0 :
          sortKey === "roi90d"   ? b.stats?.roi90d ?? 0 :
          sortKey === "sharpe"   ? b.stats?.sharpeRatio ?? 0 :
          sortKey === "winRate"  ? b.stats?.winRatePct ?? 0 :
          sortKey === "drawdown" ? -(b.stats?.maxDrawdownPct ?? 0) :
                                    b.followerCount;
        return sortDir === "desc" ? bv - av : av - bv;
      });
  }, [traders, search, protocol, risk, sortKey, sortDir]);

  const toggleFollow = (id: string) =>
    setFollowing((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const setSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Trader Leaderboard</h1>
            <p className="text-sm text-slate-400 mt-1">
              <span className="text-slate-200 font-semibold number-font">{filtered.length}</span> verified
              on-chain traders · sorted by {sortKey} ({sortDir})
            </p>
          </div>
          <div className="flex gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
            {periodFilters.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "px-3 py-1 text-xs font-semibold rounded transition-colors uppercase tracking-wide",
                  period === p ? "bg-slate-800 text-cyan-300" : "text-slate-500 hover:text-slate-300"
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 flex-1 min-w-[260px] max-w-md">
            <Search className="w-3.5 h-3.5 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search traders…"
              className="bg-transparent outline-none text-sm text-slate-200 placeholder:text-slate-600 w-full"
            />
          </div>

          <FilterChips label="Protocol" options={protocolFilters as readonly string[]} value={protocol} onChange={(v) => setProtocol(v as typeof protocol)} />
          <FilterChips label="Risk"     options={riskFilters as readonly string[]}     value={risk}     onChange={(v) => setRisk(v as typeof risk)} />
        </div>

        <div className="card-dark overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/40 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-3 text-left w-12">#</th>
                  <th className="px-4 py-3 text-left">Trader</th>
                  <SortHeader label="ROI 30d"  k="roi30d"   active={sortKey} dir={sortDir} onClick={setSort} />
                  <SortHeader label="ROI 90d"  k="roi90d"   active={sortKey} dir={sortDir} onClick={setSort} />
                  <SortHeader label="Sharpe"   k="sharpe"   active={sortKey} dir={sortDir} onClick={setSort} />
                  <SortHeader label="Win Rate" k="winRate"  active={sortKey} dir={sortDir} onClick={setSort} />
                  <SortHeader label="Max DD"   k="drawdown" active={sortKey} dir={sortDir} onClick={setSort} />
                  <SortHeader label="Followers" k="followers" active={sortKey} dir={sortDir} onClick={setSort} />
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.map((t, idx) => {
                  const isFollowing = following.has(t.id);
                  const roi30d = t.stats?.roi30d ?? 0;
                  return (
                    <tr key={t.id} className="hover:bg-slate-900/40 transition-colors">
                      <td className="px-4 py-3.5 text-slate-500 number-font">{idx + 1}</td>
                      <td className="px-4 py-3.5">
                        <Link href={`/dashboard/leaderboard/${t.id}`} className="flex items-center gap-3 min-w-0 group">
                          <div className={cn("w-9 h-9 rounded-full bg-gradient-to-br flex items-center justify-center text-xs font-bold text-white shrink-0", t.avatarColor)}>
                            {(t.handle?.[0] ?? "?").toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-semibold text-slate-100 group-hover:text-cyan-300 transition-colors truncate">
                                {t.handle}
                              </p>
                              {t.badge === "elite" && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950">ELITE</span>
                              )}
                              {t.badge === "verified" && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400">✓</span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 font-mono truncate">{t.walletAddress.slice(0,8)}…{t.walletAddress.slice(-4)}</p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className={cn("number-font font-semibold inline-flex items-center gap-1", roi30d >= 0 ? "text-emerald-400" : "text-red-400")}>
                          {roi30d >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {roi30d >= 0 ? "+" : ""}{roi30d.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-300 number-font">
                        {(t.stats?.roi90d ?? 0) >= 0 ? "+" : ""}{(t.stats?.roi90d ?? 0).toFixed(0)}%
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-300 number-font">{(t.stats?.sharpeRatio ?? 0).toFixed(2)}</td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="text-slate-200 number-font">{(t.stats?.winRatePct ?? 0).toFixed(1)}%</div>
                        <div className="w-20 h-1 bg-slate-800 rounded-full mt-1 overflow-hidden ml-auto">
                          <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500" style={{ width: `${t.stats?.winRatePct ?? 0}%` }} />
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right text-red-400/80 number-font">-{(t.stats?.maxDrawdownPct ?? 0).toFixed(1)}%</td>
                      <td className="px-4 py-3.5 text-right text-slate-400 number-font">{t.followerCount.toLocaleString()}</td>
                      <td className="px-4 py-3.5 text-right">
                        <button
                          onClick={() => toggleFollow(t.id)}
                          className={cn(
                            "h-8 px-3 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ml-auto",
                            isFollowing
                              ? "bg-slate-800 text-slate-300 border border-slate-700 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30"
                              : "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                          )}
                        >
                          {isFollowing ? <><Check className="w-3 h-3" />Following</> : "+ Follow"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function FilterChips({ label, options, value, onChange }: { label: string; options: readonly string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</span>
      <div className="flex gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={cn(
              "px-2.5 py-1 text-xs font-semibold rounded transition-colors capitalize",
              value === o ? "bg-slate-800 text-cyan-300" : "text-slate-500 hover:text-slate-300"
            )}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function SortHeader({ label, k, active, dir, onClick }: { label: string; k: SortKey; active: SortKey; dir: "asc" | "desc"; onClick: (k: SortKey) => void }) {
  const isActive = active === k;
  return (
    <th className="px-4 py-3 text-right">
      <button onClick={() => onClick(k)} className={cn("inline-flex items-center gap-1 hover:text-slate-300 transition-colors", isActive && "text-cyan-400")}>
        {label}
        <ArrowUpDown className={cn("w-3 h-3", isActive ? "opacity-100" : "opacity-30")} />
        {isActive && <span className="text-[8px]">{dir === "desc" ? "↓" : "↑"}</span>}
      </button>
    </th>
  );
}
