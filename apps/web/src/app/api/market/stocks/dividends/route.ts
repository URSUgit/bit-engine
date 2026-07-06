import { NextRequest, NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type DividendRecord = {
  ex_dividend_date: string;
  declaration_date: string;
  record_date: string;
  payment_date: string;
  amount: number;
};

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  if (!symbol) return NextResponse.json(fail("alpha_vantage", "missing symbol param"));

  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return NextResponse.json(fail("alpha_vantage", "ALPHA_VANTAGE_API_KEY missing"));

  const result = await withCache(`av:dividends:${symbol}`, 86400, "alpha_vantage", async () => {
    const url = `https://www.alphavantage.co/query?function=DIVIDENDS&symbol=${symbol}&apikey=${key}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
    const j = (await res.json()) as {
      data?: Array<{
        ex_dividend_date: string; declaration_date: string;
        record_date: string; payment_date: string; amount: string;
      }>;
      Note?: string; Information?: string;
    };
    if (j.Note || j.Information) throw new Error(j.Note ?? j.Information ?? "rate limited");
    return (j.data ?? []).map<DividendRecord>((d) => ({
      ex_dividend_date: d.ex_dividend_date,
      declaration_date: d.declaration_date,
      record_date: d.record_date,
      payment_date: d.payment_date,
      amount: parseFloat(d.amount),
    }));
  });

  return NextResponse.json(result);
}
