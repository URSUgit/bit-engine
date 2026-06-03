import { NextResponse } from "next/server";
import { withCache } from "@/lib/financial-cache";
import { getMarketData } from "@/lib/hyperliquid";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await withCache(
    "hl:market:meta",
    15,
    "hyperliquid",
    () => getMarketData(),
  );

  if (!result.data) {
    return NextResponse.json(
      { error: "hyperliquid_unavailable", detail: result.error ?? "could not fetch market data" },
      { status: 502 },
    );
  }
  return NextResponse.json(result);
}
