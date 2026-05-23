import { NextRequest, NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type EconomicPoint = { date: string; value: number };
export type EconomicSeries = {
  id: string;
  name: string;
  unit: string;
  interval: string;
  observations: EconomicPoint[];
};

// Alpha Vantage economic indicator functions (separate from FRED)
const ECONOMIC_META: Record<string, { fn: string; name: string; unit: string; interval: string }> = {
  REAL_GDP:         { fn: "REAL_GDP",         name: "Real GDP",                unit: "Billions USD",   interval: "quarterly" },
  REAL_GDP_PC:      { fn: "REAL_GDP_PER_CAPITA", name: "Real GDP Per Capita", unit: "USD",            interval: "quarterly" },
  TREASURY_10Y:     { fn: "TREASURY_YIELD",   name: "10Y Treasury Yield",     unit: "%",              interval: "monthly" },
  TREASURY_2Y:      { fn: "TREASURY_YIELD",   name: "2Y Treasury Yield",      unit: "%",              interval: "monthly" },
  FEDERAL_FUNDS:    { fn: "FEDERAL_FUNDS_RATE", name: "Fed Funds Rate",       unit: "%",              interval: "monthly" },
  CPI:              { fn: "CPI",              name: "Consumer Price Index",    unit: "Index",          interval: "monthly" },
  INFLATION:        { fn: "INFLATION",        name: "Inflation Rate (Annual)", unit: "%",              interval: "annual" },
  RETAIL_SALES:     { fn: "RETAIL_SALES",     name: "Retail Sales",           unit: "Millions USD",   interval: "monthly" },
  NONFARM_PAYROLL:  { fn: "NONFARM_PAYROLL",  name: "Nonfarm Payroll",        unit: "Thousands",      interval: "monthly" },
  UNEMPLOYMENT:     { fn: "UNEMPLOYMENT",     name: "Unemployment Rate",      unit: "%",              interval: "monthly" },
  DURABLES:         { fn: "DURABLES",         name: "Durable Goods Orders",   unit: "Billions USD",   interval: "monthly" },
};

const DEFAULT_INDICATORS = ["REAL_GDP", "FEDERAL_FUNDS", "CPI", "INFLATION", "UNEMPLOYMENT", "NONFARM_PAYROLL"];

async function fetchIndicator(id: string, apiKey: string): Promise<EconomicSeries> {
  const meta = ECONOMIC_META[id];
  const extraParams = id === "TREASURY_10Y" ? "&maturity=10year" : id === "TREASURY_2Y" ? "&maturity=2year" : "";
  const url = `https://www.alphavantage.co/query?function=${meta.fn}&interval=${meta.interval}&apikey=${apiKey}${extraParams}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as {
    name?: string; unit?: string; interval?: string;
    data?: Array<{ date: string; value: string }>;
    Note?: string; Information?: string;
  };
  if (j.Note || j.Information) throw new Error("rate limited");
  return {
    id,
    name: meta.name,
    unit: meta.unit,
    interval: meta.interval,
    observations: (j.data ?? [])
      .map((d) => ({ date: d.date, value: parseFloat(d.value) }))
      .filter((p) => isFinite(p.value))
      .slice(0, 60),
  };
}

export async function GET(req: NextRequest) {
  const seriesParam = req.nextUrl.searchParams.get("series");
  const ids = (seriesParam ? seriesParam.split(",") : DEFAULT_INDICATORS)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s in ECONOMIC_META);

  if (ids.length === 0) return NextResponse.json(fail("alpha_vantage", "no valid indicator ids"));

  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return NextResponse.json(fail("alpha_vantage", "ALPHA_VANTAGE_API_KEY missing"));

  const result = await withCache(`av:economic:${ids.join(",")}`, 21600, "alpha_vantage", async () => {
    const out: EconomicSeries[] = [];
    for (const id of ids) {
      try {
        out.push(await fetchIndicator(id, key));
      } catch {
        const meta = ECONOMIC_META[id];
        out.push({ id, name: meta.name, unit: meta.unit, interval: meta.interval, observations: [] });
      }
    }
    return out;
  });

  return NextResponse.json(result);
}
