"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Star, Bell, Trash2, TrendingUp, TrendingDown, X } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

interface CoinData {
  symbol: string;
  name: string;
  price_usd: number;
  change_24h_pct: number;
  change_7d_pct: number;
  volume_24h_usd: number;
  market_cap_usd: number;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

const STORAGE_KEY = "bitprivat_watchlists";

function loadLists(): Watchlist[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [
    { id: "w1", name: "Core Majors",    symbols: ["BTC", "ETH", "SOL"] },
    { id: "w2", name: "L2 Watch",       symbols: ["ARB", "OP", "MATIC"] },
    { id: "w3", name: "DeFi",           symbols: ["UNI", "LINK", "AVAX", "ATOM"] },
  ];
}

function saveLists(lists: Watchlist[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
}

// ─── Main ────────────────────────────────────────────────────────────────────

const ALL_CRYPTO = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "MATIC", "DOT", "LINK", "LTC", "ATOM", "UNI", "ARB", "OP"];

export default function WatchlistsPage() {
  const [lists, setLists] = useState<Watchlist[]>([]);
  const [activeId, setActiveId] = useState("");
  const [coins, setCoins] = useState<Record<string, CoinData>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const loaded = loadLists();
    setLists(loaded);
    if (loaded.length > 0) setActiveId(loaded[0].id);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && lists.length > 0) saveLists(lists);
  }, [lists, mounted]);

  const active = lists.find((l) => l.id === activeId);

  // Fetch real prices
  const fetchPrices = useCallback(async () => {
    const symbols = new Set<string>();
    for (const l of lists) for (const s of l.symbols) symbols.add(s);
    if (symbols.size === 0) return;
    try {
      const res = await fetch(`/api/market/crypto?symbols=${[...symbols].join(",")}`);
      const env = await res.json();
      if (env.data && Array.isArray(env.data)) {
        const map: Record<string, CoinData> = {};
        for (const c of env.data) {
          const sym = (c.symbol ?? "").toUpperCase();
          map[sym] = {
            symbol: sym,
            name: c.name ?? sym,
            price_usd: c.price_usd ?? 0,
            change_24h_pct: c.change_24h_pct ?? 0,
            change_7d_pct: c.change_7d_pct ?? 0,
            volume_24h_usd: c.volume_24h_usd ?? 0,
            market_cap_usd: c.market_cap_usd ?? 0,
          };
        }
        setCoins(map);
      }
    } catch { /* silent */ }
  }, [lists]);

  useEffect(() => {
    fetchPrices();
    const id = setInterval(fetchPrices, 30_000);
    return () => clearInterval(id);
  }, [fetchPrices]);

  function createList(name: string) {
    const newList: Watchlist = { id: `w${Date.now()}`, name, symbols: [] };
    setLists((prev) => [...prev, newList]);
    setActiveId(newList.id);
    setShowCreate(false);
  }

  function deleteList(id: string) {
    setLists((prev) => {
      const next = prev.filter((l) => l.id !== id);
      if (activeId === id && next.length > 0) setActiveId(next[0].id);
      return next;
    });
  }

  function addSymbol(sym: string) {
    if (!active) return;
    setLists((prev) => prev.map((l) =>
      l.id === active.id && !l.symbols.includes(sym)
        ? { ...l, symbols: [...l.symbols, sym] }
        : l
    ));
    setShowAdd(false);
  }

  function removeSymbol(sym: string) {
    if (!active) return;
    setLists((prev) => prev.map((l) =>
      l.id === active.id ? { ...l, symbols: l.symbols.filter((s) => s !== sym) } : l
    ));
  }

  if (!mounted) return null;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Watchlists</h1>
            <p className="text-sm text-slate-400 mt-1">Track crypto with real-time CoinGecko prices</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-semibold hover:bg-cyan-400 transition-colors">
            <Plus className="w-4 h-4" /> New List
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          <div className="card-dark p-2">
            {lists.map((l) => {
              const isActive = l.id === activeId;
              return (
                <button key={l.id} onClick={() => setActiveId(l.id)}
                  className={cn("w-full text-left flex items-center gap-3 p-3 rounded-lg transition-colors",
                    isActive ? "bg-cyan-500/10 border border-cyan-500/30" : "hover:bg-slate-900 border border-transparent")}>
                  <Star className={cn("w-4 h-4 shrink-0", isActive ? "text-cyan-400 fill-cyan-400/40" : "text-slate-500")} />
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-semibold truncate", isActive ? "text-cyan-200" : "text-slate-100")}>{l.name}</p>
                    <p className="text-[11px] text-slate-500">{l.symbols.length} assets</p>
                  </div>
                </button>
              );
            })}
          </div>

          {active && (
            <div className="card-dark overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
                <div>
                  <h2 className="text-base font-bold text-slate-50">{active.name}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">{active.symbols.length} assets</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowAdd(true)} className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors flex items-center gap-1.5">
                    <Plus className="w-3 h-3" /> Add Asset
                  </button>
                  <button onClick={() => deleteList(active.id)} className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors flex items-center gap-1.5">
                    <Trash2 className="w-3 h-3" /> Delete
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
                      <th className="px-4 py-3 text-right">7d</th>
                      <th className="px-4 py-3 text-right">Market Cap</th>
                      <th className="px-4 py-3 text-right">Volume</th>
                      <th className="px-4 py-3 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {active.symbols.map((sym) => {
                      const c = coins[sym];
                      const price = c?.price_usd ?? 0;
                      const change24 = c?.change_24h_pct ?? 0;
                      const change7d = c?.change_7d_pct ?? 0;
                      const positive24 = change24 >= 0;
                      const positive7d = change7d >= 0;
                      return (
                        <tr key={sym} className="hover:bg-slate-900/40 transition-colors">
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700/50 flex items-center justify-center text-[10px] font-bold text-slate-200">
                                {sym.slice(0, 3)}
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-slate-100">{sym}</p>
                                <p className="text-[11px] text-slate-500">{c?.name ?? sym}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-right text-slate-100 number-font font-semibold">
                            {price > 0 ? `$${price >= 1 ? price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : price.toFixed(6)}` : "—"}
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <span className={cn("number-font font-semibold inline-flex items-center gap-1", positive24 ? "text-emerald-400" : "text-red-400")}>
                              {positive24 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {positive24 ? "+" : ""}{change24.toFixed(2)}%
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <span className={cn("number-font text-sm", positive7d ? "text-emerald-400" : "text-red-400")}>
                              {positive7d ? "+" : ""}{change7d.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right text-slate-400 number-font">
                            {c ? fmtCap(c.market_cap_usd) : "—"}
                          </td>
                          <td className="px-4 py-3.5 text-right text-slate-400 number-font">
                            {c ? fmtCap(c.volume_24h_usd) : "—"}
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <button onClick={() => removeSymbol(sym)} className="text-slate-500 hover:text-red-400 transition-colors">
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

      {showCreate && (
        <Dialog title="New watchlist" onClose={() => setShowCreate(false)}>
          <NameInput onSubmit={createList} placeholder="Watchlist name" cta="Create" />
        </Dialog>
      )}

      {showAdd && active && (
        <Dialog title={`Add to ${active.name}`} onClose={() => setShowAdd(false)}>
          <div className="grid grid-cols-4 gap-2">
            {ALL_CRYPTO.filter((s) => !active.symbols.includes(s)).map((s) => (
              <button key={s} onClick={() => addSymbol(s)}
                className="text-sm font-medium px-3 py-2 rounded-lg bg-slate-800 text-slate-200 hover:bg-cyan-500/20 hover:text-cyan-300 transition-colors">
                {s}
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </DashboardLayout>
  );
}

function fmtCap(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-100">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NameInput({ onSubmit, placeholder, cta }: { onSubmit: (v: string) => void; placeholder: string; cta: string }) {
  const [v, setV] = useState("");
  return (
    <div className="flex gap-2">
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder}
        className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500" />
      <button disabled={!v.trim()} onClick={() => onSubmit(v.trim())}
        className="px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 font-semibold text-sm hover:bg-cyan-400 disabled:opacity-40 transition-colors">
        {cta}
      </button>
    </div>
  );
}
