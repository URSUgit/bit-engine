import { NextRequest, NextResponse } from "next/server";
import { withCache } from "@/lib/financial-cache";

export const dynamic = "force-dynamic";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

const SYMBOL_TO_ID: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin",
  XRP: "ripple", ADA: "cardano", DOGE: "dogecoin", AVAX: "avalanche-2",
  MATIC: "matic-network", DOT: "polkadot", LINK: "chainlink", LTC: "litecoin",
  ATOM: "cosmos", UNI: "uniswap", ARB: "arbitrum", OP: "optimism",
};

export type CryptoQuote = {
  symbol: string;
  name: string;
  price_usd: number;
  market_cap_usd: number;
  volume_24h_usd: number;
  change_24h_pct: number;
  change_7d_pct: number;
  image: string;
};

export async function GET(req: NextRequest) {
  const symbolsParam = req.nextUrl.searchParams.get("symbols") ?? "BTC,ETH,SOL";
  const symbols = symbolsParam.toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
  const ids = symbols.map((s) => SYMBOL_TO_ID[s]).filter(Boolean);

  if (ids.length === 0) {
    return NextResponse.json({ data: [], source: "coingecko", cachedAt: new Date().toISOString() });
  }

  const result = await withCache(
    `crypto:${ids.sort().join(",")}`,
    120,
    "coingecko",
    async () => {
      const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${ids.join(",")}&price_change_percentage=24h,7d`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
      const raw = (await res.json()) as Array<{
        symbol: string; name: string; current_price: number; market_cap: number;
        total_volume: number; price_change_percentage_24h: number;
        price_change_percentage_7d_in_currency: number; image: string;
      }>;
      return raw.map<CryptoQuote>((c) => ({
        symbol: c.symbol.toUpperCase(),
        name: c.name,
        price_usd: c.current_price,
        market_cap_usd: c.market_cap,
        volume_24h_usd: c.total_volume,
        change_24h_pct: c.price_change_percentage_24h,
        change_7d_pct: c.price_change_percentage_7d_in_currency,
        image: c.image,
      }));
    },
  );

  return NextResponse.json(result);
}
