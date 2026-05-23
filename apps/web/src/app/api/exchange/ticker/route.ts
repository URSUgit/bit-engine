import { NextRequest, NextResponse } from "next/server";
import { withCache } from "@/lib/financial-cache";
import { toBinanceSymbol } from "@/lib/binance-utils";

export const dynamic = "force-dynamic";

export type Ticker = {
  symbol: string;
  binance_symbol: string;
  price: number;
  price_change: number;
  price_change_pct: number;
  high_24h: number;
  low_24h: number;
  volume: number;
  quote_volume: number;
  open: number;
  count: number;
};

export async function GET(req: NextRequest) {
  const symbolsParam = req.nextUrl.searchParams.get("symbols") ?? "BTC";
  const symbols = symbolsParam.split(",").map((s) => s.trim().toUpperCase());

  const result = await withCache(`binance:ticker:${symbols.sort().join(",")}`, 5, "binance", async () => {
    const binanceSymbols = symbols.map(toBinanceSymbol);
    const url = binanceSymbols.length === 1
      ? `https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbols[0]}`
      : `https://api.binance.com/api/v3/ticker/24hr?symbols=${JSON.stringify(binanceSymbols)}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
    const raw = await res.json();
    const arr: Array<Record<string, string>> = Array.isArray(raw) ? raw : [raw];
    return arr.map<Ticker>((t, i) => ({
      symbol: symbols[i] ?? t.symbol,
      binance_symbol: t.symbol,
      price: parseFloat(t.lastPrice),
      price_change: parseFloat(t.priceChange),
      price_change_pct: parseFloat(t.priceChangePercent),
      high_24h: parseFloat(t.highPrice),
      low_24h: parseFloat(t.lowPrice),
      volume: parseFloat(t.volume),
      quote_volume: parseFloat(t.quoteVolume),
      open: parseFloat(t.openPrice),
      count: parseInt(t.count ?? "0", 10),
    }));
  });

  return NextResponse.json(result);
}
