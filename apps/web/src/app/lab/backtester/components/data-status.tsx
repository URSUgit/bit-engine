"use client";

import { useCallback, useEffect, useState } from "react";
import { backtestApi, type CachedSeries, type CacheStatus } from "@/lib/backtest-api";
import { isoDaysAgo } from "./shared";

const CRYPTO_SYMBOLS = new Set([
  "BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD", "XRP-USD", "ADA-USD",
  "DOGE-USD", "AVAX-USD", "DOT-USD", "MATIC-USD", "LINK-USD", "LTC-USD",
]);

function inferSource(symbol: string): string {
  return CRYPTO_SYMBOLS.has(symbol) ? "Yahoo + Binance fallback" : "Yahoo Finance";
}

function formatFreshness(lastFetchedAt: number | null): string {
  if (lastFetchedAt === null) return "never";
  const ageSeconds = Math.floor(Date.now() / 1000) - lastFetchedAt;
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ago`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h ago`;
  return `${Math.floor(ageSeconds / 86400)}d ago`;
}

function formatLastRefresh(series: CachedSeries[]): string {
  const timestamps = series
    .map((s) => s.last_fetched_at)
    .filter((t): t is number => t !== null);
  if (timestamps.length === 0) return "never";
  const latest = Math.max(...timestamps);
  return formatFreshness(latest);
}

const PERIOD_OPTIONS = [
  { label: "1y", days: 365 },
  { label: "5y", days: 365 * 5 },
  { label: "10y", days: 365 * 10 },
];

const INTERVAL_OPTIONS = ["1d", "1wk"];

