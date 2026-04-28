// ─── Enums ────────────────────────────────────────────────────────────────────

export type SignalDirection = "buy" | "sell" | "hold";
export type SignalSource = "finbert" | "on_chain" | "twitter" | "reddit" | "telegram" | "technical" | "whale_alert";
export type PositionSide = "long" | "short" | "yes" | "no";
export type RiskLevel = "low" | "medium" | "high";
export type OrderStatus = "pending" | "filled" | "partial" | "cancelled" | "rejected";
export type Protocol = "hyperliquid" | "polymarket" | "gmx" | "drift" | "aevo";

// ─── Trader ───────────────────────────────────────────────────────────────────

export interface TraderStats {
  roi30d: number;
  roi90d: number;
  roiAllTime: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  winRatePct: number;
  avgTradeDurationHours: number;
  totalTrades: number;
  pnlUsd30d: number;
}

export interface Trader {
  id: string;
  walletAddress: string;
  handle?: string;
  avatarUrl?: string;
  protocols: Protocol[];
  riskLevel: RiskLevel;
  stats?: TraderStats;
  followerCount: number;
  verified: boolean;
  lastActive?: string;
  createdAt: string;
}

// ─── Signal ───────────────────────────────────────────────────────────────────

export interface Signal {
  id: string;
  asset: string;
  direction: SignalDirection;
  confidence: number; // 0–1
  source: SignalSource;
  reasoning?: string;
  rawText?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string;
  isActive: boolean;
}

// ─── Position ─────────────────────────────────────────────────────────────────

export interface Position {
  id: string;
  symbol: string;
  side: PositionSide;
  sizeUsd: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  leverage: number;
  protocol: Protocol;
  openedAt: string;
  traderId?: string;
  isCopied: boolean;
}

// ─── Order ────────────────────────────────────────────────────────────────────

export interface Order {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit" | "stop";
  sizeUsd: number;
  price?: number;
  fillPrice?: number;
  filledQty: number;
  status: OrderStatus;
  protocol: Protocol;
  createdAt: string;
  filledAt?: string;
}

// ─── Portfolio ────────────────────────────────────────────────────────────────

export interface Portfolio {
  address: string;
  totalValueUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  positions: Position[];
  dailyPnlPct: number;
  weeklyPnlPct: number;
  monthlyPnlPct: number;
}

// ─── Asset ────────────────────────────────────────────────────────────────────

export interface Asset {
  symbol: string;
  name: string;
  logoUrl?: string;
  price: number;
  priceChange24hPct: number;
  volume24hUsd: number;
  marketCapUsd?: number;
  fundingRate?: number;
  openInterestUsd?: number;
}

// ─── Wallet ───────────────────────────────────────────────────────────────────

export interface WalletInfo {
  address: string;
  chainId: number;
  balances: Record<string, number>; // token symbol → amount
  totalValueUsd: number;
}

// ─── Backtest ─────────────────────────────────────────────────────────────────

export interface BacktestResult {
  id: string;
  strategyName: string;
  startDate: string;
  endDate: string;
  initialCapitalUsd: number;
  finalCapitalUsd: number;
  totalReturnPct: number;
  annualizedReturnPct: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  winRatePct: number;
  totalTrades: number;
  profitFactor: number;
  trades: BacktestTrade[];
}

export interface BacktestTrade {
  symbol: string;
  side: PositionSide;
  entryPrice: number;
  exitPrice: number;
  sizeUsd: number;
  pnlUsd: number;
  pnlPct: number;
  openedAt: string;
  closedAt: string;
  durationHours: number;
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}
