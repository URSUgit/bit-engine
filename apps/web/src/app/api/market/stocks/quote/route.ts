import { NextRequest, NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type StockQuote = {
  symbol: string;
  price: number;
  change: number;
  change_pct: number;
  open: number;
  high: number;
  low: number;
  prev_close: number;
  volume: number;
  market: "US" | "GLOBAL";
};

async function fetchAlphaVantage(symbol: string, apiKey: string): Promise<StockQuote> {
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
  const json = (await res.json()) as { "Global Quote"?: Record<string, string>; Note?: string; Information?: string };
  if (json.Note || json.Information) throw new Error(json.Note ?? json.Information ?? "rate limited");
  const q = json["Global Quote"];
  if (!q || !q["05. price"]) throw new Error("no data");
  return {
    symbol: q["01. symbol"],
    price: parseFloat(q["05. price"]),
    change: parseFloat(q["09. change"]),
    change_pct: parseFloat(q["10. change percent"]?.replace("%", "") ?? "0"),
    open: parseFloat(q["02. open"]),
    high: parseFloat(q["03. high"]),
    low: parseFloat(q["04. low"]),
    prev_close: parseFloat(q["08. previous close"]),
    volume: parseInt(q["06. volume"] ?? "0", 10),
    market: "US",
  };
}

async function fetchTwelveData(symbol: string, apiKey: string): Promise<StockQuote> {
  const url = `https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
  const q = (await res.json()) as Record<string, string> & { code?: number; message?: string };
  if (q.code && q.code !== 200) throw new Error(q.message ?? "twelve data error");
  return {
    symbol: q.symbol,
    price: parseFloat(q.close),
    change: parseFloat(q.change),
    change_pct: parseFloat(q.percent_change),
    open: parseFloat(q.open),
    high: parseFloat(q.high),
    low: parseFloat(q.low),
    prev_close: parseFloat(q.previous_close),
    volume: parseInt(q.volume ?? "0", 10),
    market: "GLOBAL",
  };
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  const market = (req.nextUrl.searchParams.get("market") ?? "US").toUpperCase();
  if (!symbol) return NextResponse.json(fail("alpha_vantage", "missing symbol param"));

  if (market === "US") {
    const key = process.env.ALPHA_VANTAGE_API_KEY;
    if (!key) return NextResponse.json(fail("alpha_vantage", "ALPHA_VANTAGE_API_KEY missing"));
    return NextResponse.json(await withCache(`av:quote:${symbol}`, 60, "alpha_vantage", () => fetchAlphaVantage(symbol, key)));
  }

  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) return NextResponse.json(fail("twelve_data", "TWELVE_DATA_API_KEY missing"));
  return NextResponse.json(await withCache(`td:quote:${symbol}`, 60, "twelve_data", () => fetchTwelveData(symbol, key)));
}
