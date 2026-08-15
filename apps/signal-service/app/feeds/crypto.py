"""Crypto price feed — multi-source with key-free fallbacks.

Source priority (each is free, no API key required):
  1. CoinGecko  — richest data (price, 24h %, volume, market cap, hourly closes)
  2. Kraken     — reliable & global (price, 24h %, high/low/volume + OHLC closes)
  3. Coinbase   — last-resort spot price only

CoinGecko increasingly returns 403 to cloud/datacenter IPs and Binance.com is
geo-blocked in several regions, so Kraken/Coinbase keep prices flowing where
the first two are unavailable.
"""
from __future__ import annotations

import asyncio
import logging
import time

import httpx

log = logging.getLogger(__name__)

COINGECKO_BASE = "https://api.coingecko.com/api/v3"
BINANCE_BASE = "https://api.binance.com/api/v3"
KRAKEN_BASE = "https://api.kraken.com/0/public"
COINBASE_BASE = "https://api.coinbase.com/v2"

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


# Hourly candles only change once an hour, but the refresh loop runs every
# 60s — refetching all 8 coins' klines every cycle was burning through
# CoinGecko's free-tier rate limit and drawing constant 429s. Cache each
# coin's closes for a few minutes so most cycles reuse the last fetch.
_CLOSES_CACHE: dict[str, tuple[float, list[float]]] = {}
_CLOSES_TTL_SECONDS = 300


async def fetch_coingecko_hourly_closes(coin_id: str, hours: int = 20) -> list[float]:
    """
    Fetch hourly close prices from CoinGecko for RSI computation.
    Returns list of close prices (last `hours` hourly candles).
    """
    cached = _CLOSES_CACHE.get(coin_id)
    if cached and time.time() - cached[0] < _CLOSES_TTL_SECONDS:
        return cached[1]

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
            closes = closes[-hours:] if len(closes) >= hours else closes
            _CLOSES_CACHE[coin_id] = (time.time(), closes)
            return closes
        except Exception as e:
            log.warning("CoinGecko klines failed for %s: %s", coin_id, e)
            # Serve stale cache on failure rather than an empty list — a
            # rate-limited cycle shouldn't blank out RSI for a coin we
            # already have good (if slightly old) data for.
            return cached[1] if cached else []


async def fetch_binance_tickers(symbols: list[str]) -> list[dict]:
    """Fallback: fetch tickers from Binance (no key needed)."""
    import json
    # Binance rejects whitespace inside the symbols array — compact separators.
    params = {"symbols": json.dumps(symbols, separators=(",", ":"))}
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


# ── Kraken (key-free, global) ──────────────────────────────────────────────────

# Kraken uses its own ticker symbols. Maps our Binance-style symbol → Kraken pair.
# Note: BNB is not listed on Kraken, so it stays gap-filled by other sources.
KRAKEN_PAIRS = {
    "BTCUSDT": "XBTUSD",
    "ETHUSDT": "ETHUSD",
    "SOLUSDT": "SOLUSD",
    "ADAUSDT": "ADAUSD",
    "XRPUSDT": "XRPUSD",
    "DOGEUSDT": "XDGUSD",
    "AVAXUSDT": "AVAXUSD",
}


async def fetch_kraken_tickers() -> dict[str, dict]:
    """Fetch ticker data for all supported pairs from Kraken in one call.

    Returns dict keyed by Binance-style symbol. Kraken's Ticker response gives
    last price (c), 24h volume (v), high (h), low (l) and today's open (o),
    from which we derive the 24h % change.
    """
    pair_param = ",".join(KRAKEN_PAIRS.values())
    out: dict[str, dict] = {}
    async with httpx.AsyncClient(timeout=12) as client:
        try:
            r = await client.get(
                f"{KRAKEN_BASE}/Ticker", params={"pair": pair_param}, headers=_HEADERS
            )
            r.raise_for_status()
            payload = r.json().get("result", {})
        except Exception as e:
            log.warning("Kraken ticker failed: %s", e)
            return out

    # Kraken returns its own canonical keys (e.g. XXBTZUSD); match by substring.
    for sym, kpair in KRAKEN_PAIRS.items():
        base = kpair.replace("USD", "")
        entry = None
        for kkey, kval in payload.items():
            if kkey == kpair or base in kkey:
                entry = kval
                break
        if not entry:
            continue
        try:
            last = float(entry["c"][0])
            open_24h = float(entry["o"][1]) if isinstance(entry["o"], list) else float(entry["o"])
            change_pct = ((last - open_24h) / open_24h * 100) if open_24h else 0.0
            out[sym] = {
                "symbol": sym,
                "price": last,
                "price_change_pct_24h": change_pct,
                "volume_usdt_24h": float(entry["v"][1]) * last,  # base vol → quote vol
                "high_24h": float(entry["h"][1]),
                "low_24h": float(entry["l"][1]),
                "market_cap": 0.0,
                "closes": [],
            }
        except (KeyError, IndexError, ValueError, TypeError):
            continue
    return out


