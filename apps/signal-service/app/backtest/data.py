"""
Historical OHLCV data loader.
Primary source: Yahoo Finance v8 chart API (free, no key, 20+ years).
Fallback for crypto: Binance klines (free, no key).
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
    binance_sym = BINANCE_SYMBOL_MAP.get(symbol)
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
            cached = self.storage.get_bars(symbol, interval, start_ts, end_ts)
            meta = self.storage.get_meta(symbol, interval)
            if meta and len(cached) > 50:
                # Check if cache is reasonably fresh (within a day for daily data)
                stale_threshold = 86400 * 2 if interval == "1d" else 3600 * 2
                if (datetime.now(timezone.utc).timestamp() - meta["last_fetched_at"]) < stale_threshold:
                    log.info("Cache hit: %s %s — %d bars", symbol, interval, len(cached))
                    return cached

        # Cache miss — fetch from network
        log.info("Fetching %s %s from %s to %s", symbol, interval, start_date.date(), end_date.date())
        bars = await fetch_yahoo_bars(symbol, start_date, end_date, interval)

        if not bars and symbol in BINANCE_SYMBOL_MAP:
            log.info("Yahoo empty for %s, trying Binance", symbol)
            bars = await fetch_binance_bars(symbol, start_date, end_date, interval)

        if bars:
            self.storage.upsert_bars(symbol, interval, bars)
            log.info("Cached %d bars for %s %s", len(bars), symbol, interval)

        # Return filtered to requested range from cache
        return self.storage.get_bars(symbol, interval, start_ts, end_ts)

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
