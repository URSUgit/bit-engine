"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, TrendingUp, TrendingDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TradingViewChart } from "@/components/charts/TradingViewChart";
import { api } from "@/lib/api";
import { mockAssets, generateOrderBook } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export default function MarketDetailPage() {
  const params = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(params?.symbol ?? "BTC");

  const { data: asset } = useQuery({
    queryKey: ["market", symbol],
    queryFn: () => api.markets.get(symbol),
    initialData: mockAssets.find((a) => a.symbol === symbol) ?? mockAssets[0],
  });

  const { data: orderBook } = useQuery({
    queryKey: ["orderbook", symbol],
    queryFn: () => api.markets.orderBook(symbol),
    initialData: generateOrderBook(asset?.price ?? 100),
    refetchInterval: 5_000,
  });

  if (!asset) return null;
  const positive = asset.priceChange24hPct >= 0;
  const maxBidTotal = Math.max(...((orderBook?.bids ?? []).map((b) => b.total)), 1);
  const maxAskTotal = Math.max(...((orderBook?.asks ?? []).map((a) => a.total)), 1);

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-5 p-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/dashboard/markets" className="text-slate-500 hover:text-slate-300 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-11 h-11 rounded-full bg-slate-800 border border-slate-700/50 flex items-center justify-center font-bold text-slate-200">
            {asset.symbol.slice(0, 3)}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">{asset.symbol}</h1>
            <p className="text-sm text-slate-400">{asset.name} · <span className="capitalize">{asset.protocol}</span></p>
          </div>
          <div className="ml-auto flex items-center gap-6">
            <div className="text-right">
              <div className="text-3xl font-bold text-slate-50 number-font">${asset.price.toLocaleString()}</div>
              <div className={cn("text-sm number-font font-semibold inline-flex items-center gap-1", positive ? "text-emerald-400" : "text-red-400")}>
                {positive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {positive ? "+" : ""}{asset.priceChange24hPct.toFixed(2)}% · 24h
              </div>
            </div>
            <div className="flex gap-2">
              <button className="px-5 py-2.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 font-semibold text-sm transition-colors border border-emerald-500/20">Buy / Long</button>
              <button className="px-5 py-2.5 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 font-semibold text-sm transition-colors border border-red-500/20">Sell / Short</button>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "24h Volume", value: `$${(asset.volume24hUsd / 1e6).toFixed(2)}M` },
            { label: "Open Interest", value: asset.openInterestUsd ? `$${(asset.openInterestUsd / 1e6).toFixed(2)}M` : "—" },
            { label: "Funding (1h)", value: asset.fundingRate !== undefined ? `${(asset.fundingRate * 100).toFixed(3)}%` : "—" },
            { label: "Mark Price", value: `$${asset.price.toLocaleString()}` },
          ].map((s) => (
            <div key={s.label} className="card-dark p-4">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{s.label}</p>
              <p className="text-lg font-bold text-slate-100 number-font mt-1">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Chart + Order Book */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 card-dark p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-100">Price Chart</h2>
              <div className="flex gap-1 text-xs bg-slate-900 rounded-lg p-1 border border-slate-800">
                {["1m", "5m", "1h", "4h", "1D"].map((tf) => (
                  <button
                    key={tf}
                    className={cn(
                      "px-2 py-0.5 rounded",
                      tf === "1h" ? "bg-slate-800 text-cyan-300 font-semibold" : "text-slate-500 hover:text-slate-300"
                    )}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>
            <TradingViewChart height={420} />
          </div>

          <div className="card-dark p-4 flex flex-col">
            <h2 className="text-sm font-semibold text-slate-100 mb-3">Order Book</h2>
            <div className="grid grid-cols-3 text-[10px] uppercase tracking-widest text-slate-500 font-bold pb-2 border-b border-slate-800">
              <span>Price (USD)</span>
              <span className="text-right">Size</span>
              <span className="text-right">Total</span>
            </div>

            {/* Asks (reversed so best ask is closest to mid) */}
            <div className="flex flex-col-reverse">
              {(orderBook?.asks ?? []).slice(0, 12).map((a, i) => (
                <div key={i} className="relative grid grid-cols-3 text-xs py-1 number-font hover:bg-slate-800/40 transition-colors">
                  <div className="absolute right-0 top-0 bottom-0 bg-red-500/10" style={{ width: `${(a.total / maxAskTotal) * 100}%` }} />
                  <span className="text-red-400 relative z-10 font-medium">{a.price.toFixed(2)}</span>
                  <span className="text-slate-300 text-right relative z-10">{a.size.toFixed(2)}</span>
                  <span className="text-slate-500 text-right relative z-10">{a.total.toFixed(2)}</span>
                </div>
              ))}
            </div>

            {/* Mid price */}
            <div className="flex items-center justify-center py-2 border-y border-slate-800 my-1">
              <span className="text-base font-bold text-cyan-300 number-font">${asset.price.toLocaleString()}</span>
              <span className={cn("ml-2 text-xs font-semibold", positive ? "text-emerald-400" : "text-red-400")}>
                {positive ? "+" : ""}{asset.priceChange24hPct.toFixed(2)}%
              </span>
            </div>

            {/* Bids */}
            <div className="flex flex-col">
              {(orderBook?.bids ?? []).slice(0, 12).map((b, i) => (
                <div key={i} className="relative grid grid-cols-3 text-xs py-1 number-font hover:bg-slate-800/40 transition-colors">
                  <div className="absolute right-0 top-0 bottom-0 bg-emerald-500/10" style={{ width: `${(b.total / maxBidTotal) * 100}%` }} />
                  <span className="text-emerald-400 relative z-10 font-medium">{b.price.toFixed(2)}</span>
                  <span className="text-slate-300 text-right relative z-10">{b.size.toFixed(2)}</span>
                  <span className="text-slate-500 text-right relative z-10">{b.total.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
