import { NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type Mover = {
  ticker: string;
  price: number;
  change_amount: number;
  change_pct: number;
  volume: number;
};

export type Movers = {
  last_updated: string;
  top_gainers: Mover[];
  top_losers: Mover[];
  most_actively_traded: Mover[];
};

function mapMovers(arr: Array<{ ticker: string; price: string; change_amount: string; change_percentage: string; volume: string }>): Mover[] {
  return arr.map((m) => ({
    ticker: m.ticker,
    price: parseFloat(m.price),
    change_amount: parseFloat(m.change_amount),
    change_pct: parseFloat((m.change_percentage ?? "0").replace("%", "")),
    volume: parseInt(m.volume ?? "0", 10),
  }));
}

export async function GET() {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return NextResponse.json(fail("alpha_vantage", "ALPHA_VANTAGE_API_KEY missing"));

  const result = await withCache("av:movers", 300, "alpha_vantage", async () => {
    const url = `https://www.alphavantage.co/query?function=TOP_GAINERS_LOSERS&apikey=${key}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
    const j = (await res.json()) as {
      last_updated?: string;
      top_gainers?: Array<{ ticker: string; price: string; change_amount: string; change_percentage: string; volume: string }>;
      top_losers?: Array<{ ticker: string; price: string; change_amount: string; change_percentage: string; volume: string }>;
      most_actively_traded?: Array<{ ticker: string; price: string; change_amount: string; change_percentage: string; volume: string }>;
      Note?: string; Information?: string;
    };
    if (j.Note || j.Information) throw new Error(j.Note ?? j.Information ?? "rate limited");
    return {
      last_updated: j.last_updated ?? "",
      top_gainers: mapMovers(j.top_gainers ?? []),
      top_losers: mapMovers(j.top_losers ?? []),
      most_actively_traded: mapMovers(j.most_actively_traded ?? []),
    } satisfies Movers;
  });

  return NextResponse.json(result);
}
