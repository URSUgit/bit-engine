"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BarChart2, TrendingDown, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TradingViewChart, type CandleBar, type LineBar } from "@/components/charts/TradingViewChart";
import { OrderPanel } from "@/components/trading/OrderPanel";
import { AssetFundamentals } from "@/components/markets/AssetFundamentals";
import { useLivePrices } from "@/hooks/useLivePrices";
import { api } from "@/lib/api";
import { mockAssets, generateOrderBook, type OrderBookLevel } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const TIMEFRAMES = ["1m", "5m", "1h", "4h", "1D"] as const;
type ChartType = "area" | "candlestick";

const KLINE_MAP: Record<string, string> = {
  "1m": "1m", "5m": "5m", "1h": "1h", "4h": "4h", "1D": "1d",
};

function fmtPrice(p: number) {
  if (p >= 1000) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

export default function MarketDetailPage() {
  const params = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(params?.symbol ?? "BTC");

  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>("1h");
  const [chartType, setChartType] = useState<ChartType>("candlestick");
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  const livePrices = useLivePrices(symbol);
  const live = livePrices[symbol];

  const { data: asset } = useQuery({
    queryKey: ["market", symbol],
    queryFn: () => api.markets.get(symbol),
    initialData: mockAssets.find((a) => a.symbol === symbol) ?? mockAssets[0],
  });

  const currentPrice = live?.price ?? asset?.price ?? 0;
  const change24h = live?.change24hPct ?? asset?.priceChange24hPct ?? 0;
  const positive = change24h >= 0;

  // Flash price on direction change
  const prevPriceRef = useRef(currentPrice);
  useEffect(() => {
    if (prevPriceRef.current !== currentPrice) {
      setFlash(currentPrice > prevPriceRef.current ? "up" : "down");
      prevPriceRef.current = currentPrice;
      const t = setTimeout(() => setFlash(null), 450);
      return () => clearTimeout(t);
    }
  }, [currentPrice]);

  // Real klines from Binance
  const { data: klines } = useQuery({
    queryKey: ["klines", symbol, timeframe],
    queryFn: async () => {
      const interval = KLINE_MAP[timeframe] ?? "1h";
      const res = await fetch(`/api/exchange/klines?symbol=${symbol}&interval=${interval}&limit=200`);
      const json = await res.json();
      if (!json.data) return null;
      return json.data as Array<{ t: number; o: number; high: number; low: number; close: number }>;
    },
    refetchInterval: 30_000,
  });

  const candleData: CandleBar[] | undefined = klines?.map((k) => ({
    time: Math.floor(k.t / 1000) as CandleBar["time"],
    open: k.o, high: k.high, low: k.low, close: k.close,
  }));

  const areaData: LineBar[] | undefined = klines?.map((k) => ({
    time: Math.floor(k.t / 1000) as LineBar["time"],
    value: k.close,
  }));

  const { data: orderBook } = useQuery({
    queryKey: ["orderbook", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/exchange/orderbook?symbol=${symbol}&limit=20`);
      const json = await res.json();
      if (!json.data) return generateOrderBook(currentPrice || 100);
      const ob = json.data as { bids: { price: number; qty: number }[]; asks: { price: number; qty: number }[] };
      let bidTotal = 0;
      let askTotal = 0;
      return {
        bids: ob.bids.map(({ price, qty }): OrderBookLevel => { bidTotal += qty; return { price, size: qty, total: +bidTotal.toFixed(4) }; }),
        asks: ob.asks.map(({ price, qty }): OrderBookLevel => { askTotal += qty; return { price, size: qty, total: +askTotal.toFixed(4) }; }),
      };
    },
    initialData: generateOrderBook(asset?.price ?? 100),
    refetchInterval: 3_000,
  });

  if (!asset) return null;

  const maxBidTotal = Math.max(...(orderBook?.bids ?? []).map((b) => b.total), 1);
  const maxAskTotal = Math.max(...(orderBook?.asks ?? []).map((a) => a.total), 1);

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-5 p-6 max-w-[1800px] mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/dashboard/markets" className="text-slate-500 hover:text-slate-300 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-11 h-11 rounded-full bg-slate-800 border border-slate-700/50 flex items-center justify-center font-bold text-slate-200 shrink-0">
            {asset.symbol.slice(0, 3)}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-50 tracking-tight">{asset.symbol}</h1>
            <p className="text-sm text-slate-400">
              {asset.name} ·{" "}
              <span className="capitalize text-slate-500">{asset.protocol}</span>
            </p>
          </div>

          <div className="ml-auto flex items-center gap-6 flex-wrap">
            {/* Live price with flash */}
            <div className="text-right">
              <div
                className={cn(
                  "text-3xl font-bold number-font transition-colors duration-300",
                  flash === "up"
                    ? "text-emerald-400"
                    : flash === "down"
                    ? "text-red-400"
                    : "text-slate-50"
                )}
              >
                ${fmtPrice(currentPrice)}
              </div>
              <div
                className={cn(
                  "text-sm number-font font-semibold inline-flex items-center gap-1",
                  positive ? "text-emerald-400" : "text-red-400"
                )}
              >
                {positive ? (
                  <TrendingUp className="w-3.5 h-3.5" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5" />
                )}
                {positive ? "+" : ""}
                {change24h.toFixed(2)}% · 24h
              </div>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "24h Volume", value: `$${(asset.volume24hUsd / 1e6).toFixed(2)}M` },
            {
              label: "Open Interest",
              value: asset.openInterestUsd
                ? `$${(asset.openInterestUsd / 1e6).toFixed(2)}M`
                : "—",
            },
            {
              label: "Funding (1h)",
              value:
                asset.fundingRate !== undefined
                  ? `${(asset.fundingRate * 100).toFixed(3)}%`
                  : "—",
            },
            { label: "Mark Price", value: `$${fmtPrice(currentPrice)}` },
          ].map((s) => (
            <div key={s.label} className="card-dark p-4">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                {s.label}
              </p>
              <p className="text-lg font-bold text-slate-100 number-font mt-1">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Chart + Order Panel layout */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
          {/* Left: Chart */}
          <div className="card-dark p-4">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-slate-100">Price Chart</h2>
              <div className="flex items-center gap-2">
                {/* Chart type toggle */}
                <div className="flex gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
                  <button
                    onClick={() => setChartType("candlestick")}
                    className={cn(
                      "px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-colors",
                      chartType === "candlestick"
                        ? "bg-slate-800 text-cyan-300"
                        : "text-slate-500 hover:text-slate-300"
                    )}
                    title="Candlestick"
                  >
                    <BarChart2 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setChartType("area")}
                    className={cn(
                      "px-2 py-1 rounded text-xs font-semibold transition-colors",
                      chartType === "area"
                        ? "bg-slate-800 text-cyan-300"
                        : "text-slate-500 hover:text-slate-300"
                    )}
                    title="Area"
                  >
                    ∿
                  </button>
                </div>

                {/* Timeframe selector */}
                <div className="flex gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setTimeframe(tf)}
                      className={cn(
                        "px-2.5 py-1 rounded text-xs font-semibold transition-colors",
                        tf === timeframe
                          ? "bg-slate-800 text-cyan-300"
                          : "text-slate-500 hover:text-slate-300"
                      )}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <TradingViewChart
              type={chartType}
              timeframe={timeframe}
              basePrice={currentPrice || asset.price}
              height={420}
              candleData={chartType === "candlestick" ? candleData : undefined}
              data={chartType !== "candlestick" ? areaData : undefined}
            />
          </div>

          {/* Right: Order panel + Order book */}
          <div className="flex flex-col gap-4">
            <OrderPanel symbol={symbol} currentPrice={currentPrice} />

            {/* Compact order book */}
            <div className="card-dark p-4 flex flex-col">
              <h2 className="text-sm font-semibold text-slate-100 mb-3">Order Book</h2>
              <div className="grid grid-cols-3 text-[10px] uppercase tracking-widest text-slate-500 font-bold pb-2 border-b border-slate-800">
                <span>Price</span>
                <span className="text-right">Size</span>
                <span className="text-right">Total</span>
              </div>

              {/* Asks (best ask closest to mid) */}
              <div className="flex flex-col-reverse">
                {(orderBook?.asks ?? []).slice(0, 8).map((a, i) => (
                  <div
                    key={i}
                    className="relative grid grid-cols-3 text-xs py-0.5 number-font hover:bg-slate-800/40 transition-colors"
                  >
                    <div
                      className="absolute right-0 top-0 bottom-0 bg-red-500/10"
                      style={{ width: `${(a.total / maxAskTotal) * 100}%` }}
                    />
                    <span className="text-red-400 relative z-10 font-medium">{a.price.toFixed(2)}</span>
                    <span className="text-slate-300 text-right relative z-10">{a.size.toFixed(2)}</span>
                    <span className="text-slate-500 text-right relative z-10">{a.total.toFixed(2)}</span>
                  </div>
                ))}
              </div>

              {/* Mid price */}
              <div className="flex items-center justify-center py-2 border-y border-slate-800 my-1">
                <span
                  className={cn(
                    "text-base font-bold number-font transition-colors duration-300",
                    flash === "up"
                      ? "text-emerald-400"
                      : flash === "down"
                      ? "text-red-400"
                      : "text-cyan-300"
                  )}
                >
                  ${fmtPrice(currentPrice)}
                </span>
                <span
                  className={cn(
                    "ml-2 text-xs font-semibold",
                    positive ? "text-emerald-400" : "text-red-400"
                  )}
                >
                  {positive ? "+" : ""}
                  {change24h.toFixed(2)}%
                </span>
              </div>

              {/* Bids */}
              <div className="flex flex-col">
                {(orderBook?.bids ?? []).slice(0, 8).map((b, i) => (
                  <div
                    key={i}
                    className="relative grid grid-cols-3 text-xs py-0.5 number-font hover:bg-slate-800/40 transition-colors"
                  >
                    <div
                      className="absolute right-0 top-0 bottom-0 bg-emerald-500/10"
                      style={{ width: `${(b.total / maxBidTotal) * 100}%` }}
                    />
                    <span className="text-emerald-400 relative z-10 font-medium">
                      {b.price.toFixed(2)}
                    </span>
                    <span className="text-slate-300 text-right relative z-10">
                      {b.size.toFixed(2)}
                    </span>
                    <span className="text-slate-500 text-right relative z-10">
                      {b.total.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <AssetFundamentals symbol={symbol} />
      </div>
    </DashboardLayout>
  );
}
