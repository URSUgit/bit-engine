"""
Historical OHLCV data loader.
Primary source:  Yahoo Finance v8 chart API (free, no key, 20+ years).
Stock fallback:  Stooq (free CSV, global access, no key).
Crypto fallback: Binance klines (free, no key) + Kraken OHLC.
All data is cached in SQLite for fast repeat access.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from .models import Bar
from .storage import bar_storage

log = logging.getLogger(__name__)

YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart"
BINANCE_BASE = "https://api.binance.com/api/v3"
STOOQ_BASE = "https://stooq.com/q/d/l"
KRAKEN_BASE = "https://api.kraken.com/0/public"

# Stooq uses lowercase symbols with exchange suffix: AAPL → aapl.us
# Index symbols like ^GSPC → ^spx.us, crypto not supported.
STOOQ_SUFFIX: dict[str, str] = {}  # overrides; default is .us for stocks

def _stooq_sym(symbol: str) -> str | None:
    """Convert a Yahoo-style symbol to a Stooq symbol, or None if unsupported."""
    if symbol.endswith("-USD") or symbol.endswith("USDT"):
        return None  # crypto — Stooq doesn't carry these
    if symbol.endswith("=X"):
        # forex: EURUSD=X → eur/usd.fx
        pair = symbol.replace("=X", "").lower()
        return f"{pair[:3]}/{pair[3:]}.fx"
    if symbol in ("GC=F", "SI=F", "CL=F", "NG=F", "HG=F"):
        return None  # futures — skip
    if symbol.startswith("^"):
        idx_map = {"^GSPC": "^spx", "^IXIC": "^ndq", "^DJI": "^dji", "^VIX": "^vix"}
        base = idx_map.get(symbol)
        return f"{base}.us" if base else None
    return f"{symbol.lower()}.us"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

# Universe of supported symbols
SYMBOL_CATALOG = {
    "crypto": [
        "BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD",
        "XRP-USD", "ADA-USD", "DOGE-USD", "AVAX-USD",
        "DOT-USD", "MATIC-USD", "LINK-USD", "LTC-USD",
    ],
    "stocks": [
        "AAPL", "MSFT", "NVDA", "TSLA", "GOOGL", "META",
        "AMZN", "AMD", "NFLX", "JPM", "V", "JNJ",
    ],
    "etfs": ["SPY", "QQQ", "VTI", "IWM", "GLD", "TLT"],
    "forex": [
        "EURUSD=X", "GBPUSD=X", "USDJPY=X", "USDCHF=X",
        "AUDUSD=X", "USDCAD=X",
    ],
    "commodities": [
        "GC=F",   # Gold futures
        "SI=F",   # Silver futures
        "CL=F",   # Crude oil
        "NG=F",   # Natural gas
        "HG=F",   # Copper
    ],
    "indices": ["^GSPC", "^IXIC", "^DJI", "^VIX"],
}


def all_symbols() -> list[dict]:
    """Flat list of every supported symbol with its category."""
    out = []
    for category, syms in SYMBOL_CATALOG.items():
        for sym in syms:
            out.append({"symbol": sym, "category": category})
    return out


# ── Yahoo Finance fetcher ─────────────────────────────────────────────────────

async def fetch_yahoo_bars(
    symbol: str,
    start_date: datetime,
    end_date: datetime,
    interval: str = "1d",
) -> list[Bar]:
    """
    Fetch OHLCV from Yahoo Finance v8 chart API.
    interval: 1d, 1wk, 1mo, 1h (1h limited to ~730 days back).
    Returns bars sorted by timestamp ascending.
    """
    period1 = int(start_date.timestamp())
    period2 = int(end_date.timestamp())
    params = {
        "period1": period1,
        "period2": period2,
        "interval": interval,
        "events": "history",
        "includeAdjustedClose": "true",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.get(f"{YAHOO_BASE}/{symbol}", params=params, headers=HEADERS)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            log.warning("Yahoo Finance fetch failed for %s: %s", symbol, e)
            return []

    chart = (data.get("chart") or {}).get("result") or []
    if not chart:
        return []
    result = chart[0]
    timestamps = result.get("timestamp") or []
    indicators = (result.get("indicators") or {}).get("quote") or [{}]
    quote = indicators[0] if indicators else {}
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    bars: list[Bar] = []
    for i, ts in enumerate(timestamps):
        try:
            o, h, l, c = opens[i], highs[i], lows[i], closes[i]
            if None in (o, h, l, c):
                continue
            v = volumes[i] if i < len(volumes) and volumes[i] is not None else 0
            bars.append(
                Bar(
                    timestamp=datetime.fromtimestamp(ts, tz=timezone.utc),
                    open=float(o), high=float(h), low=float(l),
                    close=float(c), volume=float(v),
                )
            )
        except (IndexError, TypeError, ValueError):
            continue
    return bars


# ── Binance fallback (only for crypto, intraday support) ──────────────────────

BINANCE_SYMBOL_MAP = {
    "BTC-USD": "BTCUSDT", "ETH-USD": "ETHUSDT", "SOL-USD": "SOLUSDT",
    "BNB-USD": "BNBUSDT", "XRP-USD": "XRPUSDT", "ADA-USD": "ADAUSDT",
    "DOGE-USD": "DOGEUSDT", "AVAX-USD": "AVAXUSDT", "DOT-USD": "DOTUSDT",
    "MATIC-USD": "MATICUSDT", "LINK-USD": "LINKUSDT", "LTC-USD": "LTCUSDT",
}


def binance_symbol(symbol: str) -> str | None:
    """Resolve a catalog symbol to its Binance pair.

    Accepts both Yahoo-style ("BTC-USD", via the map) and Binance-native
    symbols ("BTCUSDT"). The backtester and seeded cache use the native form,
    which previously never matched the map — so the Binance fallback silently
    skipped the exact symbols it exists for.
    """
    mapped = BINANCE_SYMBOL_MAP.get(symbol)
    if mapped:
        return mapped
    s = symbol.upper()
    if s.isalnum() and s.endswith(("USDT", "USDC")):
        return s
    return None

# Binance supports 1s, 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
BINANCE_INTERVAL_MAP = {
    "1s": "1s", "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
    "1h": "1h", "2h": "2h", "4h": "4h", "6h": "6h", "8h": "8h", "12h": "12h",
    "1d": "1d", "3d": "3d", "1wk": "1w", "1mo": "1M",
}

# How long each Binance interval is in milliseconds (used for pagination)
BINANCE_INTERVAL_MS = {
    "1s": 1_000, "1m": 60_000, "3m": 180_000, "5m": 300_000,
    "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000,
    "4h": 14_400_000, "6h": 21_600_000, "8h": 28_800_000, "12h": 43_200_000,
    "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000, "1M": 2_592_000_000,
}


async def fetch_binance_bars(
    symbol: str,
    start_date: datetime,
    end_date: datetime,
    interval: str = "1d",
) -> list[Bar]:
    """Binance klines paginated fetch — 1000 bars per call."""
    binance_sym = binance_symbol(symbol)
    if not binance_sym:
        return []
    binance_int = BINANCE_INTERVAL_MAP.get(interval, "1d")
    start_ms = int(start_date.timestamp() * 1000)
    end_ms = int(end_date.timestamp() * 1000)
    all_bars: list[Bar] = []

    async with httpx.AsyncClient(timeout=30) as client:
        cursor = start_ms
        while cursor < end_ms:
            try:
                r = await client.get(
                    f"{BINANCE_BASE}/klines",
                    params={
                        "symbol": binance_sym,
                        "interval": binance_int,
                        "startTime": cursor,
                        "endTime": end_ms,
                        "limit": 1000,
                    },
                    headers=HEADERS,
                )
                r.raise_for_status()
                klines = r.json()
            except Exception as e:
                log.warning("Binance klines failed for %s: %s", binance_sym, e)
                break

            if not klines:
                break

            for k in klines:
                all_bars.append(
                    Bar(
                        timestamp=datetime.fromtimestamp(k[0] / 1000, tz=timezone.utc),
                        open=float(k[1]), high=float(k[2]),
                        low=float(k[3]), close=float(k[4]),
                        volume=float(k[5]),
                    )
                )

            last_ts = klines[-1][0]
            if last_ts <= cursor:
                break
            cursor = last_ts + 1

            if len(klines) < 1000:
                break

    return all_bars


# ── Stooq fallback (stocks / ETFs / indices — key-free, global) ───────────────

async def fetch_stooq_bars(
    symbol: str,
    start_date: datetime,
    end_date: datetime,
    interval: str = "1d",
) -> list[Bar]:
    """
    Fetch daily OHLCV from Stooq (free CSV, no key, not geo-blocked).
    Only supports daily interval and non-crypto symbols.
    """
    if interval not in ("1d", "1wk", "1mo"):
        return []
    stooq_sym = _stooq_sym(symbol)
    if not stooq_sym:
        return []

    interval_map = {"1d": "d", "1wk": "w", "1mo": "m"}
    params = {
        "s": stooq_sym,
        "i": interval_map[interval],
        "d1": start_date.strftime("%Y%m%d"),
        "d2": end_date.strftime("%Y%m%d"),
    }
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            r = await client.get(STOOQ_BASE, params=params, headers=HEADERS)
            r.raise_for_status()
            text = r.text.strip()
        except Exception as e:
            log.warning("Stooq fetch failed for %s: %s", symbol, e)
            return []

    bars: list[Bar] = []
    lines = text.splitlines()
    if len(lines) < 2:
        return []
    # Header: Date,Open,High,Low,Close,Volume
    for line in lines[1:]:
        parts = line.split(",")
        if len(parts) < 5:
            continue
        try:
            ts = datetime.strptime(parts[0].strip(), "%Y-%m-%d").replace(tzinfo=timezone.utc)
            o, h, l, c = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
            v = float(parts[5]) if len(parts) > 5 and parts[5].strip() else 0.0
            if any(x == 0 for x in (o, h, l, c)):
                continue
            bars.append(Bar(timestamp=ts, open=o, high=h, low=l, close=c, volume=v))
        except (ValueError, IndexError):
            continue
    return sorted(bars, key=lambda b: b.timestamp)


# ── Kraken OHLC fallback (crypto daily — key-free, global) ────────────────────

KRAKEN_CRYPTO_MAP = {
    "BTC-USD": "XBTUSD", "ETH-USD": "ETHUSD", "SOL-USD": "SOLUSD",
    "XRP-USD": "XRPUSD", "ADA-USD": "ADAUSD", "DOGE-USD": "XDGUSD",
    "AVAX-USD": "AVAXUSD", "DOT-USD": "DOTUSD", "MATIC-USD": "MATICUSD",
    "LINK-USD": "LINKUSD", "LTC-USD": "XLTCZUSD", "ATOM-USD": "ATOMUSD",
}

KRAKEN_INTERVAL_MAP = {"1d": 1440, "1wk": 10080, "1h": 60, "4h": 240}


async def fetch_kraken_bars(
    symbol: str,
    start_date: datetime,
    end_date: datetime,
    interval: str = "1d",
) -> list[Bar]:
    """Fetch OHLCV from Kraken (key-free, global). Only for supported crypto."""
    kraken_sym = KRAKEN_CRYPTO_MAP.get(symbol)
    if not kraken_sym:
        return []
    interval_min = KRAKEN_INTERVAL_MAP.get(interval)
    if not interval_min:
        return []

    since = int(start_date.timestamp())
    all_bars: list[Bar] = []
    async with httpx.AsyncClient(timeout=20) as client:
        cursor = since
        while True:
            try:
                r = await client.get(
                    f"{KRAKEN_BASE}/OHLC",
                    params={"pair": kraken_sym, "interval": interval_min, "since": cursor},
                    headers=HEADERS,
                )
                r.raise_for_status()
                result = r.json().get("result", {})
                candles = next((v for k, v in result.items() if k != "last"), [])
            except Exception as e:
                log.warning("Kraken OHLC failed for %s: %s", symbol, e)
                break

            if not candles:
                break

            for k in candles:
                ts = datetime.fromtimestamp(k[0], tz=timezone.utc)
                if ts > end_date:
                    break
                o, h, l, c, v = float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[6])
                if c == 0:
                    continue
                all_bars.append(Bar(timestamp=ts, open=o, high=h, low=l, close=c, volume=v))

            last_ts = candles[-1][0]
            next_cursor = result.get("last", last_ts)
            if next_cursor <= cursor or len(candles) < 720:
                break
            cursor = next_cursor

    return [b for b in all_bars if start_date <= b.timestamp <= end_date]


# ── Public loader (caches in SQLite) ──────────────────────────────────────────

class HistoricalDataLoader:
    def __init__(self) -> None:
        self.storage = bar_storage

    async def load(
        self,
        symbol: str,
        start_date: str | datetime,
        end_date: str | datetime | None = None,
        interval: str = "1d",
        force_refresh: bool = False,
    ) -> list[Bar]:
        """
        Load bars for [start_date, end_date]. Uses cache when possible.
        Fetches missing data from Yahoo (primary) or Binance (crypto fallback).
        """
        if isinstance(start_date, str):
            start_date = datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
        if end_date is None:
            end_date = datetime.now(timezone.utc)
        elif isinstance(end_date, str):
            end_date = datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)

        # Add a small buffer so we capture full ranges
        start_ts = int(start_date.timestamp())
        end_ts = int(end_date.timestamp())

        # Check cache first
        if not force_refresh:
            cached = await asyncio.to_thread(self.storage.get_bars, symbol, interval, start_ts, end_ts)
            meta = await asyncio.to_thread(self.storage.get_meta, symbol, interval)
            if meta and len(cached) > 50:
                # Check if cache is reasonably fresh (within a day for daily data)
                stale_threshold = 86400 * 2 if interval == "1d" else 3600 * 2
                fresh = (datetime.now(timezone.utc).timestamp() - meta["last_fetched_at"]) < stale_threshold
                # A fully historical window can't grow new bars: if the last
                # fetch happened after the window ended, the cache is
                # definitive at any age. Without this, every intraday
                # backtest re-downloaded months of bars once per 2 hours.
                historical = end_ts <= meta["last_fetched_at"]
                if fresh or historical:
                    log.info("Cache hit: %s %s — %d bars", symbol, interval, len(cached))
                    return cached

        # Cache miss — fetch from network (layered fallbacks). Track which
        # provider produced the bars so provenance is recorded in the cache.
        log.info("Fetching %s %s from %s to %s", symbol, interval, start_date.date(), end_date.date())
        source = "yahoo"
        bars = await fetch_yahoo_bars(symbol, start_date, end_date, interval)

        # Fallback 2: Stooq (stocks/ETFs/indices — globally accessible, key-free)
        if not bars and _stooq_sym(symbol):
            log.info("Yahoo empty for %s, trying Stooq", symbol)
            source = "stooq"
            bars = await fetch_stooq_bars(symbol, start_date, end_date, interval)

        # Fallback 3: Binance (crypto — key-free, may be geo-blocked)
        if not bars and binance_symbol(symbol):
            log.info("Yahoo/Stooq empty for %s, trying Binance", symbol)
            source = "binance"
            bars = await fetch_binance_bars(symbol, start_date, end_date, interval)

        # Fallback 4: Kraken (crypto — key-free, globally accessible)
        if not bars and symbol in KRAKEN_CRYPTO_MAP:
            log.info("Trying Kraken for %s", symbol)
            source = "kraken"
            bars = await fetch_kraken_bars(symbol, start_date, end_date, interval)

        # Fallback 5: GitHub-hosted real datasets (Coin Metrics). Daily only, but
        # reachable via raw.githubusercontent.com when exchange/market hosts are
        # blocked by an egress policy (the only real-data path in such sandboxes).
        if not bars and interval == "1d":
            from .github_data import COINMETRICS_ASSETS, load_real_daily
            if symbol.upper() in COINMETRICS_ASSETS:
                try:
                    log.info("Trying GitHub real-data (Coin Metrics) for %s", symbol)
                    await asyncio.to_thread(load_real_daily, symbol, interval=interval)
                    # load_real_daily upserts directly; serve from cache below.
                    return await asyncio.to_thread(self.storage.get_bars, symbol, interval, start_ts, end_ts)
                except Exception as e:
                    log.warning("GitHub real-data fallback failed for %s: %s", symbol, e)

        if bars:
            await asyncio.to_thread(self.storage.upsert_bars, symbol, interval, bars, source=source)
            log.info("Cached %d bars for %s %s (source=%s)", len(bars), symbol, interval, source)

        # Return filtered to requested range from cache
        return await asyncio.to_thread(self.storage.get_bars, symbol, interval, start_ts, end_ts)

    async def prefetch_universe(
        self,
        categories: list[str] | None = None,
        years_back: int = 10,
    ) -> dict:
        """Prefetch the symbol catalog for the requested categories. Runs in parallel."""
        categories = categories or list(SYMBOL_CATALOG.keys())
        start = datetime.now(timezone.utc) - timedelta(days=365 * years_back)
        end = datetime.now(timezone.utc)

        results: dict[str, int] = {}
        for cat in categories:
            symbols = SYMBOL_CATALOG.get(cat, [])
            tasks = [self.load(sym, start, end, "1d") for sym in symbols]
            outputs = await asyncio.gather(*tasks, return_exceptions=True)
            for sym, out in zip(symbols, outputs):
                if isinstance(out, Exception):
                    results[sym] = 0
                    log.warning("Prefetch failed for %s: %s", sym, out)
                else:
                    results[sym] = len(out)
        return results
