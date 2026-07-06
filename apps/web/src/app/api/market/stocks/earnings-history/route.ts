import { NextRequest, NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type EpsRecord = {
  fiscal_date_ending: string;
  reported_date: string;
  reported_eps: number | null;
  estimated_eps: number | null;
  surprise: number | null;
  surprise_pct: number | null;
};

export type EarningsHistory = {
  symbol: string;
  annual_earnings: Array<{ fiscal_date_ending: string; reported_eps: number }>;
  quarterly_earnings: EpsRecord[];
};

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  if (!symbol) return NextResponse.json(fail("alpha_vantage", "missing symbol param"));

  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return NextResponse.json(fail("alpha_vantage", "ALPHA_VANTAGE_API_KEY missing"));

  const result = await withCache(`av:earnings:${symbol}`, 43200, "alpha_vantage", async () => {
    const url = `https://www.alphavantage.co/query?function=EARNINGS&symbol=${symbol}&apikey=${key}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
    const j = (await res.json()) as {
      annualEarnings?: Array<{ fiscalDateEnding: string; reportedEPS: string }>;
      quarterlyEarnings?: Array<{
        fiscalDateEnding: string; reportedDate: string;
        reportedEPS: string; estimatedEPS: string; surprise: string; surprisePercentage: string;
      }>;
      Note?: string; Information?: string;
    };
    if (j.Note || j.Information) throw new Error(j.Note ?? j.Information ?? "rate limited");
    const num = (s: string) => { const n = parseFloat(s); return isFinite(n) ? n : null; };
    return {
      symbol,
      annual_earnings: (j.annualEarnings ?? []).map((a) => ({
        fiscal_date_ending: a.fiscalDateEnding,
        reported_eps: parseFloat(a.reportedEPS),
      })),
      quarterly_earnings: (j.quarterlyEarnings ?? []).slice(0, 16).map<EpsRecord>((q) => ({
        fiscal_date_ending: q.fiscalDateEnding,
        reported_date: q.reportedDate,
        reported_eps: num(q.reportedEPS),
        estimated_eps: num(q.estimatedEPS),
        surprise: num(q.surprise),
        surprise_pct: num(q.surprisePercentage),
      })),
    } satisfies EarningsHistory;
  });

  return NextResponse.json(result);
}
