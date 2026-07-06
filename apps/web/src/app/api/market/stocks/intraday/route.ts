import { NextRequest, NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type IntradayBar = { time: string; open: number; high: number; low: number; close: number; volume: number };

const VALID_INTERVALS = ["1min", "5min", "15min", "30min", "60min"] as const;
type Interval = typeof VALID_INTERVALS[number];

const TTL_MAP: Record<Interval, number> = {
  "1min": 60, "5min": 300, "15min": 600, "30min": 900, "60min": 1800,
};

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  const interval = (req.nextUrl.searchParams.get("interval") ?? "5min") as Interval;
  const extended = req.nextUrl.searchParams.get("extended") === "true";
  if (!symbol) return NextResponse.json(fail("alpha_vantage", "missing symbol param"));
  if (!VALID_INTERVALS.includes(interval)) return NextResponse.json(fail("alpha_vantage", `invalid interval: ${interval}`));

  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return NextResponse.json(fail("alpha_vantage", "ALPHA_VANTAGE_API_KEY missing"));

  const result = await withCache(
    `av:intraday:${symbol}:${interval}:${extended}`,
    TTL_MAP[interval],
    "alpha_vantage",
    async () => {
      const params = new URLSearchParams({
        function: "TIME_SERIES_INTRADAY",
        symbol, interval, outputsize: "compact", apikey: key,
        extended_hours: extended ? "true" : "false",
      });
      const res = await fetch(`https://www.alphavantage.co/query?${params}`);
      if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
      const j = (await res.json()) as Record<string, unknown> & { Note?: string; Information?: string };
      if (j.Note || j.Information) throw new Error((j.Note ?? j.Information ?? "rate limited") as string);
      const key2 = `Time Series (${interval})`;
      const series = j[key2] as Record<string, Record<string, string>> | undefined;
      if (!series) throw new Error("no data");
      return Object.entries(series)
        .map<IntradayBar>(([time, v]) => ({
          time,
          open: parseFloat(v["1. open"]),
          high: parseFloat(v["2. high"]),
          low: parseFloat(v["3. low"]),
          close: parseFloat(v["4. close"]),
          volume: parseInt(v["5. volume"] ?? "0", 10),
        }))
        .sort((a, b) => a.time.localeCompare(b.time));
    },
  );

  return NextResponse.json(result);
}
