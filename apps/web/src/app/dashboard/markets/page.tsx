"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Search, TrendingUp, TrendingDown } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AssetSparkline } from "@/components/markets/AssetSparkline";
import { api } from "@/lib/api";
import { mockAssets } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const categories = ["all", "perp", "spot", "prediction"] as const;

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}
function fmtVolume(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export default function MarketsPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("all");

  const { data: assets } = useQuery({
    queryKey: ["markets"],
    queryFn: () => api.markets.list(),
    initialData: mockAssets,
    staleTime: 15_000,
  });

  const filtered = useMemo(() => {
    return ((assets ?? []) as typeof mockAssets)
      .filter((a) => {
        if (search && !`${a.symbol} ${a.name}`.toLowerCase().includes(search.toLowerCase())) return false;
        if (category !== "all" && a.category !== category) return false;
        return true;
      });
  }, [assets, search, category]);

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Markets</h1>
          <p className="text-sm text-slate-400 mt-1">
            <span className="text-slate-200 font-semibold number-font">{filtered.length}</span> markets ·
            Hyperliquid · Polymarket · Drift
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 flex-1 min-w-[260px] max-w-md">
            <Search className="w-3.5 h-3.5 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search markets…"
              className="bg-transparent outline-none text-sm text-slate-200 placeholder:text-slate-600 w-full"
            />
          </div>
          <div className="flex gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  "px-3 py-1 text-xs font-semibold rounded transition-colors uppercase",
                  category === c ? "bg-slate-800 text-cyan-300" : "text-slate-500 hover:text-slate-300"
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="card-dark overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[920px]">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/40 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-3 text-left">Market</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-right">24h Change</th>
                  <th className="px-4 py-3 text-right">24h Volume</th>
                  <th className="px-4 py-3 text-right">Open Interest</th>
                  <th className="px-4 py-3 text-right">Funding</th>
                  <th className="px-4 py-3 text-center w-32">7d</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.map((a) => {
                  const positive = a.priceChange24hPct >= 0;
                  return (
                    <tr key={a.symbol} className="hover:bg-slate-900/40 transition-colors group cursor-pointer">
                      <td className="px-4 py-3.5">
                        <Link href={`/dashboard/markets/${a.symbol}`} className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700/50 flex items-center justify-center text-[11px] font-bold text-slate-200 shrink-0">
                            {a.symbol.slice(0, 3)}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-100 group-hover:text-cyan-300 transition-colors">
                              {a.symbol}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {a.name} · <span className="capitalize text-slate-600">{a.protocol}</span>
                            </p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-100 number-font font-semibold">${fmtPrice(a.price)}</td>
                      <td className="px-4 py-3.5 text-right">
                        <span className={cn("number-font font-semibold inline-flex items-center gap-1", positive ? "text-emerald-400" : "text-red-400")}>
                          {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {positive ? "+" : ""}{a.priceChange24hPct.toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-300 number-font">{fmtVolume(a.volume24hUsd)}</td>
                      <td className="px-4 py-3.5 text-right text-slate-400 number-font">
                        {a.openInterestUsd ? fmtVolume(a.openInterestUsd) : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-400 number-font">
                        {a.fundingRate !== undefined
                          ? <span className={a.fundingRate >= 0 ? "text-emerald-400/80" : "text-red-400/80"}>{(a.fundingRate * 100).toFixed(3)}%</span>
                          : "—"}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-center">
                          <AssetSparkline data={a.sparkline} positive={positive} width={120} height={32} />
                        </div>
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
