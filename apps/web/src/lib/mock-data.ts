/**
 * Realistic mock data used as a fallback when the API gateway is offline,
 * and as the source of truth for any view that hasn't been wired to live data yet.
 *
 * Every entity here matches the shape declared in @bitprivat/shared-types.
 */

import type {
  Trader,
  Signal,
  Position,
  Asset,
  Portfolio,
  SignalDirection,
  SignalSource,
  RiskLevel,
  Protocol,
} from "@bitprivat/shared-types";

// ─── Deterministic RNG so re-renders don't shuffle data ──────────────────────
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)] as T;
}
function range(min: number, max: number, decimals = 0): number {
  const v = min + rand() * (max - min);
  return +v.toFixed(decimals);
}

// ─── TRADERS ─────────────────────────────────────────────────────────────────

const traderHandles = [
  "0xAlpha.eth", "defiwhale", "polyking", "sigmatrade.eth", "chainmaxi",
  "perp_pilgrim", "0xVeritas", "yield.eth", "chrono.lens", "shorting_god",
  "trend.captain", "tape.reader", "liqhunter.eth", "alpha.minimal", "quantbro",
  "macro.dad", "delta.ninja", "vega.queen", "0xStarLord", "BlockBard",
  "leverage.lover", "midcurve.eth", "bigbrain.lab", "satoshi.disciple", "moneymouth.eth",
  "rektpilled", "fader.fade", "diamond.glove", "0xVisigoth", "moonbase.alpha",
  "permabull.dao", "permabear.dao", "ironcondor.eth", "gamma.giant", "theta.gang",
  "0xMercury", "evergreen.cap", "phoenix.fund", "obsidian.eth", "asymmetric.bet",
];

const protocols: Protocol[] = ["hyperliquid", "polymarket", "drift", "gmx", "aevo"];
const riskLevels: RiskLevel[] = ["low", "medium", "high"];
const avatarColors = [
  "from-cyan-500 to-blue-600",
  "from-violet-500 to-purple-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-pink-500 to-rose-600",
  "from-blue-500 to-indigo-600",
  "from-fuchsia-500 to-pink-600",
  "from-lime-500 to-emerald-600",
];

function generateAddress(seed: number): string {
  const hex = "0123456789abcdef";
  let out = "0x";
  let s = seed;
  for (let i = 0; i < 40; i++) {
    s = (s * 9301 + 49297) % 233280;
    out += hex[s % 16];
  }
  return out;
}

export interface MockTrader extends Trader {
  avatarColor: string;
  badge?: "verified" | "elite";
}

export const mockTraders: MockTrader[] = traderHandles.map((handle, i) => {
  const roi30 = range(-15, 320, 1);
  const winRate = range(45, 82, 1);
  return {
    id: `trader-${i + 1}`,
    walletAddress: generateAddress(i + 1),
    handle,
    avatarUrl: undefined,
    avatarColor: avatarColors[i % avatarColors.length] as string,
    protocols: [pick(protocols)] as Protocol[],
    riskLevel: pick(riskLevels) as RiskLevel,
    followerCount: Math.floor(range(120, 5000)),
    verified: i < 20,
    badge: (i < 5 ? "elite" : i < 20 ? "verified" : undefined) as MockTrader["badge"],
    lastActive: new Date(Date.now() - Math.floor(rand() * 3600_000)).toISOString(),
    createdAt: new Date(Date.now() - i * 86_400_000).toISOString(),
    stats: {
      roi30d: roi30,
      roi90d: roi30 * range(1.5, 2.5, 2),
      roiAllTime: roi30 * range(2, 5, 2),
      sharpeRatio: range(0.4, 4.2, 2),
      maxDrawdownPct: range(5, 35, 1),
      winRatePct: winRate,
      avgTradeDurationHours: range(0.5, 72, 1),
      totalTrades: Math.floor(range(50, 5_000)),
      pnlUsd30d: roi30 * range(800, 5_000, 0),
    },
  };
}).sort((a, b) => (b.stats?.roi30d ?? 0) - (a.stats?.roi30d ?? 0));

// ─── ASSETS / MARKETS ────────────────────────────────────────────────────────

export interface MockAsset extends Asset {
  protocol: Protocol;
  category: "perp" | "spot" | "prediction";
  sparkline: number[];
}

