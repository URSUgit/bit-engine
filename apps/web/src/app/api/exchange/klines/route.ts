import { NextRequest, NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";
import { toBinanceSymbol } from "@/lib/binance-utils";

export const dynamic = "force-dynamic";

export type Kline = {
  t: number; // open time ms
  o: number; high: number; low: number; close: number; volume: number;
};

const VALID_INTERVALS = ["1s","1m","3m","5m","15m","30m","1h","2h","4h","6h","8h","12h","1d","3d","1w","1M"];

const TTL: Record<string, number> = {
  "1s": 1, "1m": 30, "3m": 60, "5m": 120, "15m": 300, "30m": 600,
  "1h": 1800, "2h": 3600, "4h": 7200, "6h": 10800, "12h": 21600,
  "1d": 86400, "3d": 86400, "1w": 86400, "1M": 86400,
};

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "BTC").toUpperCase();
  const interval = req.nextUrl.searchParams.get("interval") ?? "1h";
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "200", 10), 1000);

  if (!VALID_INTERVALS.includes(interval)) {
    return NextResponse.json(fail("binance", `invalid interval: ${interval}`));
  }

  const binanceSym = toBinanceSymbol(symbol);
  const ttl = TTL[interval] ?? 60;

  const result = await withCache(`binance:klines:${binanceSym}:${interval}:${limit}`, ttl, "binance", async () => {
    const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
    const raw = (await res.json()) as Array<[number, string, string, string, string, string, ...unknown[]]>;
    return raw.map<Kline>(([t, o, h, l, c, v]) => ({
      t, o: parseFloat(o), high: parseFloat(h), low: parseFloat(l),
      close: parseFloat(c), volume: parseFloat(v),
    }));
  });

  return NextResponse.json(result);
}
