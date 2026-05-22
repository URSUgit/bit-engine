import { NextRequest, NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type DailyBar = { date: string; open: number; high: number; low: number; close: number; adj_close: number; volume: number };

async function fetchAlphaVantageDaily(symbol: string, apiKey: string, compact: boolean): Promise<DailyBar[]> {
  const size = compact ? "compact" : "full";
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${symbol}&outputsize=${size}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
  const json = (await res.json()) as {
    "Time Series (Daily)"?: Record<string, Record<string, string>>;
    Note?: string;
    Information?: string;
  };
  if (json.Note || json.Information) throw new Error(json.Note ?? json.Information ?? "rate limited");
  const series = json["Time Series (Daily)"];
  if (!series) throw new Error("no data");
  return Object.entries(series)
    .map(([date, v]) => ({
      date,
      open: parseFloat(v["1. open"]),
      high: parseFloat(v["2. high"]),
      low: parseFloat(v["3. low"]),
      close: parseFloat(v["4. close"]),
      adj_close: parseFloat(v["5. adjusted close"]),
      volume: parseInt(v["6. volume"] ?? "0", 10),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchYahooDaily(symbol: string, range: string): Promise<DailyBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const json = (await res.json()) as {
    chart: { result?: Array<{ timestamp: number[]; indicators: { quote: Array<{ open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }>; adjclose?: Array<{ adjclose: number[] }> } }>; error?: { description: string } };
  };
  if (json.chart.error) throw new Error(json.chart.error.description);
  const r = json.chart.result?.[0];
  if (!r) throw new Error("no data");
  const q = r.indicators.quote[0];
  const adj = r.indicators.adjclose?.[0].adjclose;
  return r.timestamp.map((t, i) => ({
    date: new Date(t * 1000).toISOString().slice(0, 10),
    open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i],
    adj_close: adj?.[i] ?? q.close[i],
    volume: q.volume[i] ?? 0,
  })).filter((b) => isFinite(b.close));
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  const compact = req.nextUrl.searchParams.get("compact") !== "false";
  if (!symbol) return NextResponse.json(fail("alpha_vantage", "missing symbol param"));

  const key = process.env.ALPHA_VANTAGE_API_KEY;
  const cacheKey = `daily:${symbol}:${compact ? "c" : "f"}`;

  if (key) {
    const result = await withCache(cacheKey, 3600, "alpha_vantage", async () => {
      try {
        return await fetchAlphaVantageDaily(symbol, key, compact);
      } catch {
        return await fetchYahooDaily(symbol, compact ? "3mo" : "10y");
      }
    });
    return NextResponse.json(result);
  }

  const result = await withCache(cacheKey, 3600, "yahoo", () => fetchYahooDaily(symbol, compact ? "3mo" : "10y"));
  return NextResponse.json(result);
}