const assetSeed: Array<[string, string, number, "perp" | "spot" | "prediction", Protocol]> = [
  ["BTC",   "Bitcoin",            67_842.50, "perp", "hyperliquid"],
  ["ETH",   "Ethereum",            3_412.18, "perp", "hyperliquid"],
  ["SOL",   "Solana",                178.42, "perp", "hyperliquid"],
  ["ARB",   "Arbitrum",                1.24, "perp", "hyperliquid"],
  ["OP",    "Optimism",                2.41, "perp", "hyperliquid"],
  ["AVAX",  "Avalanche",              38.21, "perp", "hyperliquid"],
  ["LINK",  "Chainlink",              14.82, "perp", "hyperliquid"],
  ["MATIC", "Polygon",                 0.71, "perp", "hyperliquid"],
  ["DOGE",  "Dogecoin",                0.182,"perp", "hyperliquid"],
  ["INJ",   "Injective",              27.40, "perp", "drift"],
  ["TIA",   "Celestia",                8.94, "perp", "drift"],
  ["SEI",   "Sei",                     0.84, "perp", "drift"],
  ["SUI",   "Sui",                     1.31, "perp", "drift"],
  ["APT",   "Aptos",                   9.18, "perp", "drift"],
  ["RNDR",  "Render",                  9.42, "perp", "hyperliquid"],
  ["ATOM",  "Cosmos",                  8.41, "perp", "hyperliquid"],
  ["NEAR",  "Near",                    6.23, "perp", "hyperliquid"],
  ["FIL",   "Filecoin",                4.92, "perp", "hyperliquid"],
  ["LTC",   "Litecoin",               79.41, "perp", "hyperliquid"],
  ["XRP",   "XRP",                     0.62, "perp", "hyperliquid"],
  ["UNI",   "Uniswap",                 8.41, "spot", "hyperliquid"],
  ["AAVE",  "Aave",                  102.42, "spot", "hyperliquid"],
  ["MKR",   "Maker",                2_410.00,"spot", "hyperliquid"],
  ["LDO",   "Lido DAO",                2.18, "spot", "hyperliquid"],
  ["CRV",   "Curve",                   0.49, "spot", "hyperliquid"],
  ["TRUMP-2024", "Trump wins 2024",    0.51, "prediction", "polymarket"],
  ["FED-CUT-MAR", "Fed cut in March",  0.34, "prediction", "polymarket"],
  ["BTC-100K-EOY", "BTC ≥ $100k EOY",  0.68, "prediction", "polymarket"],
  ["ETH-FLIP", "ETH flips BTC by 2026",0.08, "prediction", "polymarket"],
  ["SUPER-BOWL-KC", "Chiefs win SB",   0.42, "prediction", "polymarket"],
];

function genSparkline(seed: number, base: number): number[] {
  const r = mulberry32(seed);
  let v = base;
  return Array.from({ length: 24 }, () => {
    v = v * (1 + (r() - 0.5) * 0.04);
    return +v.toFixed(4);
  });
}

export const mockAssets: MockAsset[] = assetSeed.map(([symbol, name, price, category, protocol], i) => ({
  symbol,
  name,
  price,
  priceChange24hPct: range(-8, 12, 2),
  volume24hUsd: Math.floor(range(1_000_000, 800_000_000)),
  marketCapUsd: category === "prediction" ? undefined : Math.floor(range(50_000_000, 1_200_000_000_000)),
  fundingRate: category === "perp" ? range(-0.04, 0.08, 4) : undefined,
  openInterestUsd: category === "perp" ? Math.floor(range(5_000_000, 1_200_000_000)) : undefined,
  protocol,
  category,
  sparkline: genSparkline(i + 1, price),
}));

// ─── SIGNALS ─────────────────────────────────────────────────────────────────

const signalSources: SignalSource[] = ["finbert", "on_chain", "twitter", "reddit", "telegram", "technical", "whale_alert"];
const signalDirections: SignalDirection[] = ["buy", "sell", "hold"];
const signalAssets = ["BTC", "ETH", "SOL", "ARB", "OP", "AVAX", "DOGE", "TIA", "SUI", "INJ", "LINK", "RNDR"];

const signalReasonings: Record<SignalSource, string[]> = {
  finbert: [
    "Cluster of bullish FinBERT-scored articles in last 4h (avg 0.84)",
    "Negative sentiment spike across CT — short squeeze risk",
    "FinBERT flagged accumulation language across 12 reports",
  ],
  on_chain: [
    "8 whale wallets accumulated 14k tokens in last 6h",
    "Net exchange outflow of $42M over 24h",
    "Smart-money cohort rotated from stables into asset",
  ],
  twitter: [
    "@cobie + @hsaka mentions spiked 8x baseline",
    "Tier-1 KOL coverage acceleration — narrative crystallizing",
  ],
  reddit: [
    "r/cryptocurrency mentions up 340% w/w",
    "DD post on r/CryptoMoonShots crossed 2k upvotes in 3h",
  ],
  telegram: ["Premium TG group accumulation calls aligned"],
  technical: [
    "Bullish MACD cross on 4h with rising volume",
    "Failed breakdown below 200d MA with reclaim",
  ],
  whale_alert: [
    "$8.4M USDC → asset swap on 1inch by known whale",
    "Coinbase Prime deposit flagged: 4,200 ETH",
  ],
};

