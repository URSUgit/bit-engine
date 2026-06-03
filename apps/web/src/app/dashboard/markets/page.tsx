"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ArrowDownRight, Search, RefreshCw, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CryptoQuote } from "@/app/api/market/crypto/route";
import MomentumHeatmap from "./components/MomentumHeatmap";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(8);
}

function fmtLarge(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

// ── FlashPrice ─────────────────────────────────────────────────────────────────

function FlashPrice({ price, symbol }: { price: number; symbol: string }) {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prev = useRef(price);

  useEffect(() => {
    if (prev.current !== price) {
      setFlash(price > prev.current ? "up" : "down");
      prev.current = price;
      const t = setTimeout(() => setFlash(null), 500);
      return () => clearTimeout(t);
    }
  }, [price]);

  return (
    <span
      className={cn(
        "number-font font-semibold transition-colors duration-300",
        flash === "up" ? "text-emerald-400" : flash === "down" ? "text-red-400" : "text-slate-100"
      )}
      aria-label={`${symbol} price`}
    >
      ${fmtPrice(price)}
    </span>
  );
}

// ── InlineSparkline ────────────────────────────────────────────────────────────

function InlineSparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (!data || data.length < 2) {
    return <div className="w-20 h-7 flex items-center justify-center text-slate-700 text-xs">—</div>;
  }
  const width = 80;
  const height = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const path = data
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const stroke = positive ? "#34d399" : "#f87171";
  const areaPath = `${path} L${(data.length - 1) * stepX},${height} L0,${height} Z`;
  const fill = positive ? "rgba(52,211,153,0.10)" : "rgba(248,113,113,0.10)";

  return (
    <svg width={width} height={height} preserveAspectRatio="none" className="overflow-visible">
      <path d={areaPath} fill={fill} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── SkeletonRow ────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-slate-800/60">
      {[40, 140, 90, 70, 70, 90, 90, 80].map((w, i) => (
        <td key={i} className="px-4 py-3.5">
          <div
            className="h-4 rounded bg-slate-800 animate-pulse"
            style={{ width: w, marginLeft: i === 0 ? 0 : "auto" }}
          />
        </td>
      ))}
    </tr>
  );
}

// ── Sort helpers ───────────────────────────────────────────────────────────────

type SortKey = "rank" | "price_usd" | "change_24h_pct" | "change_7d_pct" | "market_cap_usd" | "volume_24h_usd";

function sortCoins(coins: CryptoQuote[], key: SortKey, dir: "asc" | "desc"): CryptoQuote[] {
  return [...coins].sort((a, b) => {
    const av = a[key] as number;
    const bv = b[key] as number;
    return dir === "asc" ? av - bv : bv - av;
  });
}

// ── Main Page ──────────────────────────────────────────────────────────────────

const TABS = ["Top 100", "Top 10"] as const;
type Tab = (typeof TABS)[number];

