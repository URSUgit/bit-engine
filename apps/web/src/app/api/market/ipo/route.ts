import { NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type IpoEntry = {
  symbol: string;
  name: string;
  ipo_date: string;
  price_range_low: number;
  price_range_high: number;
  currency: string;
  exchange: string;
};

export async function GET() {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return NextResponse.json(fail("alpha_vantage", "ALPHA_VANTAGE_API_KEY missing"));

  const result = await withCache("av:ipo_calendar", 21600, "alpha_vantage", async () => {
    const url = `https://www.alphavantage.co/query?function=IPO_CALENDAR&apikey=${key}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);

    // Response is CSV
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    if (lines.length < 2) return [];
    // header: symbol,name,ipoDate,priceRangeLow,priceRangeHigh,currency,exchange,status
    const rows = lines.slice(1).map((line) => {
      const [symbol, name, ipo_date, priceRangeLow, priceRangeHigh, currency, exchange] = line.split(",");
      return {
        symbol: symbol?.trim() ?? "",
        name: name?.trim() ?? "",
        ipo_date: ipo_date?.trim() ?? "",
        price_range_low: parseFloat(priceRangeLow ?? "0"),
        price_range_high: parseFloat(priceRangeHigh ?? "0"),
        currency: currency?.trim() ?? "USD",
        exchange: exchange?.trim() ?? "",
      } satisfies IpoEntry;
    }).filter((r) => r.symbol);
    return rows;
  });

  return NextResponse.json(result);
}
