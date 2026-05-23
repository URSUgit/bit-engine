import { NextRequest, NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type TechnicalPoint = { time: string; [indicator: string]: string | number };

export type Technicals = {
  symbol: string;
  interval: string;
  rsi: TechnicalPoint[];
  macd: TechnicalPoint[];
  bbands: TechnicalPoint[];
  ema_20: TechnicalPoint[];
  ema_50: TechnicalPoint[];
  sma_200: TechnicalPoint[];
};

const INDICATORS = [
  { fn: "RSI", params: "time_period=14&series_type=close", key: "Technical Analysis: RSI", fields: ["RSI"] },
  { fn: "MACD", params: "series_type=close&fastperiod=12&slowperiod=26&signalperiod=9", key: "Technical Analysis: MACD", fields: ["MACD", "MACD_Signal", "MACD_Hist"] },
  { fn: "BBANDS", params: "time_period=20&series_type=close&nbdevup=2&nbdevdn=2", key: "Technical Analysis: BBANDS", fields: ["Real Upper Band", "Real Middle Band", "Real Lower Band"] },
  { fn: "EMA", params: "time_period=20&series_type=close", key: "Technical Analysis: EMA", fields: ["EMA"], label: "ema_20" },
  { fn: "EMA", params: "time_period=50&series_type=close", key: "Technical Analysis: EMA", fields: ["EMA"], label: "ema_50" },
  { fn: "SMA", params: "time_period=200&series_type=close", key: "Technical Analysis: SMA", fields: ["SMA"], label: "sma_200" },
] as const;

async function fetchIndicator(
  fn: string, symbol: string, interval: string, extraParams: string, key: string, dataKey: string, fields: readonly string[],
): Promise<TechnicalPoint[]> {
  const url = `https://www.alphavantage.co/query?function=${fn}&symbol=${symbol}&interval=${interval}&${extraParams}&apikey=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as Record<string, unknown> & { Note?: string; Information?: string };
  if (j.Note || j.Information) throw new Error("rate limited");
  const series = j[dataKey] as Record<string, Record<string, string>> | undefined;
  if (!series) return [];
  return Object.entries(series)
    .slice(0, 100)
    .map(([time, v]) => {
      const pt: TechnicalPoint = { time };
      for (const f of fields) pt[f] = parseFloat(v[f] ?? "0");
      return pt;
    })
    .sort((a, b) => (a.time as string).localeCompare(b.time as string));
}

const VALID_INTERVALS = ["1min", "5min", "15min", "30min", "60min", "daily", "weekly", "monthly"];

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  const interval = req.nextUrl.searchParams.get("interval") ?? "daily";
  if (!symbol) return NextResponse.json(fail("alpha_vantage", "missing symbol param"));
  if (!VALID_INTERVALS.includes(interval)) return NextResponse.json(fail("alpha_vantage", `invalid interval: ${interval}`));

  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return NextResponse.json(fail("alpha_vantage", "ALPHA_VANTAGE_API_KEY missing"));

  const result = await withCache(`av:tech:${symbol}:${interval}`, 3600, "alpha_vantage", async () => {
    const [rsiRes, macdRes, bbandsRes, ema20Res, ema50Res, sma200Res] = await Promise.allSettled(
      INDICATORS.map((ind) =>
        fetchIndicator(ind.fn, symbol, interval, ind.params, key, ind.key, ind.fields),
      ),
    );
    return {
      symbol, interval,
      rsi: rsiRes.status === "fulfilled" ? rsiRes.value : [],
      macd: macdRes.status === "fulfilled" ? macdRes.value : [],
      bbands: bbandsRes.status === "fulfilled" ? bbandsRes.value : [],
      ema_20: ema20Res.status === "fulfilled" ? ema20Res.value : [],
      ema_50: ema50Res.status === "fulfilled" ? ema50Res.value : [],
      sma_200: sma200Res.status === "fulfilled" ? sma200Res.value : [],
    } satisfies Technicals;
  });

  return NextResponse.json(result);
}
