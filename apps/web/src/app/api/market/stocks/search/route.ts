import { NextRequest, NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type SearchResult = {
  symbol: string;
  name: string;
  exchange: string;
  country: string;
  currency: string;
  type: string;
};

export async function GET(req: NextRequest) {
  const query = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!query) return NextResponse.json(fail("twelve_data", "missing q param"));

  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) return NextResponse.json(fail("twelve_data", "TWELVE_DATA_API_KEY missing"));

  const result = await withCache(`td:search:${query.toLowerCase()}`, 86400, "twelve_data", async () => {
    const url = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(query)}&apikey=${key}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
    const j = (await res.json()) as {
      data?: Array<{
        symbol: string; instrument_name: string; exchange: string;
        country: string; currency: string; instrument_type: string;
      }>;
    };
    return (j.data ?? []).map<SearchResult>((r) => ({
      symbol: r.symbol, name: r.instrument_name,
      exchange: r.exchange, country: r.country,
      currency: r.currency, type: r.instrument_type,
    }));
  });

  return NextResponse.json(result);
}
