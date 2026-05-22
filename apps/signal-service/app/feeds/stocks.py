"""Stock + forex price feed — Finnhub free tier (optional API key)."""
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

log = logging.getLogger(__name__)

FINNHUB_BASE = "https://finnhub.io/api/v1"
FINNHUB_KEY = os.getenv("FINNHUB_API_KEY", "")

# Default watchlist — popular US stocks + ETFs
STOCK_SYMBOLS = ["AAPL", "MSFT", "NVDA", "TSLA", "GOOGL", "META", "AMZN", "SPY", "QQQ", "BRK.B"]

# Forex pairs
FOREX_PAIRS = [
    ("EUR", "USD"),
    ("GBP", "USD"),
    ("USD", "JPY"),
    ("USD", "CHF"),
    ("AUD", "USD"),
    ("USD", "CAD"),
]


def _headers() -> dict:
    return {"X-Finnhub-Token": FINNHUB_KEY} if FINNHUB_KEY else {}


async def fetch_stock_quote(symbol: str) -> Optional[dict]:
    """Fetch real-time stock quote. Requires FINNHUB_API_KEY."""
    if not FINNHUB_KEY:
        return None
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(
                f"{FINNHUB_BASE}/quote",
                params={"symbol": symbol},
                headers=_headers(),
            )
            r.raise_for_status()
            data = r.json()
            if data.get("c", 0) == 0:
                return None
            return {
                "symbol": symbol,
                "price": data["c"],
                "price_change_pct_24h": round((data["c"] - data["pc"]) / data["pc"] * 100, 2) if data["pc"] else 0,
                "high_24h": data["h"],
                "low_24h": data["l"],
                "open": data["o"],
                "prev_close": data["pc"],
                "volume_usdt_24h": 0,
                "closes": [],
            }
        except Exception as e:
            log.warning("Finnhub quote failed for %s: %s", symbol, e)
            return None


async def fetch_stock_candles(symbol: str, count: int = 20) -> list[float]:
    """Fetch recent hourly closes for RSI computation. Requires FINNHUB_API_KEY."""
    if not FINNHUB_KEY:
        return []
    import time
    now = int(time.time())
    from_ts = now - count * 3600
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(
                f"{FINNHUB_BASE}/stock/candle",
                params={"symbol": symbol, "resolution": "60", "from": from_ts, "to": now},
                headers=_headers(),
            )
            r.raise_for_status()
            data = r.json()
            return data.get("c", []) if data.get("s") == "ok" else []
        except Exception as e:
            log.warning("Finnhub candles failed for %s: %s", symbol, e)
            return []


async def fetch_forex_rate(base: str, quote: str) -> Optional[dict]:
    """Fetch live forex rate. Requires FINNHUB_API_KEY."""
    if not FINNHUB_KEY:
        return None
    symbol = f"OANDA:{base}_{quote}"
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(
                f"{FINNHUB_BASE}/forex/rates",
                params={"base": base},
                headers=_headers(),
            )
            r.raise_for_status()
            rates = r.json().get("quote", {})
            rate = rates.get(quote)
            if not rate:
                return None
            return {
                "symbol": f"{base}{quote}",
                "pair": f"{base}/{quote}",
                "price": float(rate),
                "price_change_pct_24h": 0.0,
                "volume_usdt_24h": 0,
                "closes": [],
                "asset_class": "forex",
            }
        except Exception as e:
            log.warning("Finnhub forex failed for %s/%s: %s", base, quote, e)
            return None


async def fetch_news_sentiment(symbol: str, category: str = "general") -> list[dict]:
    """Fetch recent news headlines via Finnhub. Requires FINNHUB_API_KEY."""
    if not FINNHUB_KEY:
        return []
    import time
    now_ts = int(time.time())
    from_date = time.strftime("%Y-%m-%d", time.gmtime(now_ts - 86400))
    to_date = time.strftime("%Y-%m-%d", time.gmtime(now_ts))
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            if category == "crypto":
                r = await client.get(
                    f"{FINNHUB_BASE}/news",
                    params={"category": "crypto"},
                    headers=_headers(),
                )
            else:
                r = await client.get(
                    f"{FINNHUB_BASE}/company-news",
                    params={"symbol": symbol, "from": from_date, "to": to_date},
                    headers=_headers(),
                )
            r.raise_for_status()
            items = r.json()[:10]
            return [{"headline": i.get("headline", ""), "summary": i.get("summary", "")} for i in items]
        except Exception as e:
            log.warning("Finnhub news failed for %s: %s", symbol, e)
            return []


async def fetch_all_stocks(symbols: list[str] = STOCK_SYMBOLS) -> dict[str, dict]:
    """Fetch quotes + candles for all stock symbols. Empty if no API key."""
    if not FINNHUB_KEY:
        return {}
    import asyncio
    tasks = [(sym, fetch_stock_quote(sym), fetch_stock_candles(sym)) for sym in symbols]
    result = {}
    for sym, quote_task, candles_task in [(s, q, c) for s, q, c in tasks]:
        quote, closes = await asyncio.gather(quote_task, candles_task)
        if quote:
            quote["closes"] = closes
            result[sym] = quote
    return result


async def fetch_all_forex(pairs: list[tuple] = FOREX_PAIRS) -> dict[str, dict]:
    """Fetch all configured forex pairs. Empty if no API key."""
    if not FINNHUB_KEY:
        return {}
    import asyncio
    tasks = [fetch_forex_rate(base, quote) for base, quote in pairs]
    results = await asyncio.gather(*tasks)
    return {r["symbol"]: r for r in results if r}
