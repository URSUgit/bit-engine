import { NextRequest, NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type EarningEvent = {
  symbol: string;
  date: string;
  hour: string;
  eps_estimate: number | null;
  eps_actual: number | null;
  revenue_estimate: number | null;
  revenue_actual: number | null;
  quarter: number | null;
  year: number | null;
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  const from = req.nextUrl.searchParams.get("from") ?? todayISO();
  const to = req.nextUrl.searchParams.get("to") ?? plusDaysISO(90);

  const key = process.env.FINNHUB_API_KEY;
  if (!key) return NextResponse.json(fail("finnhub", "FINNHUB_API_KEY missing"));

  const result = await withCache(`fh:earnings:${symbol}:${from}:${to}`, 43200, "finnhub", async () => {
    const symbolParam = symbol ? `&symbol=${symbol}` : "";
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}${symbolParam}&token=${key}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
    const j = (await res.json()) as {
      earningsCalendar?: Array<{
        symbol: string; date: string; hour: string;
        epsEstimate: number | null; epsActual: number | null;
        revenueEstimate: number | null; revenueActual: number | null;
        quarter: number | null; year: number | null;
      }>;
    };
    return (j.earningsCalendar ?? []).map<EarningEvent>((e) => ({
      symbol: e.symbol, date: e.date, hour: e.hour,
      eps_estimate: e.epsEstimate, eps_actual: e.epsActual,
      revenue_estimate: e.revenueEstimate, revenue_actual: e.revenueActual,
      quarter: e.quarter, year: e.year,
    }));
  });

  return NextResponse.json(result);
}
