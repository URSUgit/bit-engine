/**
 * Browser-callable client for /api/market/* route handlers.
 * All calls go through Next.js server routes — no API keys ever reach the browser.
 */

import type { CryptoQuote } from "@/app/api/market/crypto/route";
import type { StockQuote } from "@/app/api/market/stocks/quote/route";
import type { DailyBar } from "@/app/api/market/stocks/daily/route";
import type { Fundamentals } from "@/app/api/market/stocks/fundamentals/route";
import type { CompanyProfile } from "@/app/api/market/stocks/profile/route";
import type { EarningEvent } from "@/app/api/market/stocks/earnings/route";
import type { EarningsHistory } from "@/app/api/market/stocks/earnings-history/route";
import type { SearchResult } from "@/app/api/market/stocks/search/route";
import type { Financials } from "@/app/api/market/stocks/financials/route";
import type { DividendRecord } from "@/app/api/market/stocks/dividends/route";
import type { IntradayBar } from "@/app/api/market/stocks/intraday/route";
import type { Technicals } from "@/app/api/market/stocks/technicals/route";
import type { ForexRates } from "@/app/api/market/forex/live/route";
import type { ForexBar } from "@/app/api/market/forex/historical/route";
import type { MacroSeries } from "@/app/api/market/macro/route";
import type { EconomicSeries } from "@/app/api/market/economic/route";
import type { CommoditySeries } from "@/app/api/market/commodities/route";
import type { NewsArticle } from "@/app/api/market/news/route";
import type { Movers } from "@/app/api/market/movers/route";
import type { IpoEntry } from "@/app/api/market/ipo/route";

export type ApiEnvelope<T> = {
  data: T | null;
  source: string;
  cachedAt: string;
  error?: string;
};

async function get<T>(url: string): Promise<ApiEnvelope<T>> {
  const res = await fetch(url, { cache: "no-store" });
  return (await res.json()) as ApiEnvelope<T>;
}

export const marketApi = {
  // ─── Crypto ────────────────────────────────────────────────────────────────
  crypto: (symbols: string[]) =>
    get<CryptoQuote[]>(`/api/market/crypto?symbols=${symbols.join(",")}`),

  // ─── Stocks ────────────────────────────────────────────────────────────────
  stocks: {
    quote: (symbol: string, market: "US" | "GLOBAL" = "US") =>
      get<StockQuote>(`/api/market/stocks/quote?symbol=${symbol}&market=${market}`),

    daily: (symbol: string, full = false) =>
      get<DailyBar[]>(`/api/market/stocks/daily?symbol=${symbol}&compact=${!full}`),

    intraday: (symbol: string, interval: "1min" | "5min" | "15min" | "30min" | "60min" = "5min", extended = false) =>
      get<IntradayBar[]>(`/api/market/stocks/intraday?symbol=${symbol}&interval=${interval}&extended=${extended}`),

    fundamentals: (symbol: string) =>
      get<Fundamentals>(`/api/market/stocks/fundamentals?symbol=${symbol}`),

    financials: (symbol: string) =>
      get<Financials>(`/api/market/stocks/financials?symbol=${symbol}`),

    profile: (symbol: string) =>
      get<CompanyProfile>(`/api/market/stocks/profile?symbol=${symbol}`),

    earnings: (symbol = "", from?: string, to?: string) => {
      const p = new URLSearchParams();
      if (symbol) p.set("symbol", symbol);
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      return get<EarningEvent[]>(`/api/market/stocks/earnings?${p.toString()}`);
    },

    earningsHistory: (symbol: string) =>
      get<EarningsHistory>(`/api/market/stocks/earnings-history?symbol=${symbol}`),

    dividends: (symbol: string) =>
      get<DividendRecord[]>(`/api/market/stocks/dividends?symbol=${symbol}`),

    technicals: (symbol: string, interval = "daily") =>
      get<Technicals>(`/api/market/stocks/technicals?symbol=${symbol}&interval=${interval}`),

    search: (q: string) =>
      get<SearchResult[]>(`/api/market/stocks/search?q=${encodeURIComponent(q)}`),
  },

  // ─── Forex ─────────────────────────────────────────────────────────────────
  forex: {
    live: (symbols?: string[]) =>
      get<ForexRates>(`/api/market/forex/live${symbols ? `?symbols=${symbols.join(",")}` : ""}`),
    historical: (from: string, to: string, full = false) =>
      get<ForexBar[]>(`/api/market/forex/historical?from=${from}&to=${to}&compact=${!full}`),
  },

  // ─── Macro / Economic ──────────────────────────────────────────────────────
  macro: (series?: string[], limit = 60) => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (series) p.set("series", series.join(","));
    return get<MacroSeries[]>(`/api/market/macro?${p.toString()}`);
  },

  economic: (series?: string[]) => {
    const p = new URLSearchParams();
    if (series) p.set("series", series.join(","));
    return get<EconomicSeries[]>(`/api/market/economic?${p.toString()}`);
  },

  // ─── Commodities ───────────────────────────────────────────────────────────
  commodities: (commodities?: string[], interval = "monthly") => {
    const p = new URLSearchParams({ interval });
    if (commodities) p.set("commodities", commodities.join(","));
    return get<CommoditySeries[]>(`/api/market/commodities?${p.toString()}`);
  },

  // ─── News & Sentiment ──────────────────────────────────────────────────────
  news: (opts: { tickers?: string; topics?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (opts.tickers) p.set("tickers", opts.tickers);
    if (opts.topics) p.set("topics", opts.topics);
    if (opts.limit) p.set("limit", String(opts.limit));
    return get<NewsArticle[]>(`/api/market/news?${p.toString()}`);
  },

  // ─── Market Events ─────────────────────────────────────────────────────────
  movers: () => get<Movers>(`/api/market/movers`),
  ipo: () => get<IpoEntry[]>(`/api/market/ipo`),
};

export type {
  CryptoQuote, StockQuote, DailyBar, Fundamentals, CompanyProfile,
  EarningEvent, EarningsHistory, SearchResult, Financials, DividendRecord,
  IntradayBar, Technicals, ForexRates, ForexBar, MacroSeries, EconomicSeries,
  CommoditySeries, NewsArticle, Movers, IpoEntry,
};
