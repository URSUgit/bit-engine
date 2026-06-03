/**
 * Hyperliquid info API client — read-only, fully public, no auth.
 *
 * SECURITY: This module only ever sends a *public* wallet address (0x + 40 hex)
 * to Hyperliquid's public /info endpoint. It never handles private keys. Trade
 * execution (which needs signing) is intentionally NOT implemented here.
 *
 * Docs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api
 */

const HL_INFO = "https://api.hyperliquid.xyz/info";

/** A 0x-prefixed, 40-hex-char Ethereum address. Rejects private keys (64 hex). */
export function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr.trim());
}

/**
 * Guard against private keys being passed where an address is expected.
 * A 64-hex string is a private key — we must never forward it anywhere.
 */
export function looksLikePrivateKey(s: string): boolean {
  return /^0x?[0-9a-fA-F]{64}$/.test(s.trim());
}

async function hlPost<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(HL_INFO, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Hyperliquid HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ── Account state ──────────────────────────────────────────────────────────

export interface HLAssetPosition {
  position: {
    coin: string;
    szi: string;           // signed size (negative = short)
    entryPx?: string;
    positionValue?: string;
    unrealizedPnl?: string;
    returnOnEquity?: string;
    leverage?: { type: string; value: number };
    liquidationPx?: string | null;
    marginUsed?: string;
  };
  type: string;
}

export interface HLClearinghouseState {
  marginSummary?: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  crossMarginSummary?: { accountValue: string; totalMarginUsed: string };
  withdrawable?: string;
  assetPositions?: HLAssetPosition[];
}

export interface AccountPosition {
  coin: string;
  side: "long" | "short";
  size: number;
  entry_price: number;
  position_value: number;
  unrealized_pnl: number;
  roe_pct: number;
  leverage: number;
  liquidation_price: number | null;
  margin_used: number;
}

export interface AccountSummary {
  address: string;
  account_value: number;
  total_margin_used: number;
  total_notional: number;
  withdrawable: number;
  positions: AccountPosition[];
}

function num(v: string | number | undefined | null): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isFinite(n) ? n : 0;
}

export async function getAccountSummary(address: string): Promise<AccountSummary> {
  const state = await hlPost<HLClearinghouseState>({ type: "clearinghouseState", user: address });
  const positions: AccountPosition[] = (state.assetPositions ?? []).map((ap) => {
    const p = ap.position;
    const size = num(p.szi);
    return {
      coin: p.coin,
      side: size >= 0 ? "long" : "short",
      size: Math.abs(size),
      entry_price: num(p.entryPx),
      position_value: num(p.positionValue),
      unrealized_pnl: num(p.unrealizedPnl),
      roe_pct: num(p.returnOnEquity) * 100,
      leverage: p.leverage?.value ?? 1,
      liquidation_price: p.liquidationPx != null ? num(p.liquidationPx) : null,
      margin_used: num(p.marginUsed),
    };
  });
  return {
    address,
    account_value: num(state.marginSummary?.accountValue),
    total_margin_used: num(state.marginSummary?.totalMarginUsed),
    total_notional: num(state.marginSummary?.totalNtlPos),
    withdrawable: num(state.withdrawable),
    positions,
  };
}

// ── Fills (trade history) ────────────────────────────────────────────────────

export interface HLFill {
  coin: string;
  px: string;
  sz: string;
  side: string;       // "B" | "A"
  time: number;
  closedPnl?: string;
  dir?: string;       // e.g. "Open Long", "Close Short"
  fee?: string;
  hash?: string;
}

export interface Fill {
  coin: string;
  price: number;
  size: number;
  side: "buy" | "sell";
  time: number;
  closed_pnl: number;
  direction: string;
  fee: number;
  hash: string;
}

export async function getUserFills(address: string, limit = 100): Promise<Fill[]> {
  const fills = await hlPost<HLFill[]>({ type: "userFills", user: address });
  return (Array.isArray(fills) ? fills : [])
    .slice(0, limit)
    .map((f) => ({
      coin: f.coin,
      price: num(f.px),
      size: num(f.sz),
      side: f.side === "B" ? "buy" : "sell",
      time: f.time,
      closed_pnl: num(f.closedPnl),
      direction: f.dir ?? "",
      fee: num(f.fee),
      hash: f.hash ?? "",
    }));
}

// ── Market data ──────────────────────────────────────────────────────────────

export interface MarketAsset {
  coin: string;
  mid_price: number;
  mark_price: number;
  oracle_price: number;
  funding_rate: number;
  open_interest: number;
  day_volume: number;
  max_leverage: number;
}

interface HLMeta { universe?: { name: string; maxLeverage?: number }[] }
interface HLAssetCtx {
  funding?: string; openInterest?: string; dayNtlVlm?: string;
  midPx?: string; markPx?: string; oraclePx?: string;
}

export async function getMarketData(): Promise<MarketAsset[]> {
  const [meta, ctxs] = await hlPost<[HLMeta, HLAssetCtx[]]>({ type: "metaAndAssetCtxs" });
  const universe = meta.universe ?? [];
  return universe.map((u, i) => {
    const c = ctxs[i] ?? {};
    return {
      coin: u.name,
      mid_price: num(c.midPx),
      mark_price: num(c.markPx),
      oracle_price: num(c.oraclePx),
      funding_rate: num(c.funding),
      open_interest: num(c.openInterest),
      day_volume: num(c.dayNtlVlm),
      max_leverage: u.maxLeverage ?? 0,
    };
  }).filter((m) => m.mid_price > 0 || m.mark_price > 0);
}
