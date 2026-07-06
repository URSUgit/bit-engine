import { NextRequest, NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type ForexRates = {
  base: string;
  timestamp: number;
  rates: Record<string, number>;
};

const DEFAULT_SYMBOLS = "EUR,GBP,JPY,CHF,CAD,AUD,NZD,CNY,INR,BRL,RON,SEK,NOK,MXN,ZAR,HKD";

export async function GET(req: NextRequest) {
  const symbols = req.nextUrl.searchParams.get("symbols") ?? DEFAULT_SYMBOLS;

  const appId = process.env.OPEN_EXCHANGE_RATES_APP_ID;
  if (!appId) return NextResponse.json(fail("open_exchange_rates", "OPEN_EXCHANGE_RATES_APP_ID missing"));

  const result = await withCache(`oxr:latest:${symbols}`, 3600, "open_exchange_rates", async () => {
    const url = `https://openexchangerates.org/api/latest.json?app_id=${appId}&symbols=${symbols}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OXR HTTP ${res.status}`);
    const j = (await res.json()) as { base: string; timestamp: number; rates: Record<string, number>; error?: boolean; message?: string };
    if (j.error) throw new Error(j.message ?? "OXR error");
    return { base: j.base, timestamp: j.timestamp, rates: j.rates } satisfies ForexRates;
  });

  return NextResponse.json(result);
}
