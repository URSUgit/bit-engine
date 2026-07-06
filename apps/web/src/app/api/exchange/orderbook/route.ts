import { NextRequest, NextResponse } from "next/server";
import { withCache } from "@/lib/financial-cache";
import { toBinanceSymbol } from "@/lib/binance-utils";

export const dynamic = "force-dynamic";

export type OrderBookLevel = { price: number; qty: number };
export type OrderBook = {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  last_update_id: number;
};

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "BTC").toUpperCase();
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10), 100);
  const binanceSym = toBinanceSymbol(symbol);

  const result = await withCache(`binance:ob:${binanceSym}:${limit}`, 2, "binance", async () => {
    const url = `https://api.binance.com/api/v3/depth?symbol=${binanceSym}&limit=${limit}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
    const j = (await res.json()) as {
      lastUpdateId: number;
      bids: [string, string][];
      asks: [string, string][];
    };
    return {
      symbol: binanceSym,
      last_update_id: j.lastUpdateId,
      bids: j.bids.map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
      asks: j.asks.map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
    } satisfies OrderBook;
  });

  return NextResponse.json(result);
}