export default function MarketsPage() {
  const router = useRouter();
  const [coins, setCoins] = useState<CryptoQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("Top 100");
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchCoins = useCallback(async () => {
    try {
      const res = await fetch("/api/market/crypto");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { data: CryptoQuote[] | null; error?: string };
      if (json.data) {
        setCoins(json.data);
        setLastUpdated(new Date());
        setError(null);
      } else {
        setError(json.error ?? "Failed to load data");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCoins();
    const interval = setInterval(() => void fetchCoins(), 60_000);
    return () => clearInterval(interval);
  }, [fetchCoins]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "rank" ? "asc" : "desc");
    }
  };

  const filtered = (() => {
    let list = coins;
    if (tab === "Top 10") list = list.slice(0, 10);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q)
      );
    }
    return sortCoins(list, sortKey, sortDir);
  })();

  const SortHeader = ({
    label,
    colKey,
    align = "right",
  }: {
    label: string;
    colKey: SortKey;
    align?: "left" | "right";
  }) => (
    <th
      className={cn(
        "px-4 py-3 text-[10px] font-bold uppercase tracking-widest cursor-pointer select-none whitespace-nowrap",
        align === "right" ? "text-right" : "text-left",
        sortKey === colKey ? "text-cyan-400" : "text-slate-500 hover:text-slate-300"
      )}
      onClick={() => handleSort(colKey)}
    >
      {label}
      {sortKey === colKey && (
        <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
      )}
    </th>
  );

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
      {/* Page header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 tracking-tight">Markets</h1>
          <p className="text-sm text-slate-400 mt-1 flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
            Top 100 by market cap · Live from CoinGecko · updates every 60s
            {lastUpdated && (
              <span className="text-slate-600">
                · last updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); void fetchCoins(); }}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 flex-1 min-w-[260px] max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or symbol…"
            className="bg-transparent outline-none text-sm text-slate-200 placeholder:text-slate-600 w-full"
          />
        </div>
        <div className="flex gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-3 py-1 text-xs font-semibold rounded transition-colors",
                tab === t ? "bg-slate-800 text-cyan-300" : "text-slate-500 hover:text-slate-300"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && !loading && (
        <div className="card-dark p-6 text-center">
          <p className="text-red-400 font-medium">Failed to load market data</p>
          <p className="text-slate-500 text-sm mt-1">{error}</p>
          <button
            onClick={() => { setLoading(true); void fetchCoins(); }}
            className="mt-3 px-4 py-2 text-sm rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {/* Table */}
      {!error && (
        <div className="card-dark overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-slate-800 bg-slate-900/90 backdrop-blur">
                  <SortHeader label="#" colKey="rank" align="left" />
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Name
                  </th>
                  <SortHeader label="Price" colKey="price_usd" />
                  <SortHeader label="24h %" colKey="change_24h_pct" />
                  <SortHeader label="7d %" colKey="change_7d_pct" />
                  <SortHeader label="Market Cap" colKey="market_cap_usd" />
                  <SortHeader label="Volume 24h" colKey="volume_24h_usd" />
                  <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-slate-500 w-24">
                    7d Chart
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {loading
                  ? Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} />)
                  : filtered.map((coin) => {
                      const pos24h = coin.change_24h_pct >= 0;
                      const pos7d = coin.change_7d_pct >= 0;
                      return (
                        <tr
                          key={coin.symbol}
                          onClick={() => router.push(`/dashboard/markets/${coin.symbol}`)}
                          className="hover:bg-slate-900/50 transition-colors cursor-pointer group"
                        >
                          {/* Rank */}
                          <td className="px-4 py-3.5 text-slate-500 number-font text-xs w-10">
                            {coin.rank}
                          </td>

                          {/* Name + logo */}
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-3 min-w-0">
                              {coin.image ? (
                                <img
                                  src={coin.image}
                                  alt={coin.name}
                                  width={32}
                                  height={32}
                                  className="w-8 h-8 rounded-full shrink-0"
                                  onError={(e) => {
                                    const el = e.currentTarget;
                                    el.style.display = "none";
                                    const sibling = el.nextElementSibling as HTMLElement | null;
                                    if (sibling) sibling.style.display = "flex";
                                  }}
                                />
                              ) : null}
                              <div
                                className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-300 shrink-0"
                                style={{ display: coin.image ? "none" : "flex" }}
                              >
                                {coin.symbol.slice(0, 2)}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-100 group-hover:text-cyan-300 transition-colors truncate">
                                  {coin.name}
                                </p>
                                <p className="text-[11px] text-slate-500 uppercase">{coin.symbol}</p>
                              </div>
                            </div>
                          </td>

                          {/* Price */}
                          <td className="px-4 py-3.5 text-right">
                            <FlashPrice price={coin.price_usd} symbol={coin.symbol} />
                          </td>

                          {/* 24h % */}
                          <td className="px-4 py-3.5 text-right">
                            <span
                              className={cn(
                                "number-font font-semibold inline-flex items-center gap-0.5",
                                pos24h ? "text-emerald-400" : "text-red-400"
                              )}
                            >
                              {pos24h ? (
                                <ArrowUpRight className="w-3 h-3" />
                              ) : (
                                <ArrowDownRight className="w-3 h-3" />
                              )}
                              {pos24h ? "+" : ""}
                              {(coin.change_24h_pct ?? 0).toFixed(2)}%
                            </span>
                          </td>

                          {/* 7d % */}
                          <td className="px-4 py-3.5 text-right">
                            <span
                              className={cn(
                                "number-font font-semibold",
                                pos7d ? "text-emerald-400" : "text-red-400"
                              )}
                            >
                              {pos7d ? "+" : ""}
                              {(coin.change_7d_pct ?? 0).toFixed(2)}%
                            </span>
                          </td>

                          {/* Market Cap */}
                          <td className="px-4 py-3.5 text-right text-slate-300 number-font">
                            {fmtLarge(coin.market_cap_usd)}
                          </td>

                          {/* Volume 24h */}
                          <td className="px-4 py-3.5 text-right text-slate-400 number-font">
                            {fmtLarge(coin.volume_24h_usd)}
                          </td>

                          {/* 7d Sparkline */}
                          <td className="px-4 py-3.5">
                            <div className="flex items-center justify-center">
                              <InlineSparkline
                                data={coin.sparkline_7d}
                                positive={pos7d}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-slate-500 text-sm">
                      No coins match your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Momentum Heatmap */}
      <MomentumHeatmap />
    </div>
  );
}
