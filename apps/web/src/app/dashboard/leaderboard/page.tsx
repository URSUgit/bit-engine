"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Search, ArrowUpDown, Check } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { TraderEntry } from "@/app/api/market/traders/route";

type SortKey = "roi_30d" | "roi_7d" | "win_rate" | "volume_30d" | "account_value";

const periodFilters = ["7d", "30d", "90d", "all"] as const;

interface TradersResponse {
  data?: TraderEntry[];
  source?: string;
}

export default function LeaderboardPage() {
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<(typeof periodFilters)[number]>("30d");
  const [sortKey, setSortKey] = useState<SortKey>("roi_30d");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [following, setFollowing] = useState<Set<string>>(new Set());

  const { data: response } = useQuery<TradersResponse>({
    queryKey: ["traders", "leaderboard"],
    queryFn: () =>
      fetch("/api/market/traders?limit=100")
        .then((r) => r.json())
        .then((d: TradersResponse) => d),
    staleTime: 300_000,
  });

  const traders: TraderEntry[] = response?.data ?? [];
  const isDemo = response?.source === "demo" || traders[0]?.source === "demo";

  const filtered = useMemo(() => {
    return traders
      .filter((t) => {
        if (search && !t.handle?.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => {
        const av = a[sortKey] ?? 0;
        const bv = b[sortKey] ?? 0;
        return sortDir === "desc" ? bv - av : av - bv;
      });
  }, [traders, search, sortKey, sortDir]);

  const toggleFollow = (addr: string) =>
    setFollowing((s) => {
      const n = new Set(s);
      n.has(addr) ? n.delete(addr) : n.add(addr);
      return n;
    });

  const setSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Trader Leaderboard</h1>
            {isDemo ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 uppercase tracking-wide">
                Demo data
              </span>
            ) : traders.length > 0 ? (
              <span className="flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 uppercase tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live · Hyperliquid
              </span>
            ) : null}
          </div>
          <p className="text-sm text-slate-400 mt-1">
            <span className="text-slate-200 font-semibold number-font">{filtered.length}</span> on-chain
            traders · sorted by {sortKey} ({sortDir})
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

      {/* Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 flex-1 min-w-[260px] max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by address…"
            className="bg-transparent outline-none text-sm text-slate-200 placeholder:text-slate-600 w-full"
          />
        </div>
      </div>

      <div className="card-dark overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/40 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                <th className="px-4 py-3 text-left w-12">#</th>
                <th className="px-4 py-3 text-left">Trader</th>
                <SortHeader label="ROI 30d"      k="roi_30d"       active={sortKey} dir={sortDir} onClick={setSort} />
                <SortHeader label="ROI 7d"       k="roi_7d"        active={sortKey} dir={sortDir} onClick={setSort} />
                <SortHeader label="Win Rate"     k="win_rate"      active={sortKey} dir={sortDir} onClick={setSort} />
                <SortHeader label="Volume 30d"   k="volume_30d"    active={sortKey} dir={sortDir} onClick={setSort} />
                <SortHeader label="Account Val"  k="account_value" active={sortKey} dir={sortDir} onClick={setSort} />
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map((t, idx) => {
                const isFollowing = following.has(t.address);
                const roi30d = t.roi_30d;
                return (
                  <tr key={t.address} className="hover:bg-slate-900/40 transition-colors">
                    <td className="px-4 py-3.5 text-slate-500 number-font">{idx + 1}</td>
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/dashboard/leaderboard/${encodeURIComponent(t.address)}`}
                        className="flex items-center gap-3 min-w-0 group"
                      >
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
                          {(t.handle?.[0] ?? "?").toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-100 group-hover:text-cyan-300 transition-colors truncate">
                            {t.handle}
                          </p>
                          <p className="text-[11px] text-slate-500 font-mono truncate">
                            {t.address.slice(0, 8)}…{t.address.slice(-4)}
                          </p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span
                        className={cn(
                          "number-font font-semibold inline-flex items-center gap-1",
                          roi30d >= 0 ? "text-emerald-400" : "text-red-400"
                        )}
                      >
                        {roi30d >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {roi30d >= 0 ? "+" : ""}{roi30d.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-300 number-font">
                      {t.roi_7d >= 0 ? "+" : ""}{t.roi_7d.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="text-slate-200 number-font">{t.win_rate.toFixed(1)}%</div>
                      <div className="w-20 h-1 bg-slate-800 rounded-full mt-1 overflow-hidden ml-auto">
                        <div
                          className="h-full bg-gradient-to-r from-cyan-500 to-blue-500"
                          style={{ width: `${t.win_rate}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-300 number-font">
                      ${(t.volume_30d / 1_000_000).toFixed(1)}M
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-300 number-font">
                      ${t.account_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <button
                        onClick={() => toggleFollow(t.address)}
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
  );
}

function SortHeader({
  label, k, active, dir, onClick,
}: {
  label: string;
  k: SortKey;
  active: SortKey;
  dir: "asc" | "desc";
  onClick: (k: SortKey) => void;
}) {
  const isActive = active === k;
  return (
    <th className="px-4 py-3 text-right">
      <button
        onClick={() => onClick(k)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-slate-300 transition-colors",
          isActive && "text-cyan-400"
        )}
      >
        {label}
        <ArrowUpDown className={cn("w-3 h-3", isActive ? "opacity-100" : "opacity-30")} />
        {isActive && <span className="text-[8px]">{dir === "desc" ? "↓" : "↑"}</span>}
      </button>
    </th>
  );
}
