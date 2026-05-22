import { NextRequest, NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type CompanyProfile = {
  symbol: string;
  name: string;
  country: string;
  currency: string;
  exchange: string;
  ipo: string;
  industry: string;
  logo: string;
  market_cap: number;
  shares_outstanding: number;
  phone: string;
  weburl: string;
};

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  if (!symbol) return NextResponse.json(fail("finnhub", "missing symbol param"));

  const key = process.env.FINNHUB_API_KEY;
  if (!key) return NextResponse.json(fail("finnhub", "FINNHUB_API_KEY missing"));

  const result = await withCache(`fh:profile:${symbol}`, 604800, "finnhub", async () => {
    const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${key}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
    const p = (await res.json()) as {
      ticker?: string; name?: string; country?: string; currency?: string;
      exchange?: string; ipo?: string; finnhubIndustry?: string; logo?: string;
      marketCapitalization?: number; shareOutstanding?: number; phone?: string; weburl?: string;
    };
    if (!p.ticker) throw new Error("no profile");
    const profile: CompanyProfile = {
      symbol: p.ticker, name: p.name ?? "", country: p.country ?? "",
      currency: p.currency ?? "", exchange: p.exchange ?? "", ipo: p.ipo ?? "",
      industry: p.finnhubIndustry ?? "", logo: p.logo ?? "",
      market_cap: (p.marketCapitalization ?? 0) * 1e6,
      shares_outstanding: (p.shareOutstanding ?? 0) * 1e6,
      phone: p.phone ?? "", weburl: p.weburl ?? "",
    };
    return profile;
  });

  return NextResponse.json(result);
}
