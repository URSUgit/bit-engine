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
};

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
  }));
}

async function fromCoinGecko(symbols: string[]): Promise<CryptoQuote[]> {
  const ids = symbols.map((s) => SYMBOL_TO_CG_ID[s]).filter(Boolean);
  if (ids.length === 0) return [];
  const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${ids.join(",")}&price_change_percentage=24h,7d`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const raw = await res.json() as Array<{
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
}

export async function GET(req: NextRequest) {
  const symbolsParam = req.nextUrl.searchParams.get("symbols") ?? "BTC,ETH,SOL";
  const symbols = symbolsParam.toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);

  // Binance first (no key, reliable) → CoinGecko for enrichment (market cap, 7d, image)
  const result = await withCache(
    `crypto:${symbols.sort().join(",")}`,
    30,
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

      // Enrich with CoinGecko (market cap, 7d change, image) — best-effort
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
          };
        });
      } catch {
        // CoinGecko unavailable — use Binance data as-is (no market cap / 7d)
      }

      return quotes;
    },
  );

  return NextResponse.json(result);
}

