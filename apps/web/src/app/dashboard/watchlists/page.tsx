"use client";

import { useState } from "react";
import { Plus, Star, Bell, Trash2, TrendingUp, TrendingDown } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AssetSparkline } from "@/components/markets/AssetSparkline";
import { mockAssets } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
  alerts: number;
}

const initialLists: Watchlist[] = [
  { id: "w1", name: "Core Majors",   symbols: ["BTC", "ETH", "SOL"],          alerts: 3 },
  { id: "w2", name: "L2 Watch",      symbols: ["ARB", "OP"],                  alerts: 1 },
  { id: "w3", name: "Narrative Plays", symbols: ["TIA", "SUI", "INJ", "RNDR"], alerts: 5 },
  { id: "w4", name: "Polymarket",    symbols: ["TRUMP-2024", "FED-CUT-MAR", "BTC-100K-EOY"], alerts: 0 },
];

export default function WatchlistsPage() {
  const [lists] = useState(initialLists);
  const [activeId, setActiveId] = useState(lists[0]!.id);
  const active = lists.find((l) => l.id === activeId);
  const assetsInList = active ? mockAssets.filter((a) => active.symbols.includes(a.symbol)) : [];

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Watchlists</h1>
            <p className="text-sm text-slate-400 mt-1">Track sets of assets and configure price alerts</p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors">
            <Plus className="w-4 h-4" /> New List
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          <div className="card-dark p-2">
            {lists.map((l) => {
              const isActive = l.id === activeId;
              return (
                <button
                  key={l.id}
                  onClick={() => setActiveId(l.id)}
                  className={cn(
                    "w-full text-left flex items-center gap-3 p-3 rounded-lg transition-colors",
                    isActive ? "bg-cyan-500/10 border border-cyan-500/30" : "hover:bg-slate-900 border border-transparent"
                  )}
                >
                  <Star className={cn("w-4 h-4 shrink-0", isActive ? "text-cyan-400 fill-cyan-400/40" : "text-slate-500")} />
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-semibold truncate", isActive ? "text-cyan-200" : "text-slate-100")}>{l.name}</p>
                    <p className="text-[11px] text-slate-500">{l.symbols.length} assets</p>
                  </div>
                  {l.alerts > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 flex items-center gap-1">
                      <Bell className="w-2.5 h-2.5" />{l.alerts}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {active && (
            <div className="card-dark overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
                <div>
                  <h2 className="text-base font-bold text-slate-50">{active.name}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">{active.symbols.length} assets · {active.alerts} alerts active</p>
                </div>
                <div className="flex gap-2">
                  <button className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors flex items-center gap-1.5">
                    <Bell className="w-3 h-3" /> Add Alert
                  </button>
                  <button className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors flex items-center gap-1.5">
                    <Trash2 className="w-3 h-3" /> Delete List
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/40 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      <th className="px-4 py-3 text-left">Asset</th>
                      <th className="px-4 py-3 text-right">Price</th>
                      <th className="px-4 py-3 text-right">24h</th>
                      <th className="px-4 py-3 text-right">Volume</th>
                      <th className="px-4 py-3 text-center w-32">7d</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {assetsInList.map((a) => {
                      const positive = a.priceChange24hPct >= 0;
                      return (
                        <tr key={a.symbol} className="hover:bg-slate-900/40 transition-colors">
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700/50 flex items-center justify-center text-[10px] font-bold text-slate-200">
                                {a.symbol.slice(0, 3)}
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-slate-100">{a.symbol}</p>
                                <p className="text-[11px] text-slate-500">{a.name}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-right text-slate-100 number-font font-semibold">
                            ${a.price >= 1 ? a.price.toFixed(2) : a.price.toFixed(4)}
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <span className={cn("number-font font-semibold inline-flex items-center gap-1 text-sm", positive ? "text-emerald-400" : "text-red-400")}>
                              {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {positive ? "+" : ""}{a.priceChange24hPct.toFixed(2)}%
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right text-slate-400 number-font">
                            ${(a.volume24hUsd / 1e6).toFixed(1)}M
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex items-center justify-center">
                              <AssetSparkline data={a.sparkline} positive={positive} width={120} height={32} />
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <button className="text-slate-500 hover:text-red-400 transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
