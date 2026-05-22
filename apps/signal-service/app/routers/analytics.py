from __future__ import annotations

import asyncio

from fastapi import APIRouter, Query

from app.feeds import price_cache, signal_engine
from app.feeds.crypto import fetch_binance_funding_rate, fetch_binance_open_interest

router = APIRouter()

_ASSET_TO_BINANCE = {
    "BTC": "BTCUSDT", "ETH": "ETHUSDT", "SOL": "SOLUSDT",
    "BNB": "BNBUSDT", "ADA": "ADAUSDT", "XRP": "XRPUSDT",
    "DOGE": "DOGEUSDT", "AVAX": "AVAXUSDT",
}


@router.get("/sentiment/{asset}")
async def get_asset_sentiment(asset: str, period: str = Query("24h")):
    """Aggregated sentiment for an asset from news + technical signals."""
    a = asset.upper()
    news_score = price_cache.get_sentiment(a)

    # Derive signal-based sentiment from recent signals for this asset
    sigs = signal_engine.get_signals(asset=a, limit=100)
    if sigs:
        buy_count = sum(1 for s in sigs if s["direction"] == "buy")
        sell_count = sum(1 for s in sigs if s["direction"] == "sell")
        total = len(sigs)
        positive_pct = round(buy_count / total * 100, 1)
        negative_pct = round(sell_count / total * 100, 1)
        neutral_pct = round(100 - positive_pct - negative_pct, 1)
        avg_confidence = sum(s["confidence"] for s in sigs) / total
        # Score: weighted blend of signal direction + news
        signal_score = (buy_count - sell_count) / total
        score = round((signal_score * 0.7 + news_score * 0.3), 3)
    else:
        positive_pct = 0.0
        negative_pct = 0.0
        neutral_pct = 100.0
        score = round(news_score, 3)
        avg_confidence = 0.0

    return {
        "asset": a,
        "period": period,
        "score": score,
        "positive_pct": positive_pct,
        "negative_pct": negative_pct,
        "neutral_pct": neutral_pct,
        "signal_count": len(sigs),
        "news_sentiment": round(news_score, 3),
    }


@router.get("/on-chain/{asset}")
async def get_on_chain_analytics(asset: str):
    """On-chain analytics: funding rate, open interest, long/short ratio."""
    a = asset.upper()
    binance_sym = _ASSET_TO_BINANCE.get(a)

    funding_rate = 0.0
    open_interest_usd = 0.0

    if binance_sym:
        try:
            funding_rate, oi_raw = await asyncio.gather(
                fetch_binance_funding_rate(binance_sym),
                fetch_binance_open_interest(binance_sym),
                return_exceptions=True,
            )
            if isinstance(funding_rate, Exception) or funding_rate is None:
                funding_rate = 0.0
            if isinstance(oi_raw, Exception) or oi_raw is None:
                oi_raw = 0.0
            # OI in contracts, approximate USD value using current price
            record = price_cache.get(binance_sym)
            price = record.price if record else 0.0
            open_interest_usd = round(float(oi_raw) * price, 0) if price else 0.0
        except Exception:
            pass

    # Long/short ratio approximation from RSI:
    # RSI 70 → most are long (ratio 3:1 = 3.0), RSI 30 → most short (0.33)
    record = price_cache.get(binance_sym or a)
    rsi = record.rsi if record else 50.0
    long_short_ratio = round(rsi / (100 - rsi) if rsi < 100 else 9.99, 2)

    return {
        "asset": a,
        "funding_rate": round(float(funding_rate), 6),
        "open_interest_usd": open_interest_usd,
        "long_short_ratio": long_short_ratio,
        "whale_inflow_usd": 0.0,
        "whale_outflow_usd": 0.0,
        "liquidations_24h_usd": 0.0,
        "rsi": rsi,
    }


@router.get("/prices")
async def get_prices(asset_class: str = Query("crypto")):
    """Current prices for all tracked assets by class (crypto|stock|forex)."""
    records = price_cache.by_asset_class(asset_class)
    return [
        {
            "symbol": r.symbol,
            "price": r.price,
            "price_change_pct_24h": r.price_change_pct_24h,
            "volume_usdt_24h": r.volume_usdt_24h,
            "high_24h": r.high_24h,
            "low_24h": r.low_24h,
            "rsi": r.rsi,
            "asset_class": r.asset_class,
            "age_seconds": round(r.age_seconds, 1),
        }
        for r in records
    ]


@router.get("/correlation")
async def get_correlation_matrix(assets: str = Query(..., description="Comma-separated asset list")):
    """Return pairwise price-change correlation matrix (based on cached 24h % changes)."""
    asset_list = [a.strip().upper() for a in assets.split(",")]
    binance_syms = [_ASSET_TO_BINANCE.get(a, a + "USDT") for a in asset_list]

    closes_map: dict[str, list[float]] = {}
    for sym in binance_syms:
        rec = price_cache.get(sym)
        if rec and rec.closes:
            closes_map[sym] = rec.closes

    if len(closes_map) < 2:
        return {"assets": asset_list, "matrix": [], "period": "20h", "note": "insufficient data"}

    # Compute returns
    def returns(closes: list[float]) -> list[float]:
        return [(closes[i] - closes[i - 1]) / closes[i - 1] for i in range(1, len(closes))]

    ret_map = {sym: returns(c) for sym, c in closes_map.items()}
    min_len = min(len(r) for r in ret_map.values())

    matrix = []
    syms = list(ret_map.keys())
    for i, s1 in enumerate(syms):
        row = []
        r1 = ret_map[s1][-min_len:]
        for s2 in syms:
            r2 = ret_map[s2][-min_len:]
            if min_len < 2:
                row.append(0.0)
                continue
            mean1 = sum(r1) / min_len
            mean2 = sum(r2) / min_len
            cov = sum((a - mean1) * (b - mean2) for a, b in zip(r1, r2)) / min_len
            std1 = (sum((a - mean1) ** 2 for a in r1) / min_len) ** 0.5
            std2 = (sum((b - mean2) ** 2 for b in r2) / min_len) ** 0.5
            corr = cov / (std1 * std2) if std1 * std2 > 0 else 0.0
            row.append(round(corr, 3))
        matrix.append(row)

    return {
        "assets": [s.replace("USDT", "") for s in syms],
        "matrix": matrix,
        "period": f"{min_len}h",
    }
