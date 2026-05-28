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

// Kraken pair map for crypto symbols (key-free, globally accessible)
const KRAKEN_PAIRS: Record<string, string> = {
  BTCUSDT: "XBTUSD", ETHUSDT: "ETHUSD", SOLUSDT: "SOLUSD", XRPUSDT: "XRPUSD",
  ADAUSDT: "ADAUSD", DOGEUSDT: "XDGUSD", AVAXUSDT: "AVAXUSD", DOTUSDT: "DOTUSD",
  MATICUSDT: "MATICUSD", LINKUSDT: "LINKUSD", LTCUSDT: "XLTCZUSD", ATOMUSDT: "ATOMUSD",
};

// Map TradingView-style intervals to Kraken minutes
const KRAKEN_INTERVALS: Record<string, number> = {
  "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60,
  "4h": 240, "1d": 1440, "1w": 10080,
};

async function fromBinance(binanceSym: string, interval: string, limit: number): Promise<Kline[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  const raw = (await res.json()) as Array<[number, string, string, string, string, string, ...unknown[]]>;
  return raw.map<Kline>(([t, o, h, l, c, v]) => ({
    t, o: parseFloat(o), high: parseFloat(h), low: parseFloat(l),
    close: parseFloat(c), volume: parseFloat(v),
  }));
}

async function fromKraken(binanceSym: string, interval: string, limit: number): Promise<Kline[]> {
  const pair = KRAKEN_PAIRS[binanceSym];
  if (!pair) throw new Error(`No Kraken pair for ${binanceSym}`);
  const krakInterval = KRAKEN_INTERVALS[interval];
  if (!krakInterval) throw new Error(`Unsupported Kraken interval ${interval}`);

  const since = Math.floor(Date.now() / 1000) - limit * krakInterval * 60;
  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${krakInterval}&since=${since}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Kraken HTTP ${res.status}`);
  const json = (await res.json()) as { result: Record<string, unknown[][]>; error?: string[] };
  if (json.error?.length) throw new Error(`Kraken error: ${json.error.join(", ")}`);
  const candles = Object.values(json.result).find((v) => Array.isArray(v)) as unknown[][] | undefined;
  if (!candles) throw new Error("Kraken: no candle data");

  return candles.slice(-limit).map((k) => ({
    t: (k[0] as number) * 1000,
    o: parseFloat(k[1] as string),
    high: parseFloat(k[2] as string),
    low: parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
    volume: parseFloat(k[6] as string),
  }));
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "BTC").toUpperCase();
  const interval = req.nextUrl.searchParams.get("interval") ?? "1h";
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "200", 10), 1000);

  if (!VALID_INTERVALS.includes(interval)) {
    return NextResponse.json(fail("klines", `invalid interval: ${interval}`));
  }

  const binanceSym = toBinanceSymbol(symbol);
  const ttl = TTL[interval] ?? 60;

  const result = await withCache(`klines:${binanceSym}:${interval}:${limit}`, ttl, "multi-source", async () => {
    // 1. Binance
    try {
      return await fromBinance(binanceSym, interval, limit);
    } catch { /* fall through */ }

    // 2. Kraken (key-free, globally accessible)
    try {
      return await fromKraken(binanceSym, interval, limit);
    } catch { /* fall through */ }

    throw new Error(`No kline data available for ${symbol} ${interval}`);
  });

  return NextResponse.json(result);
}