export const mockSignals: Signal[] = Array.from({ length: 30 }, (_, i) => {
  const source = pick(signalSources);
  return {
    id: `signal-${i + 1}`,
    asset: pick(signalAssets),
    direction: pick(signalDirections),
    confidence: range(0.55, 0.97, 2),
    source,
    reasoning: pick(signalReasonings[source]),
    rawText: undefined,
    metadata: {},
    createdAt: new Date(Date.now() - i * 60_000 * range(1, 30)).toISOString(),
    expiresAt: new Date(Date.now() + 4 * 60 * 60_000).toISOString(),
    isActive: rand() > 0.15,
  };
}).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

// ─── POSITIONS ───────────────────────────────────────────────────────────────

const positionAssets = ["ETH-USD", "BTC-USD", "SOL-USD", "ARB-USD", "DOGE-USD", "SUI-USD", "TIA-USD", "TRUMP-2024", "FED-CUT-MAR"];

export const mockPositions: Position[] = Array.from({ length: 20 }, (_, i) => {
  const symbol = pick(positionAssets);
  const side = rand() > 0.4 ? "long" : "short";
  const entry = range(0.4, 70_000, 4);
  const current = entry * (1 + (rand() - 0.45) * 0.1);
  const sizeUsd = Math.floor(range(500, 12_000));
  const pnlPct = (current / entry - 1) * 100 * (side === "long" ? 1 : -1);
  return {
    id: `pos-${i + 1}`,
    symbol,
    side: side === "long" ? "long" : "short",
    sizeUsd,
    entryPrice: +entry.toFixed(4),
    currentPrice: +current.toFixed(4),
    unrealizedPnl: +(sizeUsd * pnlPct / 100).toFixed(2),
    unrealizedPnlPct: +pnlPct.toFixed(2),
    leverage: pick([1, 2, 3, 5, 10] as const),
    protocol: pick(["hyperliquid", "polymarket", "drift"] as const) as Protocol,
    openedAt: new Date(Date.now() - i * 3_600_000).toISOString(),
    traderId: i % 3 === 0 ? mockTraders[i % mockTraders.length]?.id : undefined,
    isCopied: i % 3 === 0,
  };
});

// ─── PORTFOLIO ────────────────────────────────────────────────────────────────

export const mockPortfolio: Portfolio = {
  address: "0x4f3a2e8f1c9d5b6a4e3f2c1d0b9a8e7f6c5d4b29e",
  totalValueUsd: 48_320.00,
  unrealizedPnlUsd: 3_812.40,
  realizedPnlUsd: 12_840.50,
  positions: mockPositions.slice(0, 7),
  dailyPnlPct: 5.84,
  weeklyPnlPct: 12.4,
  monthlyPnlPct: 38.7,
};

// ─── ORDER BOOK (for /markets/:symbol) ───────────────────────────────────────

export interface OrderBookLevel {
  price: number;
  size: number;
  total: number;
}

export function generateOrderBook(midPrice: number): { bids: OrderBookLevel[]; asks: OrderBookLevel[] } {
  const r = mulberry32(Math.floor(midPrice));
  const tick = midPrice * 0.0001;
  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];
  let bidTotal = 0;
  let askTotal = 0;
  for (let i = 0; i < 15; i++) {
    const bidSize = +(r() * 50 + 5).toFixed(2);
    const askSize = +(r() * 50 + 5).toFixed(2);
    bidTotal += bidSize;
    askTotal += askSize;
    bids.push({
      price: +(midPrice - tick * (i + 1) * (1 + r() * 0.5)).toFixed(4),
      size: bidSize,
      total: +bidTotal.toFixed(2),
    });
    asks.push({
      price: +(midPrice + tick * (i + 1) * (1 + r() * 0.5)).toFixed(4),
      size: askSize,
      total: +askTotal.toFixed(2),
    });
  }
  return { bids, asks };
}

// ─── BACKTEST RESULT ─────────────────────────────────────────────────────────

export const mockBacktestResult = {
  id: "bt-1",
  strategyName: "Momentum Breakout v2",
  startDate: "2024-01-01",
  endDate: "2024-06-01",
  initialCapitalUsd: 10_000,
  finalCapitalUsd: 14_820,
  totalReturnPct: 48.2,
  annualizedReturnPct: 116.4,
  sharpeRatio: 2.41,
  maxDrawdownPct: 12.8,
  winRatePct: 64.3,
  totalTrades: 184,
  profitFactor: 2.18,
  trades: [],
};