async def fetch_kraken_hourly_closes(kraken_pair: str, hours: int = 20) -> list[float]:
    """Fetch hourly OHLC closes from Kraken for RSI computation."""
    async with httpx.AsyncClient(timeout=12) as client:
        try:
            r = await client.get(
                f"{KRAKEN_BASE}/OHLC",
                params={"pair": kraken_pair, "interval": 60},
                headers=_HEADERS,
            )
            r.raise_for_status()
            result = r.json().get("result", {})
            # result has one data key plus "last"; grab the candle list
            candles = next((v for k, v in result.items() if k != "last"), [])
            closes = [float(c[4]) for c in candles]  # index 4 = close
            return closes[-hours:] if len(closes) >= hours else closes
        except Exception as e:
            log.warning("Kraken OHLC failed for %s: %s", kraken_pair, e)
            return []


# ── Coinbase (key-free, global, spot price only) ────────────────────────────────

COINBASE_PAIRS = {
    "BTCUSDT": "BTC-USD", "ETHUSDT": "ETH-USD", "SOLUSDT": "SOL-USD",
    "ADAUSDT": "ADA-USD", "XRPUSDT": "XRP-USD", "DOGEUSDT": "DOGE-USD",
    "AVAXUSDT": "AVAX-USD", "BNBUSDT": "BNB-USD",
}


async def fetch_coinbase_spot(symbol: str) -> float:
    """Fetch a single spot price from Coinbase (no key, global)."""
    pair = COINBASE_PAIRS.get(symbol)
    if not pair:
        return 0.0
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(f"{COINBASE_BASE}/prices/{pair}/spot", headers=_HEADERS)
            r.raise_for_status()
            return float(r.json().get("data", {}).get("amount") or 0)
        except Exception:
            return 0.0


# ── Orchestration ───────────────────────────────────────────────────────────────

async def fetch_all_crypto(coins: list[str] = COINGECKO_IDS) -> dict[str, dict]:
    """Fetch tickers + hourly closes for all coins, layering fallback sources.

    Tries CoinGecko first (richest data), then Binance, then Kraken, then
    Coinbase — merging so a later source only fills entries the earlier ones
    left empty. Returns dict keyed by Binance-style symbol (e.g. 'BTCUSDT').
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

    # ── Source 1: CoinGecko ─────────────────────────────────────────────────
    if markets:
        market_map = {m["id"]: m for m in markets}
        for coin_id, closes in zip(coins, klines_list):
            m = market_map.get(coin_id, {})
            sym = COINGECKO_TO_SYMBOL.get(coin_id, coin_id.upper() + "USDT")
            price = float(m.get("current_price") or 0)
            if price <= 0:
                continue
            result[sym] = {
                "symbol": sym,
                "price": price,
                "price_change_pct_24h": float(m.get("price_change_percentage_24h") or 0),
                "volume_usdt_24h": float(m.get("total_volume") or 0),
                "high_24h": float(m.get("high_24h") or 0),
                "low_24h": float(m.get("low_24h") or 0),
                "market_cap": float(m.get("market_cap") or 0),
                "closes": closes,
            }

    def _missing() -> list[str]:
        return [s for s in CRYPTO_SYMBOLS if s not in result or result[s]["price"] <= 0]

    # ── Source 2: Binance ───────────────────────────────────────────────────
    if _missing():
        log.info("CoinGecko incomplete (%d missing), trying Binance", len(_missing()))
        binance_data = await fetch_binance_tickers(CRYPTO_SYMBOLS)
        ticker_map = {t["symbol"]: t for t in binance_data}
        for sym in _missing():
            t = ticker_map.get(sym)
            if not t:
                continue
            price = float(t.get("lastPrice") or 0)
            if price <= 0:
                continue
            result[sym] = {
                "symbol": sym,
                "price": price,
                "price_change_pct_24h": float(t.get("priceChangePercent") or 0),
                "volume_usdt_24h": float(t.get("quoteVolume") or 0),
                "high_24h": float(t.get("highPrice") or 0),
                "low_24h": float(t.get("lowPrice") or 0),
                "market_cap": 0.0,
                "closes": [],
            }

    # ── Source 3: Kraken (ticker + OHLC closes) ─────────────────────────────
    if _missing():
        log.info("Trying Kraken for %d missing symbols", len(_missing()))
        kraken_data = await fetch_kraken_tickers()
        missing = _missing()
        # Fetch closes only for the Kraken-covered symbols we still need
        needed = [s for s in missing if s in kraken_data and s in KRAKEN_PAIRS]
        close_lists = await asyncio.gather(
            *(fetch_kraken_hourly_closes(KRAKEN_PAIRS[s]) for s in needed),
            return_exceptions=True,
        )
        closes_by_sym = {
            s: (cl if not isinstance(cl, Exception) else [])
            for s, cl in zip(needed, close_lists)
        }
        for sym in missing:
            entry = kraken_data.get(sym)
            if not entry:
                continue
            entry["closes"] = closes_by_sym.get(sym, [])
            result[sym] = entry

    # ── Source 4: Coinbase (spot price only, last resort) ───────────────────
    if _missing():
        missing = _missing()
        log.info("Trying Coinbase spot for %d missing symbols", len(missing))
        prices = await asyncio.gather(*(fetch_coinbase_spot(s) for s in missing))
        for sym, price in zip(missing, prices):
            if price > 0:
                result[sym] = {
                    "symbol": sym,
                    "price": price,
                    "price_change_pct_24h": 0.0,
                    "volume_usdt_24h": 0.0,
                    "high_24h": 0.0,
                    "low_24h": 0.0,
                    "market_cap": 0.0,
                    "closes": [],
                }

    if not result:
        log.error("All crypto price sources failed (CoinGecko/Binance/Kraken/Coinbase)")

    return result
