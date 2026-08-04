/**
 * Smart API client.
 *
 * Tries the signal-service first; if unreachable, falls back to mock data
 * so the frontend can be developed standalone.
 */

import {
  mockTraders,
  mockSignals,
  mockPositions,
  mockPortfolio,
  mockAssets,
  generateOrderBook,
  mockBacktestResult,
} from "./mock-data";
import type { Signal } from "@bitprivat/shared-types";

const SIGNAL_BASE =
  process.env.NEXT_PUBLIC_SIGNAL_SERVICE_URL ?? "http://localhost:8001";
const GATEWAY_BASE =
  process.env.NEXT_PUBLIC_API_GATEWAY_URL ?? "http://localhost:8080";

const FETCH_TIMEOUT_MS = 3_000;

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new ApiError(res.status, body || res.statusText);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function withFallback<T>(url: string, mock: T, init?: RequestInit): Promise<T> {
  try {
    return await request<T>(url, init);
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408) {
      throw err;
    }
    if (typeof window !== "undefined") {
      console.warn(`[api] ${url} → falling back to mock data (${(err as Error).message})`);
    }
    return mock;
  }
}

// signal-service returns snake_case JSON; the shared Signal type is camelCase.
function normalizeSignal(raw: any): Signal {
  return {
    ...raw,
    rawText: raw.rawText ?? raw.raw_text,
    createdAt: raw.createdAt ?? raw.created_at,
    expiresAt: raw.expiresAt ?? raw.expires_at,
    isActive: raw.isActive ?? raw.is_active,
  };
}

export const api = {
  // ─── Traders ────────────────────────────────────────────────────────────────
  traders: {
    list: (params?: Record<string, string>) => {
      const q = params ? `?${new URLSearchParams(params)}` : "";
      return withFallback(`${GATEWAY_BASE}/api/v1/traders${q}`, mockTraders);
    },
    get: (id: string) =>
      withFallback(`${GATEWAY_BASE}/api/v1/traders/${id}`, mockTraders.find((t) => t.id === id) ?? mockTraders[0]),
    leaderboard: (period: "7d" | "30d" | "90d" = "30d") =>
      withFallback(`${GATEWAY_BASE}/api/v1/traders/leaderboard?period=${period}`, mockTraders),
  },

  // ─── Signals (real from signal-service) ────────────────────────────────────
  signals: {
    list: (params?: Record<string, string>) => {
      const q = params ? `?${new URLSearchParams(params)}` : "";
      return withFallback(`${SIGNAL_BASE}/api/v1/signals${q}`, mockSignals).then((s) =>
        s.map(normalizeSignal)
      );
    },
    latest: () =>
      withFallback(`${SIGNAL_BASE}/api/v1/signals/latest`, mockSignals.slice(0, 10)).then((s) =>
        s.map(normalizeSignal)
      ),
  },

  // ─── Markets ────────────────────────────────────────────────────────────────
  markets: {
    list: () => withFallback(`${GATEWAY_BASE}/api/v1/markets`, mockAssets),
    get: (symbol: string) => {
      const base = symbol.split("-")[0];
      const m = mockAssets.find((a) => a.symbol === symbol || a.symbol === base) ?? mockAssets[0];
      return withFallback(`${GATEWAY_BASE}/api/v1/markets/${symbol}`, m);
    },
    orderBook: (symbol: string) => {
      const base = symbol.split("-")[0];
      const m = mockAssets.find((a) => a.symbol === symbol || a.symbol === base) ?? mockAssets[0];
      return withFallback(`${GATEWAY_BASE}/api/v1/markets/${symbol}/orderbook`, generateOrderBook(m!.price));
    },
  },

  // ─── Analytics (signal-service) ────────────────────────────────────────────
  analytics: {
    prices: (assetClass = "crypto") =>
      withFallback(`${SIGNAL_BASE}/api/v1/analytics/prices?asset_class=${assetClass}`, []),
    sentiment: (asset: string) =>
      withFallback(`${SIGNAL_BASE}/api/v1/analytics/sentiment/${asset}`, null),
    onChain: (asset: string) =>
      withFallback(`${SIGNAL_BASE}/api/v1/analytics/on-chain/${asset}`, null),
    correlation: (symbols: string[]) =>
      withFallback(`${SIGNAL_BASE}/api/v1/analytics/correlation?symbols=${symbols.join(",")}`, null),
  },

  // ─── Portfolio (auth required) ──────────────────────────────────────────────
  portfolio: {
    get: (token?: string) =>
      withFallback(`${GATEWAY_BASE}/api/v1/portfolio`, mockPortfolio, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }),
    positions: (token?: string) =>
      withFallback(`${GATEWAY_BASE}/api/v1/portfolio/positions`, mockPositions, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }),
  },

  // ─── Auth (SIWE) ────────────────────────────────────────────────────────────
  auth: {
    nonce: (address: string) =>
      request<{ nonce: string; issuedAt: string }>(`${GATEWAY_BASE}/api/v1/auth/nonce?address=${address}`),
    verify: (params: { address: string; signature: string; message: string; nonce: string }) =>
      request<{ accessToken: string; user: { address: string; id: string } }>(
        `${GATEWAY_BASE}/api/v1/auth/verify`,
        { method: "POST", body: JSON.stringify(params) },
      ),
  },

  // ─── Backtest ───────────────────────────────────────────────────────────────
  backtest: {
    run: () => withFallback(`${SIGNAL_BASE}/api/v1/backtest/run`, mockBacktestResult, { method: "POST" }),
  },

  // ─── AI Agent (signal-service direct) ───────────────────────────────────────
  agent: {
    chat: (message: string, sessionId?: string) => {
      const body: Record<string, string> = { message };
      if (sessionId) body.session_id = sessionId;
      return request<{ session_id: string; answer: string; thoughts: string[]; tool_calls: unknown[] }>(
        `${SIGNAL_BASE}/api/v1/agent/chat`,
        { method: "POST", body: JSON.stringify(body) },
      );
    },
    clearSession: (sessionId: string) =>
      fetch(`${SIGNAL_BASE}/api/v1/agent/session/${sessionId}`, { method: "DELETE" }),
  },
};
