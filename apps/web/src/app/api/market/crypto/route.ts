import { NextRequest, NextResponse } from "next/server";
import { withCache } from "@/lib/financial-cache";
import { toBinanceSymbol } from "@/lib/binance-utils";

export const dynamic = "force-dynamic";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

const SYMBOL_TO_CG_ID: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin",
  XRP: "ripple", ADA: "cardano", DOGE: "dogecoin", AVAX: "avalanche-2",
  MATIC: "matic-network", DOT: "polkadot", LINK: "chainlink", LTC: "litecoin",
  ATOM: "cosmos", UNI: "uniswap", ARB: "arbitrum", OP: "optimism",
};

const SYMBOL_NAMES: Record<string, string> = {
  BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", BNB: "BNB", XRP: "XRP",
  ADA: "Cardano", DOGE: "Dogecoin", AVAX: "Avalanche", MATIC: "Polygon",
  DOT: "Polkadot", LINK: "Chainlink", LTC: "Litecoin", ATOM: "Cosmos",
  UNI: "Uniswap", ARB: "Arbitrum", OP: "Optimism",
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
  sparkline_7d: number[];  // ~30 price points for 7d sparkline
  rank: number;            // market cap rank
};

/** Downsample an array to at most maxPoints by picking evenly-spaced indices. */
function downsample(arr: number[], maxPoints: number): number[] {
  if (arr.length <= maxPoints) return arr;
  const result: number[] = [];
  const step = (arr.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    result.push(arr[Math.round(i * step)]);
  }
  return result;
}

interface CoinGeckoMarketItem {
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  total_volume: number;
  price_change_percentage_24h: number;
  price_change_percentage_7d_in_currency: number;
  image: string;
  sparkline_in_7d: { price: number[] } | null;
  market_cap_rank: number;
}

async function fromBinance(symbols: string[]): Promise<CryptoQuote[]> {
  const binanceSyms = symbols.map(toBinanceSymbol);
  const url =
    binanceSyms.length === 1
      ? `https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSyms[0]}`
      : `https://api.binance.com/api/v3/ticker/24hr?symbols=${JSON.stringify(binanceSyms)}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  const raw = await res.json();
  const arr: Array<Record<string, string>> = Array.isArray(raw) ? raw : [raw];
  return arr.map((t, i) => ({
    symbol: symbols[i] ?? t.symbol.replace("USDT", ""),
    name: SYMBOL_NAMES[symbols[i]] ?? symbols[i],
    price_usd: parseFloat(t.lastPrice),
    change_24h_pct: parseFloat(t.priceChangePercent),
    volume_24h_usd: parseFloat(t.quoteVolume),
    market_cap_usd: 0,   // not available from Binance ticker
    change_7d_pct: 0,     // not available from Binance ticker
    image: "",
    sparkline_7d: [],
    rank: 0,
  }));
}

async function fromCoinGecko(symbols: string[]): Promise<CryptoQuote[]> {
  const ids = symbols.map((s) => SYMBOL_TO_CG_ID[s]).filter(Boolean);
  if (ids.length === 0) return [];
  const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${ids.join(",")}&price_change_percentage=24h,7d&sparkline=true`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const raw = await res.json() as CoinGeckoMarketItem[];
  return raw.map<CryptoQuote>((c) => {
    const rawSparkline = c.sparkline_in_7d?.price ?? [];
    return {
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      price_usd: c.current_price,
      market_cap_usd: c.market_cap,
      volume_24h_usd: c.total_volume,
      change_24h_pct: c.price_change_percentage_24h,
      change_7d_pct: c.price_change_percentage_7d_in_currency,
      image: c.image,
      sparkline_7d: downsample(rawSparkline, 30),
      rank: c.market_cap_rank ?? 0,
    };
  });
}

/** Fetch top 100 by market cap from CoinGecko with sparklines — 5-minute cache. */
async function top100FromCoinGecko(): Promise<CryptoQuote[]> {
  const url =
    `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h,7d`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const raw = await res.json() as CoinGeckoMarketItem[];
  return raw.map<CryptoQuote>((c) => {
    const rawSparkline = c.sparkline_in_7d?.price ?? [];
    return {
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      price_usd: c.current_price,
      market_cap_usd: c.market_cap,
      volume_24h_usd: c.total_volume,
      change_24h_pct: c.price_change_percentage_24h ?? 0,
      change_7d_pct: c.price_change_percentage_7d_in_currency ?? 0,
      image: c.image,
      sparkline_7d: downsample(rawSparkline, 30),
      rank: c.market_cap_rank ?? 0,
    };
  });
}

export async function GET(req: NextRequest) {
  const symbolsParam = req.nextUrl.searchParams.get("symbols");

  // No symbols param → return top 100 by market cap (5-min cache)
  if (!symbolsParam) {
    const result = await withCache(
      "crypto:top100",
      300, // 5 minutes
      "coingecko-top100",
      () => top100FromCoinGecko(),
    );
    return NextResponse.json(result);
  }

  // Specific symbols requested → Binance first, enrich with CoinGecko (2-min cache)
  const symbols = symbolsParam.toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);

  const result = await withCache(
    `crypto:${symbols.sort().join(",")}`,
    120, // 2 minutes
    "binance+coingecko",
    async () => {
      let quotes: CryptoQuote[];
      try {
        quotes = await fromBinance(symbols);
      } catch {
        // Binance unavailable — fall back directly to CoinGecko
        quotes = await fromCoinGecko(symbols);
        return quotes;
      }

      // Enrich with CoinGecko (market cap, 7d change, image, sparkline) — best-effort
      try {
        const cg = await fromCoinGecko(symbols);
        const cgMap: Record<string, CryptoQuote> = {};
        for (const c of cg) cgMap[c.symbol] = c;
        quotes = quotes.map((q) => {
          const enrich = cgMap[q.symbol];
          if (!enrich) return q;
          return {
            ...q,
            market_cap_usd: enrich.market_cap_usd,
            change_7d_pct: enrich.change_7d_pct,
            image: enrich.image,
            name: enrich.name || q.name,
            sparkline_7d: enrich.sparkline_7d,
            rank: enrich.rank,
          };
        });
      } catch {
        // CoinGecko unavailable — use Binance data as-is
      }

      return quotes;
    },
  );

  return NextResponse.json(result);
}
