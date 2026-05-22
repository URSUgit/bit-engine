"""
Asset metadata loader — market cap, fundamentals, news, sentiment indicators.
Combines CoinGecko (crypto), Yahoo Finance (stocks), and free public APIs.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Optional

import httpx

log = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

COINGECKO_BASE = "https://api.coingecko.com/api/v3"
YAHOO_QUOTE_BASE = "https://query1.finance.yahoo.com/v7/finance/quote"
FNG_BASE = "https://api.alternative.me/fng/"

# Map Yahoo crypto symbols to CoinGecko coin ids
CRYPTO_TO_COINGECKO = {
    "BTC-USD": "bitcoin", "ETH-USD": "ethereum", "SOL-USD": "solana",
    "BNB-USD": "binancecoin", "XRP-USD": "ripple", "ADA-USD": "cardano",
    "DOGE-USD": "dogecoin", "AVAX-USD": "avalanche-2", "DOT-USD": "polkadot",
    "MATIC-USD": "matic-network", "LINK-USD": "chainlink", "LTC-USD": "litecoin",
}


# ── Crypto metadata via CoinGecko (free, no key) ──────────────────────────────

async def fetch_coingecko_full(symbol: str) -> Optional[dict]:
    """Comprehensive crypto metadata: market cap, ATH, supply, descriptions."""
    coin_id = CRYPTO_TO_COINGECKO.get(symbol)
    if not coin_id:
        return None
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.get(
                f"{COINGECKO_BASE}/coins/{coin_id}",
                params={
                    "localization": "false",
                    "tickers": "false",
                    "market_data": "true",
                    "community_data": "true",
                    "developer_data": "false",
                    "sparkline": "false",
                },
                headers=HEADERS,
            )
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            log.warning("CoinGecko metadata failed for %s: %s", symbol, e)
            return None

    md = data.get("market_data") or {}
    return {
        "asset_class": "crypto",
        "name": data.get("name"),
        "symbol": data.get("symbol", "").upper(),
        "description": (data.get("description") or {}).get("en", "")[:600],
        "homepage": (data.get("links") or {}).get("homepage", [None])[0],
        "categories": data.get("categories", []),
        "market_cap_rank": data.get("market_cap_rank"),
        "current_price_usd": (md.get("current_price") or {}).get("usd"),
        "market_cap_usd": (md.get("market_cap") or {}).get("usd"),
        "fully_diluted_valuation_usd": (md.get("fully_diluted_valuation") or {}).get("usd"),
        "total_volume_24h_usd": (md.get("total_volume") or {}).get("usd"),
        "high_24h_usd": (md.get("high_24h") or {}).get("usd"),
        "low_24h_usd": (md.get("low_24h") or {}).get("usd"),
        "ath_usd": (md.get("ath") or {}).get("usd"),
        "ath_change_pct": (md.get("ath_change_percentage") or {}).get("usd"),
        "ath_date": (md.get("ath_date") or {}).get("usd"),
        "atl_usd": (md.get("atl") or {}).get("usd"),
        "atl_change_pct": (md.get("atl_change_percentage") or {}).get("usd"),
        "circulating_supply": md.get("circulating_supply"),
        "total_supply": md.get("total_supply"),
        "max_supply": md.get("max_supply"),
        "price_change_24h_pct": md.get("price_change_percentage_24h"),
        "price_change_7d_pct": md.get("price_change_percentage_7d"),
        "price_change_30d_pct": md.get("price_change_percentage_30d"),
        "price_change_1y_pct": md.get("price_change_percentage_1y"),
        "twitter_followers": (data.get("community_data") or {}).get("twitter_followers"),
        "reddit_subscribers": (data.get("community_data") or {}).get("reddit_subscribers"),
    }


# ── Stock metadata via Yahoo Finance quote endpoint ───────────────────────────

async def fetch_yahoo_quote(symbol: str) -> Optional[dict]:
    """Stock / ETF / forex / commodity metadata via Yahoo quote API."""
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.get(
                YAHOO_QUOTE_BASE,
                params={"symbols": symbol},
                headers=HEADERS,
            )
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            log.warning("Yahoo quote failed for %s: %s", symbol, e)
            return None

    results = (data.get("quoteResponse") or {}).get("result") or []
    if not results:
        return None
    q = results[0]

    return {
        "asset_class": q.get("quoteType", "").lower(),
        "name": q.get("longName") or q.get("shortName"),
        "symbol": q.get("symbol"),
        "exchange": q.get("fullExchangeName"),
        "currency": q.get("currency"),
        "current_price_usd": q.get("regularMarketPrice"),
        "market_cap_usd": q.get("marketCap"),
        "trailing_pe": q.get("trailingPE"),
        "forward_pe": q.get("forwardPE"),
        "price_to_book": q.get("priceToBook"),
        "dividend_yield_pct": (q.get("dividendYield") or 0) * 100 if q.get("dividendYield") else None,
        "trailing_eps": q.get("epsTrailingTwelveMonths"),
        "beta": q.get("beta"),
        "fifty_two_week_high": q.get("fiftyTwoWeekHigh"),
        "fifty_two_week_low": q.get("fiftyTwoWeekLow"),
        "fifty_day_avg": q.get("fiftyDayAverage"),
        "two_hundred_day_avg": q.get("twoHundredDayAverage"),
        "high_24h_usd": q.get("regularMarketDayHigh"),
        "low_24h_usd": q.get("regularMarketDayLow"),
        "total_volume_24h_usd": q.get("regularMarketVolume"),
        "avg_volume_3m": q.get("averageDailyVolume3Month"),
        "price_change_24h_pct": q.get("regularMarketChangePercent"),
        "shares_outstanding": q.get("sharesOutstanding"),
        "earnings_date": q.get("earningsTimestamp"),
    }


# ── Fear & Greed Index (free, no key) ─────────────────────────────────────────

async def fetch_fear_greed_index() -> Optional[dict]:
    """Crypto Fear & Greed Index — current value + 30 day trend."""
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(f"{FNG_BASE}?limit=30&format=json", headers=HEADERS)
            r.raise_for_status()
            data = r.json().get("data") or []
            if not data:
                return None
            current = data[0]
            return {
                "value": int(current.get("value", 50)),
                "value_classification": current.get("value_classification", "Neutral"),
                "timestamp": current.get("timestamp"),
                "history_30d": [
                    {"t": int(d["timestamp"]), "value": int(d["value"]), "label": d["value_classification"]}
                    for d in data
                ],
            }
        except Exception as e:
            log.warning("Fear & Greed Index failed: %s", e)
            return None


# ── Public orchestrator ───────────────────────────────────────────────────────

class MetadataLoader:
    """Tiny in-memory cache so we don't hammer free APIs."""

    def __init__(self, ttl_seconds: int = 600) -> None:
        self._cache: dict[str, tuple[float, dict]] = {}
        self._ttl = ttl_seconds

    async def get(self, symbol: str) -> dict[str, Any]:
        # Cache check
        cached = self._cache.get(symbol)
        if cached and (time.time() - cached[0]) < self._ttl:
            return cached[1]

        if symbol in CRYPTO_TO_COINGECKO:
            meta = await fetch_coingecko_full(symbol)
            fng = await fetch_fear_greed_index()
            payload = {"metadata": meta, "fear_greed": fng, "source": "coingecko+fng"}
        else:
            meta = await fetch_yahoo_quote(symbol)
            payload = {"metadata": meta, "fear_greed": None, "source": "yahoo"}

        self._cache[symbol] = (time.time(), payload)
        return payload


metadata_loader = MetadataLoader()
