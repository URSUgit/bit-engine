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

// Kraken doesn't list BNB, ARB, OP, UNI — those stay empty until a later source fills them
const SYMBOL_TO_KRAKEN: Record<string, string> = {
  BTC: "XBTUSD", ETH: "ETHUSD", SOL: "SOLUSD", XRP: "XRPUSD",
  ADA: "ADAUSD", DOGE: "XDGUSD", AVAX: "AVAXUSD", MATIC: "MATICUSD",
  DOT: "DOTUSD", LINK: "LINKUSD", LTC: "XLTCZUSD", ATOM: "ATOMUSD",
};

const COINBASE_SYMBOLS = new Set([
  "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX",
  "MATIC", "DOT", "LINK", "LTC", "ATOM", "UNI", "ARB", "OP",
]);

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

function emptyQuote(symbol: string, price = 0): CryptoQuote {
  return {
    symbol,
    name: SYMBOL_NAMES[symbol] ?? symbol,
    price_usd: price,
    market_cap_usd: 0,
    volume_24h_usd: 0,
    change_24h_pct: 0,
    change_7d_pct: 0,
    image: "",
    sparkline_7d: [],
    rank: 0,
  };
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
  // Binance's bulk endpoint does not preserve request order, so match
  // results back to requested symbols by binance symbol, not array index.
  const symbolByBinanceSym = new Map(symbols.map((s, i) => [binanceSyms[i], s]));
  return arr.map((t) => {
    const symbol = symbolByBinanceSym.get(t.symbol) ?? t.symbol.replace("USDT", "");
    return {
      symbol,
      name: SYMBOL_NAMES[symbol] ?? symbol,
      price_usd: parseFloat(t.lastPrice),
      change_24h_pct: parseFloat(t.priceChangePercent),
      volume_24h_usd: parseFloat(t.quoteVolume),
      market_cap_usd: 0,
      change_7d_pct: 0,
      image: "",
      sparkline_7d: [],
      rank: 0,
    };
  });
}

async function fromKraken(symbols: string[]): Promise<CryptoQuote[]> {
  const krakenPairs = symbols
    .map((s) => SYMBOL_TO_KRAKEN[s])
    .filter(Boolean);
  if (krakenPairs.length === 0) return [];

  const res = await fetch(
    `https://api.kraken.com/0/public/Ticker?pair=${krakenPairs.join(",")}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`Kraken HTTP ${res.status}`);
  const { result } = await res.json() as { result: Record<string, Record<string, unknown[]>> };

  return symbols.flatMap((sym) => {
    const kpair = SYMBOL_TO_KRAKEN[sym];
    if (!kpair) return [];
    const base = kpair.replace("USD", "");
    const entry = Object.entries(result ?? {}).find(([k]) => k === kpair || k.includes(base))?.[1];
    if (!entry) return [];
    try {
      const last = parseFloat(String((entry["c"] as string[])[0]));
      const openVal = entry["o"];
      const open24h = Array.isArray(openVal)
        ? parseFloat(String((openVal as string[])[1]))
        : parseFloat(String(openVal));
      const change = open24h > 0 ? ((last - open24h) / open24h) * 100 : 0;
      const vol = parseFloat(String((entry["v"] as string[])[1])) * last;
      return [{
        ...emptyQuote(sym, last),
        change_24h_pct: change,
        volume_24h_usd: vol,
        high_24h: parseFloat(String((entry["h"] as string[])[1])),
        low_24h: parseFloat(String((entry["l"] as string[])[1])),
      } as CryptoQuote];
    } catch {
      return [];
    }
  });
}

async function fromCoinbase(symbols: string[]): Promise<CryptoQuote[]> {
  const eligible = symbols.filter((s) => COINBASE_SYMBOLS.has(s));
  if (eligible.length === 0) return [];
  const results = await Promise.allSettled(
    eligible.map(async (sym) => {
      const res = await fetch(`https://api.coinbase.com/v2/prices/${sym}-USD/spot`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Coinbase ${sym} HTTP ${res.status}`);
      const { data } = await res.json() as { data: { amount: string } };
      return emptyQuote(sym, parseFloat(data.amount));
    }),
  );
  return results
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((q): q is CryptoQuote => q !== null && q.price_usd > 0);
}

/** Try sources in order; merge so later sources only fill symbols still missing. */
async function fetchSymbols(symbols: string[]): Promise<CryptoQuote[]> {
  const out = new Map<string, CryptoQuote>();

  const missing = () => symbols.filter((s) => !out.has(s) || out.get(s)!.price_usd <= 0);

  // 1. Binance
  try {
    const quotes = await fromBinance(symbols);
    for (const q of quotes) if (q.price_usd > 0) out.set(q.symbol, q);
  } catch { /* continue */ }

  if (missing().length === 0) {
    // Enrich with CoinGecko for market cap / sparklines — best effort
    try {
      const cg = await fromCoinGecko(symbols);
      for (const c of cg) {
        const base = out.get(c.symbol);
        if (base) out.set(c.symbol, { ...base, market_cap_usd: c.market_cap_usd, change_7d_pct: c.change_7d_pct, image: c.image, sparkline_7d: c.sparkline_7d, rank: c.rank });
      }
    } catch { /* use Binance data as-is */ }
    return symbols.map((s) => out.get(s) ?? emptyQuote(s));
  }

  // 2. CoinGecko for remaining
  try {
    const cg = await fromCoinGecko(missing());
    for (const q of cg) if (q.price_usd > 0) out.set(q.symbol, q);
  } catch { /* continue */ }

  // 3. Kraken
  if (missing().length > 0) {
    try {
      const kr = await fromKraken(missing());
      for (const q of kr) if (q.price_usd > 0) out.set(q.symbol, q);
    } catch { /* continue */ }
  }

  // 4. Coinbase (last resort)
  if (missing().length > 0) {
    try {
      const cb = await fromCoinbase(missing());
      for (const q of cb) if (q.price_usd > 0) out.set(q.symbol, q);
    } catch { /* continue */ }
  }

  return symbols.map((s) => out.get(s) ?? emptyQuote(s));
}

/** Fetch top 100 by market cap from CoinGecko with sparklines — 5-minute cache.
 *  Falls back to our 16 known coins via Kraken/Coinbase if CoinGecko is blocked. */
async function top100(): Promise<CryptoQuote[]> {
  // Try CoinGecko full top-100
  try {
    const url =
      `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h,7d`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const raw = await res.json() as CoinGeckoMarketItem[];
    if (raw.length > 0) {
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
  } catch { /* fall through */ }

  // Fallback: return the 16 known coins via Binance/Kraken/Coinbase
  const known = Object.keys(SYMBOL_NAMES);
  return fetchSymbols(known);
}

export async function GET(req: NextRequest) {
  const symbolsParam = req.nextUrl.searchParams.get("symbols");

  // No symbols param → return top 100 by market cap (5-min cache)
  if (!symbolsParam) {
    const result = await withCache("crypto:top100", 300, "multi-source", top100);
    return NextResponse.json(result);
  }

  // Specific symbols requested — multi-source with Binance → CoinGecko → Kraken → Coinbase
  const symbols = symbolsParam.toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
  const result = await withCache(
    `crypto:${symbols.sort().join(",")}`,
    120,
    "multi-source",
    () => fetchSymbols(symbols),
  );

  return NextResponse.json(result);
}

