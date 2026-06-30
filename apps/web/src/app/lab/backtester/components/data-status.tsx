"use client";

import { useCallback, useEffect, useState } from "react";
import { backtestApi, type CachedSeries, type CacheStatus } from "@/lib/backtest-api";
import { isoDaysAgo } from "./shared";
import { CorrelationHeatmap } from "./correlation-heatmap";

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
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [importingReal, setImportingReal] = useState(false);
  const [realResult, setRealResult] = useState<string | null>(null);

  // Custom symbol input state
  const [customTicker, setCustomTicker] = useState("");
  const [customPeriodDays, setCustomPeriodDays] = useState(365 * 5);
  const [customInterval, setCustomInterval] = useState("1d");
  const [fetchingCustom, setFetchingCustom] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);
  const [customSuccess, setCustomSuccess] = useState<string | null>(null);

  // yfinance "Fetch Real Data" state
  const [yfSymbol, setYfSymbol] = useState("");
  const [yfInterval, setYfInterval] = useState("1d");
  const [yfDays, setYfDays] = useState(730);
  const [yfFetching, setYfFetching] = useState(false);
  const [yfError, setYfError] = useState<string | null>(null);
  const [yfSuccess, setYfSuccess] = useState<string | null>(null);

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

  async function handleSeedDemo() {
    setSeeding(true);
    setSeedResult(null);
    setError(null);
    try {
      const r = await backtestApi.seedDemo({
        symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"],
        intervals: ["1d", "4h", "1h"],
        days: 730,
      });
      setSeedResult(`Seeded ${r.total_bars.toLocaleString()} bars for ${r.seeded.map((s) => s.symbol).filter((v, i, a) => a.indexOf(v) === i).join(", ")}`);
      await fetchCache();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  }

  async function handleImportReal() {
    setImportingReal(true);
    setRealResult(null);
    setError(null);
    try {
      const r = await backtestApi.importRealData({
        symbols: ["BTCUSDT", "ETHUSDT"],
        clear_existing: true,
      });
      if (r.imported.length > 0) {
        const parts = r.imported.map((d) => `${d.symbol} (${d.bars_written.toLocaleString()} bars, ${d.earliest}→${d.latest})`);
        const errSuffix = r.errors.length > 0 ? ` · skipped: ${r.errors.map((e) => e.symbol).join(", ")}` : "";
        setRealResult(`Imported real daily data from ${r.source}: ${parts.join(", ")}${errSuffix}`);
        if (r.imported[0]) onSymbolAdded(r.imported[0].symbol);
      } else {
        setError(`Real-data import failed: ${r.errors.map((e) => `${e.symbol}: ${e.error}`).join("; ") || "no data returned"}`);
      }
      await fetchCache();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportingReal(false);
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

  async function handleFetchReal(symbolOverride?: string) {
    const ticker = (symbolOverride ?? yfSymbol).trim().toUpperCase();
    if (!ticker) { setYfError("Enter a ticker symbol"); return; }
    setYfFetching(true);
    setYfError(null);
    setYfSuccess(null);
    try {
      const result = await backtestApi.fetchRealData({
        symbol: ticker,
        interval: yfInterval,
        days: yfDays,
      });
      setYfSuccess(
        `Fetched ${result.bars_fetched.toLocaleString()} bars for ${ticker} via Yahoo Finance (${result.start} → ${result.end})`
      );
      onSymbolAdded(ticker);
      if (!symbolOverride) setYfSymbol("");
      await fetchCache();
    } catch (e) {
      setYfError(e instanceof Error ? e.message : String(e));
    } finally {
      setYfFetching(false);
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
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg px-4 py-3 flex items-center gap-4 text-sm flex-wrap">
        <span className="text-zinc-200 font-medium">
          {cacheStatus?.total_series ?? 0} datasets
        </span>
        <span className="text-zinc-500">·</span>
        <span className="text-zinc-400">
          {(cacheStatus?.total_bars ?? 0).toLocaleString()} bars
        </span>
        <span className="text-zinc-500">·</span>
        <span className="text-zinc-400 text-xs">
          Refreshed: {formatLastRefresh(series)}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={handleImportReal}
            disabled={importingReal}
            className="px-3 py-1 text-xs bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 rounded transition disabled:opacity-50 font-medium"
            title="Download real daily BTC/ETH history (Coin Metrics, via GitHub)"
          >
            {importingReal ? "Importing…" : "Import Real Data"}
          </button>
          <button
            onClick={handleSeedDemo}
            disabled={seeding}
            className="px-3 py-1 text-xs bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 rounded transition disabled:opacity-50"
            title="Generate synthetic GBM bars for demo/testing"
          >
            {seeding ? "Seeding…" : "Seed Demo (synthetic)"}
          </button>
          <button
            onClick={fetchCache}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition"
          >
            Reload
          </button>
        </div>
      </div>
      {realResult && (
        <div className="text-xs text-emerald-400 bg-emerald-950/30 border border-emerald-900 p-2 rounded">
          ✓ {realResult}
        </div>
      )}
      {seedResult && (
        <div className="text-xs text-cyan-400 bg-cyan-950/30 border border-cyan-900 p-2 rounded">
          ✓ {seedResult} <span className="text-cyan-600">(synthetic GBM — not real market data)</span>
        </div>
      )}

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

      {/* Correlation heatmap */}
      <CorrelationHeatmap
        activeSymbols={series.length > 0 ? series.slice(0, 8).map((s) => s.symbol) : undefined}
      />

      {/* Fetch Real Data from Yahoo Finance via yfinance */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            Fetch Real Data
          </h3>
          <span className="text-xs text-zinc-600 bg-zinc-800 px-2 py-0.5 rounded-full">Yahoo Finance</span>
        </div>
        <p className="text-xs text-zinc-500">
          Download real OHLCV history for stocks, ETFs, crypto and forex — no API key required.
        </p>

        {/* Quick-fetch grid */}
        <div>
          <p className="text-xs text-zinc-600 mb-2">Quick fetch (730 days, 1d):</p>
          <div className="flex flex-wrap gap-2">
            {["AAPL", "MSFT", "NVDA", "TSLA", "META", "GOOGL", "AMZN", "SPY", "QQQ", "GLD"].map((sym) => (
              <button
                key={sym}
                onClick={() => handleFetchReal(sym)}
                disabled={yfFetching}
                className="px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded transition disabled:opacity-40"
              >
                {sym}
              </button>
            ))}
          </div>
        </div>

        {/* Custom symbol form */}
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            value={yfSymbol}
            onChange={(e) => setYfSymbol(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleFetchReal(); }}
            placeholder="Ticker (e.g. AAPL, BTC-USD)"
            className="flex-1 min-w-[140px] px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-sm focus:border-cyan-500 focus:outline-none"
          />
          <select
            value={yfInterval}
            onChange={(e) => setYfInterval(e.target.value)}
            className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-sm focus:border-cyan-500 focus:outline-none"
          >
            <option value="1d">1d</option>
            <option value="1h">1h</option>
          </select>
          <select
            value={yfDays}
            onChange={(e) => setYfDays(Number(e.target.value))}
            className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-sm focus:border-cyan-500 focus:outline-none"
          >
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
            <option value={730}>2 years</option>
            <option value={1825}>5 years</option>
          </select>
          <button
            onClick={() => handleFetchReal()}
            disabled={yfFetching || !yfSymbol.trim()}
            className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-semibold text-sm rounded-md transition"
          >
            {yfFetching ? "Fetching…" : "Fetch from Yahoo Finance"}
          </button>
        </div>
        {yfError && (
          <div className="text-xs text-red-400 bg-red-950/30 border border-red-900 p-2 rounded">
            {yfError}
          </div>
        )}
        {yfSuccess && (
          <div className="text-xs text-emerald-400 bg-emerald-950/30 border border-emerald-900 p-2 rounded">
            {yfSuccess}
          </div>
        )}
      </div>

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
