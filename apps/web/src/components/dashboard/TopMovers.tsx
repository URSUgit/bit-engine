"use client";

import { useEffect, useState, useCallback } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CryptoQuote } from "@/app/api/market/crypto/route";

const SYMBOLS = "BTC,ETH,SOL,BNB,XRP,ADA,DOGE,AVAX,DOT,MATIC,LINK,LTC";

function SkeletonRow() {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="w-5 h-5 rounded-full bg-slate-800 animate-pulse shrink-0" />
      <div className="h-3 w-10 rounded bg-slate-800 animate-pulse" />
      <div className="ml-auto h-3 w-14 rounded bg-slate-800 animate-pulse" />
      <div className="h-4 w-12 rounded bg-slate-800 animate-pulse" />
    </div>
  );
}

function CoinRow({ coin }: { coin: CryptoQuote }) {
  const pos = coin.change_24h_pct >= 0;
  return (
    <div className="flex items-center gap-2 py-1.5">
      {coin.image ? (
        <img src={coin.image} alt={coin.symbol} width={20} height={20} className="w-5 h-5 rounded-full shrink-0" />
      ) : (
        <div className="w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center text-[9px] font-bold text-slate-300 shrink-0">
          {coin.symbol.slice(0, 2)}
        </div>
      )}
      <span className="text-xs font-semibold text-slate-300 w-10 truncate">{coin.symbol}</span>
      <span className="ml-auto text-xs font-medium text-slate-400 number-font">
        ${coin.price_usd >= 1000
          ? coin.price_usd.toLocaleString("en-US", { maximumFractionDigits: 0 })
          : coin.price_usd >= 1
          ? coin.price_usd.toFixed(2)
          : coin.price_usd.toFixed(4)}
      </span>
      <span
        className={cn(
          "text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 number-font",
          pos ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
        )}
      >
        {pos ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
        {pos ? "+" : ""}{coin.change_24h_pct.toFixed(2)}%
      </span>
    </div>
  );
}

export function TopMovers() {
  const [coins, setCoins] = useState<CryptoQuote[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCoins = useCallback(async () => {
    try {
      const res = await fetch(`/api/market/crypto?symbols=${SYMBOLS}`);
      if (!res.ok) return;
      const json = await res.json() as { data: CryptoQuote[] | null } | CryptoQuote[];
      const arr: CryptoQuote[] = Array.isArray(json) ? json : (json as { data: CryptoQuote[] | null }).data ?? [];
      if (arr.length > 0) setCoins(arr);
    } catch {
      // silently fail — widget is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCoins();
    const interval = setInterval(() => void fetchCoins(), 60_000);
    return () => clearInterval(interval);
  }, [fetchCoins]);

  const sorted = [...coins].sort((a, b) => b.change_24h_pct - a.change_24h_pct);
  const gainers = sorted.slice(0, 3);
  const losers = sorted.slice(-3).reverse();

  return (
    <div className="card-dark p-4">
      <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Top Movers · 24h</h2>
      <div className="grid grid-cols-2 gap-4">
        {/* Gainers */}
        <div>
          <p className="text-[10px] uppercase font-bold text-emerald-400 tracking-widest mb-1">Gainers</p>
          {loading
            ? Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
            : gainers.map((c) => <CoinRow key={c.symbol} coin={c} />)
          }
        </div>
        {/* Losers */}
        <div>
          <p className="text-[10px] uppercase font-bold text-red-400 tracking-widest mb-1">Losers</p>
          {loading
            ? Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
            : losers.map((c) => <CoinRow key={c.symbol} coin={c} />)
          }
        </div>
      </div>
    </div>
  );
}
