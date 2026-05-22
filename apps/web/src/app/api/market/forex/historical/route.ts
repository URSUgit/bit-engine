import { NextRequest, NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type ForexBar = { date: string; open: number; high: number; low: number; close: number };

export async function GET(req: NextRequest) {
  const fromCcy = (req.nextUrl.searchParams.get("from") ?? "").toUpperCase();
  const toCcy = (req.nextUrl.searchParams.get("to") ?? "").toUpperCase();
  const compact = req.nextUrl.searchParams.get("compact") !== "false";
  if (!fromCcy || !toCcy) return NextResponse.json(fail("alpha_vantage", "missing from/to params"));

  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return NextResponse.json(fail("alpha_vantage", "ALPHA_VANTAGE_API_KEY missing"));

  const result = await withCache(`av:fx:${fromCcy}${toCcy}:${compact ? "c" : "f"}`, 3600, "alpha_vantage", async () => {
    const size = compact ? "compact" : "full";
    const url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${fromCcy}&to_symbol=${toCcy}&outputsize=${size}&apikey=${key}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
    const j = (await res.json()) as {
      "Time Series FX (Daily)"?: Record<string, Record<string, string>>;
      Note?: string; Information?: string;
    };
    if (j.Note || j.Information) throw new Error(j.Note ?? j.Information ?? "rate limited");
    const series = j["Time Series FX (Daily)"];
    if (!series) throw new Error("no data");
    return Object.entries(series)
      .map<ForexBar>(([date, v]) => ({
        date,
        open: parseFloat(v["1. open"]),
        high: parseFloat(v["2. high"]),
        low: parseFloat(v["3. low"]),
        close: parseFloat(v["4. close"]),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  });

  return NextResponse.json(result);
}
