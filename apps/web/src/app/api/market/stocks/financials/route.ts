import { NextRequest, NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type FinancialStatement = {
  fiscal_date_ending: string;
  reported_currency: string;
  [key: string]: string | number;
};

export type Financials = {
  symbol: string;
  income_statement: { annual: FinancialStatement[]; quarterly: FinancialStatement[] };
  balance_sheet: { annual: FinancialStatement[]; quarterly: FinancialStatement[] };
  cash_flow: { annual: FinancialStatement[]; quarterly: FinancialStatement[] };
};

function parseStatement(raw: Record<string, string>): FinancialStatement {
  const result: FinancialStatement = {
    fiscal_date_ending: raw.fiscalDateEnding ?? "",
    reported_currency: raw.reportedCurrency ?? "USD",
  };
  for (const [k, v] of Object.entries(raw)) {
    if (k === "fiscalDateEnding" || k === "reportedCurrency") continue;
    const n = parseFloat(v);
    result[k] = isFinite(n) ? n : v;
  }
  return result;
}

async function fetchStatement(
  fn: string,
  symbol: string,
  apiKey: string,
): Promise<{ annual: FinancialStatement[]; quarterly: FinancialStatement[] }> {
  const url = `https://www.alphavantage.co/query?function=${fn}&symbol=${symbol}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
  const j = (await res.json()) as {
    annualReports?: Record<string, string>[];
    quarterlyReports?: Record<string, string>[];
    Note?: string; Information?: string;
  };
  if (j.Note || j.Information) throw new Error(j.Note ?? j.Information ?? "rate limited");
  return {
    annual: (j.annualReports ?? []).map(parseStatement),
    quarterly: (j.quarterlyReports ?? []).map(parseStatement).slice(0, 8),
  };
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  if (!symbol) return NextResponse.json(fail("alpha_vantage", "missing symbol param"));

  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return NextResponse.json(fail("alpha_vantage", "ALPHA_VANTAGE_API_KEY missing"));

  const result = await withCache(`av:financials:${symbol}`, 86400, "alpha_vantage", async () => {
    const [income, balance, cash] = await Promise.allSettled([
      fetchStatement("INCOME_STATEMENT", symbol, key),
      fetchStatement("BALANCE_SHEET", symbol, key),
      fetchStatement("CASH_FLOW", symbol, key),
    ]);
    return {
      symbol,
      income_statement: income.status === "fulfilled" ? income.value : { annual: [], quarterly: [] },
      balance_sheet: balance.status === "fulfilled" ? balance.value : { annual: [], quarterly: [] },
      cash_flow: cash.status === "fulfilled" ? cash.value : { annual: [], quarterly: [] },
    } satisfies Financials;
  });

  return NextResponse.json(result);
}
