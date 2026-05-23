import { NextRequest, NextResponse } from "next/server";
import { withCache, fail } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

export type CommodityPoint = { date: string; value: number };
export type CommoditySeries = {
  id: string;
  name: string;
  unit: string;
  interval: string;
  observations: CommodityPoint[];
};

const COMMODITY_META: Record<string, { name: string; unit: string }> = {
  WTI:             { name: "Crude Oil (WTI)",           unit: "USD/barrel" },
  BRENT:           { name: "Crude Oil (Brent)",         unit: "USD/barrel" },
  NATURAL_GAS:     { name: "Natural Gas",               unit: "USD/MMBtu" },
  COPPER:          { name: "Copper",                    unit: "USD/metric ton" },
  ALUMINUM:        { name: "Aluminum",                  unit: "USD/metric ton" },
  WHEAT:           { name: "Wheat",                     unit: "USD/bushel" },
  CORN:            { name: "Corn",                      unit: "USD/bushel" },
  COTTON:          { name: "Cotton",                    unit: "USD/pound" },
  SUGAR:           { name: "Sugar",                     unit: "cents/pound" },
  COFFEE:          { name: "Coffee",                    unit: "USD/pound" },
  ALL_COMMODITIES: { name: "Global Commodity Index",    unit: "Index" },
};

const DEFAULT_COMMODITIES = ["WTI", "BRENT", "NATURAL_GAS", "COPPER", "WHEAT", "CORN"];

async function fetchCommodity(id: string, interval: string, apiKey: string): Promise<CommoditySeries> {
  const url = `https://www.alphavantage.co/query?function=${id}&interval=${interval}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as {
    name?: string; unit?: string; interval?: string;
    data?: Array<{ date: string; value: string }>;
    Note?: string; Information?: string;
  };
  if (j.Note || j.Information) throw new Error("rate limited");
  const meta = COMMODITY_META[id] ?? { name: id, unit: "" };
  return {
    id,
    name: j.name ?? meta.name,
    unit: j.unit ?? meta.unit,
    interval: j.interval ?? interval,
    observations: (j.data ?? [])
      .map((d) => ({ date: d.date, value: parseFloat(d.value) }))
      .filter((p) => isFinite(p.value))
      .slice(0, 60),
  };
}

export async function GET(req: NextRequest) {
  const commoditiesParam = req.nextUrl.searchParams.get("commodities");
  const interval = req.nextUrl.searchParams.get("interval") ?? "monthly";
  const ids = (commoditiesParam ? commoditiesParam.split(",") : DEFAULT_COMMODITIES)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s in COMMODITY_META);

  if (ids.length === 0) return NextResponse.json(fail("alpha_vantage", "no valid commodity ids"));

  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return NextResponse.json(fail("alpha_vantage", "ALPHA_VANTAGE_API_KEY missing"));

  const result = await withCache(`av:commodities:${ids.join(",")}:${interval}`, 21600, "alpha_vantage", async () => {
    const out: CommoditySeries[] = [];
    for (const id of ids) {
      try {
        out.push(await fetchCommodity(id, interval, key));
      } catch {
        out.push({ id, name: COMMODITY_META[id]?.name ?? id, unit: "", interval, observations: [] });
      }
    }
    return out;
  });

  return NextResponse.json(result);
}
