import { NextRequest, NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type Fundamentals = {
  symbol: string;
  name: string;
  description: string;
  sector: string;
  industry: string;
  exchange: string;
  currency: string;
  country: string;
  market_cap: number;
  pe_ratio: number;
  forward_pe: number;
  peg_ratio: number;
  price_to_book: number;
  eps: number;
  dividend_yield_pct: number;
  beta: number;
  fifty_two_week_high: number;
  fifty_two_week_low: number;
  profit_margin: number;
  return_on_equity: number;
  revenue_ttm: number;
  ebitda: number;
  analyst_target_price: number;
};

function num(v: string | undefined): number {
  if (!v || v === "None" || v === "-") return NaN;
  const n = parseFloat(v);
  return isFinite(n) ? n : NaN;
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  if (!symbol) return NextResponse.json(fail("alpha_vantage", "missing symbol param"));

  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return NextResponse.json(fail("alpha_vantage", "ALPHA_VANTAGE_API_KEY missing"));

  const result = await withCache(`av:overview:${symbol}`, 86400, "alpha_vantage", async () => {
    const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${key}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
    const o = (await res.json()) as Record<string, string> & { Note?: string; Information?: string };
    if (o.Note || o.Information) throw new Error(o.Note ?? o.Information ?? "rate limited");
    if (!o.Symbol) throw new Error("no data");
    const f: Fundamentals = {
      symbol: o.Symbol,
      name: o.Name,
      description: o.Description,
      sector: o.Sector,
      industry: o.Industry,
      exchange: o.Exchange,
      currency: o.Currency,
      country: o.Country,
      market_cap: num(o.MarketCapitalization),
      pe_ratio: num(o.PERatio),
      forward_pe: num(o.ForwardPE),
      peg_ratio: num(o.PEGRatio),
      price_to_book: num(o.PriceToBookRatio),
      eps: num(o.EPS),
      dividend_yield_pct: num(o.DividendYield) * 100,
      beta: num(o.Beta),
      fifty_two_week_high: num(o["52WeekHigh"]),
      fifty_two_week_low: num(o["52WeekLow"]),
      profit_margin: num(o.ProfitMargin) * 100,
      return_on_equity: num(o.ReturnOnEquityTTM) * 100,
      revenue_ttm: num(o.RevenueTTM),
      ebitda: num(o.EBITDA),
      analyst_target_price: num(o.AnalystTargetPrice),
    };
    return f;
  });

  return NextResponse.json(result);
}
