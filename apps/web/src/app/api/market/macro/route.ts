import { NextRequest, NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type MacroPoint = { date: string; value: number };
export type MacroSeries = {
  series_id: string;
  title: string;
  units: string;
  frequency: string;
  observations: MacroPoint[];
};

const SERIES_META: Record<string, { title: string }> = {
  GDP:        { title: "Gross Domestic Product" },
  UNRATE:     { title: "Unemployment Rate" },
  CPIAUCSL:   { title: "Consumer Price Index (All Urban)" },
  FEDFUNDS:   { title: "Federal Funds Effective Rate" },
  T10Y2Y:     { title: "10Y - 2Y Treasury Spread" },
  DGS10:      { title: "10-Year Treasury Constant Maturity" },
  DTWEXBGS:   { title: "Trade-Weighted US Dollar Index" },
};

const DEFAULT_SERIES = Object.keys(SERIES_META);

async function fetchSeries(seriesId: string, apiKey: string, limit: number): Promise<MacroSeries> {
  const obsUrl = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
  const metaUrl = `https://api.stlouisfed.org/fred/series?series_id=${seriesId}&api_key=${apiKey}&file_type=json`;

  const [obsRes, metaRes] = await Promise.all([fetch(obsUrl), fetch(metaUrl)]);
  if (!obsRes.ok) throw new Error(`FRED obs HTTP ${obsRes.status}`);
  if (!metaRes.ok) throw new Error(`FRED meta HTTP ${metaRes.status}`);

  const obs = (await obsRes.json()) as { observations?: Array<{ date: string; value: string }> };
  const meta = (await metaRes.json()) as { seriess?: Array<{ id: string; title: string; units: string; frequency: string }> };
  const m = meta.seriess?.[0];

  const observations = (obs.observations ?? [])
    .map<MacroPoint>((o) => ({ date: o.date, value: parseFloat(o.value) }))
    .filter((p) => isFinite(p.value))
    .reverse();

  return {
    series_id: seriesId,
    title: m?.title ?? SERIES_META[seriesId]?.title ?? seriesId,
    units: m?.units ?? "",
    frequency: m?.frequency ?? "",
    observations,
  };
}

export async function GET(req: NextRequest) {
  const seriesParam = req.nextUrl.searchParams.get("series");
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "60", 10);
  const ids = (seriesParam ? seriesParam.split(",") : DEFAULT_SERIES).map((s) => s.trim().toUpperCase());

  const key = process.env.FRED_API_KEY;
  if (!key) return NextResponse.json(fail("fred", "FRED_API_KEY missing"));

  const result = await withCache(`fred:${ids.sort().join(",")}:${limit}`, 21600, "fred", async () => {
    const out: MacroSeries[] = [];
    for (const id of ids) {
      try {
        out.push(await fetchSeries(id, key, limit));
      } catch (err) {
        out.push({
          series_id: id,
          title: SERIES_META[id]?.title ?? id,
          units: "", frequency: "",
          observations: [],
        });
      }
    }
    return out;
  });

  return NextResponse.json(result);
}
