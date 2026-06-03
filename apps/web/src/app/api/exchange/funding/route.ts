import { NextRequest, NextResponse } from "next/server";
import { withCache } from "@/lib/financial-cache";
import { toBinanceSymbol } from "@/lib/binance-utils";

export const dynamic = "force-dynamic";

export type FundingData = {
  symbol: string;
  funding_rate: number;
  next_funding_time: number;
  open_interest: number;
  recent_rates: Array<{ time: number; rate: number }>;
};

const EMPTY_RESPONSE = (symbol: string): FundingData => ({
  symbol,
  funding_rate: 0,
  next_funding_time: 0,
  open_interest: 0,
  recent_rates: [],
});

async function fetchFundingData(symbol: string): Promise<FundingData> {
  // toBinanceSymbol returns e.g. BTCUSDT; for futures we need BTCUSDT directly
  const binanceSym = toBinanceSymbol(symbol);

  const [fundingRes, oiRes] = await Promise.all([
    fetch(
      `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${binanceSym}&limit=10`,
      { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 0 } }
    ),
    fetch(
      `https://fapi.binance.com/fapi/v1/openInterest?symbol=${binanceSym}`,
      { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 0 } }
    ),
  ]);

  if (!fundingRes.ok || !oiRes.ok) {
    throw new Error(`Binance Futures HTTP ${fundingRes.status} / ${oiRes.status}`);
  }

  type BinanceFundingEntry = {
    symbol: string;
    fundingRate: string;
    fundingTime: number;
    markPrice?: string;
  };

  type BinanceOIResponse = {
    symbol: string;
    openInterest: string;
    time: number;
  };

  const fundingJson = (await fundingRes.json()) as BinanceFundingEntry[];
  const oiJson = (await oiRes.json()) as BinanceOIResponse;

  if (!Array.isArray(fundingJson) || fundingJson.length === 0) {
    throw new Error("No funding rate data");
  }

  // Most recent entry is the last item
  const latest = fundingJson[fundingJson.length - 1];
  const fundingRate = parseFloat(latest.fundingRate);

  // Next funding time: Binance funding occurs every 8 hours (00:00, 08:00, 16:00 UTC)
  const now = Date.now();
  const eightHours = 8 * 60 * 60 * 1000;
  const nextFundingTime = Math.ceil(now / eightHours) * eightHours;

  const openInterest = parseFloat(oiJson.openInterest);

  const recentRates = fundingJson.map((entry) => ({
    time: entry.fundingTime,
    rate: parseFloat(entry.fundingRate),
  }));

  return {
    symbol,
    funding_rate: fundingRate,
    next_funding_time: nextFundingTime,
    open_interest: openInterest,
    recent_rates: recentRates,
  };
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "BTC").toUpperCase();

  // Cache for 60 seconds (funding rates update every 8h, but OI changes more frequently)
  const result = await withCache(`funding:${symbol}`, 60, "binance-futures", () =>
    fetchFundingData(symbol)
  );

  // If fetch failed (e.g. spot-only asset), return graceful empty response
  if (result.data === null) {
    return NextResponse.json({
      data: EMPTY_RESPONSE(symbol),
      source: "fallback",
      cachedAt: new Date().toISOString(),
    });
  }

  return NextResponse.json(result);
}
