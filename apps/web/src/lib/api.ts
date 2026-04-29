/**
 * Smart API client.
 *
 * Tries the real gateway first; if it's unreachable, falls back to mock data
 * so the frontend can be developed and demoed standalone. Console-warns on
 * every fallback so developers know when the gateway is down.
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

const BASE = process.env.NEXT_PUBLIC_API_GATEWAY_URL ?? "http://localhost:8080";

// 1.5s ceiling — if the gateway is offline we don't want loading spinners forever.
const FETCH_TIMEOUT_MS = 1_500;

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE}${path}`, {
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

/**
 * Wrap a request so it falls back to a mock response when the gateway is
 * unreachable. Network errors and 5xx will fall through to the mock; auth
 * (401/403) and 4xx errors propagate so calling code can handle them.
 */
async function withFallback<T>(path: string, mock: T, init?: RequestInit): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408) {
      throw err;
    }
    if (typeof window !== "undefined") {
      console.warn(`[api] ${path} → falling back to mock data (${(err as Error).message})`);
    }
    return mock;
  }
}

export const api = {
  // ─── Traders ────────────────────────────────────────────────────────────────
  traders: {
    list: (params?: Record<string, string>) => {
      const q = params ? `?${new URLSearchParams(params)}` : "";
      return withFallback(`/api/v1/traders${q}`, mockTraders);
    },
    get: (id: string) =>
      withFallback(`/api/v1/traders/${id}`, mockTraders.find((t) => t.id === id) ?? mockTraders[0]),
    leaderboard: (period: "7d" | "30d" | "90d" = "30d") =>
      withFallback(`/api/v1/traders/leaderboard?period=${period}`, mockTraders),
  },

  // ─── Signals ────────────────────────────────────────────────────────────────
  signals: {
    list: (params?: Record<string, string>) => {
      const q = params ? `?${new URLSearchParams(params)}` : "";
      return withFallback(`/api/v1/signals${q}`, mockSignals);
    },
    latest: () => withFallback("/api/v1/signals/latest", mockSignals.slice(0, 10)),
  },

  // ─── Markets ────────────────────────────────────────────────────────────────
  markets: {
    list: () => withFallback("/api/v1/markets", mockAssets),
    get: (symbol: string) => {
      const m = mockAssets.find((a) => a.symbol === symbol) ?? mockAssets[0];
      return withFallback(`/api/v1/markets/${symbol}`, m);
    },
    orderBook: (symbol: string) => {
      const m = mockAssets.find((a) => a.symbol === symbol) ?? mockAssets[0];
      return withFallback(`/api/v1/markets/${symbol}/orderbook`, generateOrderBook(m!.price));
    },
  },

  // ─── Portfolio (auth required) ──────────────────────────────────────────────
  portfolio: {
    get: (token?: string) =>
      withFallback("/api/v1/portfolio", mockPortfolio, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }),
    positions: (token?: string) =>
      withFallback("/api/v1/portfolio/positions", mockPositions, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }),
  },

  // ─── Auth (SIWE) ────────────────────────────────────────────────────────────
  auth: {
    nonce: (address: string) =>
      request<{ nonce: string; issuedAt: string }>(`/api/v1/auth/nonce?address=${address}`),
    verify: (params: { address: string; signature: string; message: string; nonce: string }) =>
      request<{ accessToken: string; user: { address: string; id: string } }>(
        "/api/v1/auth/verify",
        { method: "POST", body: JSON.stringify(params) }
      ),
  },

  // ─── Backtest ───────────────────────────────────────────────────────────────
  backtest: {
    run: () => withFallback("/api/v1/backtest", mockBacktestResult, { method: "POST" }),
  },
};
