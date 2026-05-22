"""Crypto price feed — CoinGecko (primary, no key) + Binance (fallback, no key)."""
from __future__ import annotations

import asyncio
import logging

import httpx

log = logging.getLogger(__name__)

COINGECKO_BASE = "https://api.coingecko.com/api/v3"
BINANCE_BASE = "https://api.binance.com/api/v3"

COINGECKO_IDS = [
    "bitcoin", "ethereum", "solana", "binancecoin",
    "cardano", "ripple", "dogecoin", "avalanche-2",
]

COINGECKO_TO_SYMBOL = {
    "bitcoin": "BTCUSDT",
    "ethereum": "ETHUSDT",
    "solana": "SOLUSDT",
    "binancecoin": "BNBUSDT",
    "cardano": "ADAUSDT",
    "ripple": "XRPUSDT",
    "dogecoin": "DOGEUSDT",
    "avalanche-2": "AVAXUSDT",
}

CRYPTO_SYMBOLS = list(COINGECKO_TO_SYMBOL.values())

_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; BitPrivat/1.0)",
}


async def fetch_coingecko_markets() -> list[dict]:
    """
    Fetch current prices + 24h stats from CoinGecko.
    Free tier, no API key. Rate limit: ~10-50 req/min.
    """
    params = {
        "vs_currency": "usd",
        "ids": ",".join(COINGECKO_IDS),
        "order": "market_cap_desc",
        "per_page": len(COINGECKO_IDS),
        "page": 1,
        "sparkline": "false",
        "price_change_percentage": "24h",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.get(
                f"{COINGECKO_BASE}/coins/markets",
                params=params,
                headers=_HEADERS,
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:
            log.warning("CoinGecko markets failed: %s", e)
            return []


async def fetch_coingecko_hourly_closes(coin_id: str, hours: int = 20) -> list[float]:
    """
    Fetch hourly close prices from CoinGecko for RSI computation.
    Returns list of close prices (last `hours` hourly candles).
    """
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.get(
                f"{COINGECKO_BASE}/coins/{coin_id}/market_chart",
                params={"vs_currency": "usd", "days": "2", "interval": "hourly"},
                headers=_HEADERS,
            )
            r.raise_for_status()
            prices = r.json().get("prices", [])
            # prices = [[timestamp_ms, price], ...]
            closes = [p[1] for p in prices]
            return closes[-hours:] if len(closes) >= hours else closes
        except Exception as e:
            log.warning("CoinGecko klines failed for %s: %s", coin_id, e)
            return []


async def fetch_binance_tickers(symbols: list[str]) -> list[dict]:
    """Fallback: fetch tickers from Binance (no key needed)."""
    import json
    params = {"symbols": json.dumps(symbols)}
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(
                f"{BINANCE_BASE}/ticker/24hr",
                params=params,
                headers=_HEADERS,
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:
            log.warning("Binance ticker fallback failed: %s", e)
            return []


async def fetch_binance_funding_rate(symbol: str) -> float | None:
    """Fetch perpetual funding rate from Binance futures."""
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(
                "https://fapi.binance.com/fapi/v1/premiumIndex",
                params={"symbol": symbol},
                headers=_HEADERS,
            )
            r.raise_for_status()
            return float(r.json().get("lastFundingRate", 0))
        except Exception:
            return None


async def fetch_binance_open_interest(symbol: str) -> float | None:
    """Fetch open interest from Binance futures."""
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(
                "https://fapi.binance.com/fapi/v1/openInterest",
                params={"symbol": symbol},
                headers=_HEADERS,
            )
            r.raise_for_status()
            return float(r.json().get("openInterest", 0))
        except Exception:
            return None


async def fetch_all_crypto(coins: list[str] = COINGECKO_IDS) -> dict[str, dict]:
    """
    Fetch tickers + hourly closes for all coins.
    Primary: CoinGecko. Falls back to Binance if CoinGecko fails.
    Returns dict keyed by Binance-style symbol (e.g. 'BTCUSDT').
    """
    markets_task = fetch_coingecko_markets()
    klines_tasks = [fetch_coingecko_hourly_closes(coin) for coin in coins]

    all_results = await asyncio.gather(markets_task, *klines_tasks, return_exceptions=True)
    markets = all_results[0] if not isinstance(all_results[0], Exception) else []
    klines_list = [
        r if not isinstance(r, Exception) else []
        for r in all_results[1:]
    ]

    result: dict[str, dict] = {}

    if markets:
        market_map = {m["id"]: m for m in markets}
        for coin_id, closes in zip(coins, klines_list):
            m = market_map.get(coin_id, {})
            sym = COINGECKO_TO_SYMBOL.get(coin_id, coin_id.upper() + "USDT")
            result[sym] = {
                "symbol": sym,
                "price": float(m.get("current_price") or 0),
                "price_change_pct_24h": float(m.get("price_change_percentage_24h") or 0),
                "volume_usdt_24h": float(m.get("total_volume") or 0),
                "high_24h": float(m.get("high_24h") or 0),
                "low_24h": float(m.get("low_24h") or 0),
                "market_cap": float(m.get("market_cap") or 0),
                "closes": closes,
            }
    else:
        # Fallback to Binance
        log.info("CoinGecko unavailable, trying Binance fallback")
        binance_data = await fetch_binance_tickers(CRYPTO_SYMBOLS)
        ticker_map = {t["symbol"]: t for t in binance_data}
        for coin_id, closes in zip(coins, klines_list):
            sym = COINGECKO_TO_SYMBOL.get(coin_id, coin_id.upper() + "USDT")
            t = ticker_map.get(sym, {})
            result[sym] = {
                "symbol": sym,
                "price": float(t.get("lastPrice") or 0),
                "price_change_pct_24h": float(t.get("priceChangePercent") or 0),
                "volume_usdt_24h": float(t.get("quoteVolume") or 0),
                "high_24h": float(t.get("highPrice") or 0),
                "low_24h": float(t.get("lowPrice") or 0),
                "closes": closes,
            }

    return result