export function DataStatusTab({ onSymbolAdded }: { onSymbolAdded: (symbol: string) => void }) {
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Custom symbol input state
  const [customTicker, setCustomTicker] = useState("");
  const [customPeriodDays, setCustomPeriodDays] = useState(365 * 5);
  const [customInterval, setCustomInterval] = useState("1d");
  const [fetchingCustom, setFetchingCustom] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);
  const [customSuccess, setCustomSuccess] = useState<string | null>(null);

  const fetchCache = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await backtestApi.cache();
      setCacheStatus(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCache();
  }, [fetchCache]);

  async function handleRefresh(series: CachedSeries) {
    const key = `${series.symbol}-${series.interval}-refresh`;
    setActionInProgress(key);
    try {
      // Use a wide date range so we re-fetch as much as possible
      await backtestApi.refreshData(
        series.symbol,
        series.earliest ?? isoDaysAgo(365 * 10),
        undefined,
        series.interval,
      );
      await fetchCache();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleClear(series: CachedSeries) {
    const key = `${series.symbol}-${series.interval}-clear`;
    setActionInProgress(key);
    try {
      await backtestApi.clearCache(series.symbol, series.interval);
      await fetchCache();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleFetchCustom() {
    const ticker = customTicker.trim().toUpperCase();
    if (!ticker) { setCustomError("Enter a ticker symbol"); return; }
    setFetchingCustom(true);
    setCustomError(null);
    setCustomSuccess(null);
    try {
      const result = await backtestApi.data(
        ticker,
        isoDaysAgo(customPeriodDays),
        undefined,
        customInterval,
      );
      if (result.count === 0) {
        setCustomError(`No bars returned for ${ticker}. Check the ticker is valid on Yahoo Finance.`);
      } else {
        setCustomSuccess(`Fetched ${result.count.toLocaleString()} bars for ${ticker}`);
        onSymbolAdded(ticker);
        setCustomTicker("");
        await fetchCache();
      }
    } catch (e) {
      setCustomError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetchingCustom(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center text-zinc-400 text-sm">
        Loading cache status…
      </div>
    );
  }

  if (error && !cacheStatus) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center text-red-400 text-sm">
        {error}
      </div>
    );
  }

  const series = cacheStatus?.series ?? [];

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg px-4 py-3 flex items-center gap-6 text-sm">
        <span className="text-zinc-200 font-medium">
          {cacheStatus?.total_series ?? 0} datasets
        </span>
        <span className="text-zinc-500">·</span>
        <span className="text-zinc-400">
          {(cacheStatus?.total_bars ?? 0).toLocaleString()} total bars
        </span>
        <span className="text-zinc-500">·</span>
        <span className="text-zinc-400">
          Last refresh: {formatLastRefresh(series)}
        </span>
        <button
          onClick={fetchCache}
          className="ml-auto text-xs text-cyan-500 hover:text-cyan-400 transition"
        >
          Reload
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 p-2 rounded">
          {error}
        </div>
      )}

      {/* Cache table */}
      {series.length === 0 ? (
        <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-lg p-8 text-center text-zinc-500 text-sm">
          No cached datasets yet. Run a backtest or use the form below to fetch data.
        </div>
      ) : (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide border-b border-zinc-800 bg-zinc-900/70">
                  <th className="py-2 px-3">Symbol</th>
                  <th className="py-2 px-3">Interval</th>
                  <th className="py-2 px-3 text-right">Bars</th>
                  <th className="py-2 px-3">From</th>
                  <th className="py-2 px-3">To</th>
                  <th className="py-2 px-3">Freshness</th>
                  <th className="py-2 px-3">Source</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {series.map((s) => {
                  const refreshKey = `${s.symbol}-${s.interval}-refresh`;
                  const clearKey = `${s.symbol}-${s.interval}-clear`;
                  const isRefreshing = actionInProgress === refreshKey;
                  const isClearing = actionInProgress === clearKey;
                  const busy = isRefreshing || isClearing;
                  return (
                    <tr
                      key={`${s.symbol}-${s.interval}`}
                      className="border-b border-zinc-800/60 hover:bg-zinc-800/20"
                    >
                      <td className="py-2 px-3 font-medium text-zinc-200">{s.symbol}</td>
                      <td className="py-2 px-3 text-zinc-400 text-xs font-mono">{s.interval}</td>
                      <td className="py-2 px-3 text-right text-zinc-300 tabular-nums">
                        {s.bar_count.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-zinc-500 text-xs tabular-nums">
                        {s.earliest ?? "–"}
                      </td>
                      <td className="py-2 px-3 text-zinc-500 text-xs tabular-nums">
                        {s.latest ?? "–"}
                      </td>
                      <td className="py-2 px-3 text-zinc-400 text-xs">
                        {formatFreshness(s.last_fetched_at)}
                      </td>
                      <td className="py-2 px-3 text-zinc-500 text-xs">
                        {inferSource(s.symbol)}
                      </td>
                      <td className="py-2 px-3 text-right space-x-2 whitespace-nowrap">
                        <button
                          onClick={() => handleRefresh(s)}
                          disabled={busy}
                          className="text-xs text-cyan-500 hover:text-cyan-400 disabled:text-zinc-600 transition"
                        >
                          {isRefreshing ? "…" : "Refresh"}
                        </button>
                        <button
                          onClick={() => handleClear(s)}
                          disabled={busy}
                          className="text-xs text-zinc-500 hover:text-red-400 disabled:text-zinc-700 transition"
                        >
                          {isClearing ? "…" : "Clear"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Custom Symbol section */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-400">
          Add Custom Symbol
        </h3>
        <p className="text-xs text-zinc-500">
          Enter any Yahoo Finance ticker (e.g. PLTR, COIN, GOLD, GC=F) to fetch and cache it.
        </p>
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            value={customTicker}
            onChange={(e) => setCustomTicker(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleFetchCustom(); }}
            placeholder="Ticker (e.g. PLTR)"
            className="flex-1 min-w-[120px] px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-sm focus:border-cyan-500 focus:outline-none"
          />
          <select
            value={customPeriodDays}
            onChange={(e) => setCustomPeriodDays(Number(e.target.value))}
            className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-sm focus:border-cyan-500 focus:outline-none"
          >
            {PERIOD_OPTIONS.map((p) => (
              <option key={p.label} value={p.days}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            value={customInterval}
            onChange={(e) => setCustomInterval(e.target.value)}
            className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-sm focus:border-cyan-500 focus:outline-none"
          >
            {INTERVAL_OPTIONS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
          <button
            onClick={handleFetchCustom}
            disabled={fetchingCustom || !customTicker.trim()}
            className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-semibold text-sm rounded-md transition"
          >
            {fetchingCustom ? "Fetching…" : "Fetch & Add"}
          </button>
        </div>
        {customError && (
          <div className="text-xs text-red-400 bg-red-950/30 border border-red-900 p-2 rounded">
            {customError}
          </div>
        )}
        {customSuccess && (
          <div className="text-xs text-emerald-400 bg-emerald-950/30 border border-emerald-900 p-2 rounded">
            {customSuccess} — switching to Single mode with this symbol.
          </div>
        )}
      </div>
    </div>
  );
}
