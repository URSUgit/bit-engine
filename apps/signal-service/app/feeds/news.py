"""
News sentiment feed.
Primary: CryptoPanic free API (no key needed).
Fallback: price-action-based sentiment proxy when news is unavailable.
"""
from __future__ import annotations

import logging

import httpx

log = logging.getLogger(__name__)

CRYPTOPANIC_BASE = "https://cryptopanic.com/api/free/v1"


async def fetch_crypto_news(currencies: str = "BTC,ETH,SOL,BNB") -> list[dict]:
    """
    Fetch recent crypto news from CryptoPanic public API.
    Returns empty list on failure (sentiment will fall back to price-action proxy).
    """
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.get(
                f"{CRYPTOPANIC_BASE}/posts/",
                params={
                    "auth_token": "free",
                    "currencies": currencies,
                    "filter": "hot",
                    "public": "true",
                },
                headers={"User-Agent": "Mozilla/5.0 (compatible; BitPrivat/1.0)"},
            )
            r.raise_for_status()
            items = r.json().get("results", [])
            return [
                {
                    "title": item.get("title", ""),
                    "source": item.get("source", {}).get("title", ""),
                    "currencies": [c["code"] for c in item.get("currencies", [])],
                    "votes": item.get("votes", {}),
                    "published_at": item.get("published_at", ""),
                }
                for item in items[:20]
            ]
        except Exception as e:
            log.info("CryptoPanic unavailable: %s — using price-action sentiment", e)
            return []


def score_news_sentiment(news_items: list[dict]) -> dict[str, float]:
    """
    Compute per-currency sentiment from CryptoPanic vote metadata.
    Returns dict of currency_ticker -> score in [-1, 1].

    CryptoPanic votes: liked, disliked, important, lol, toxic
    """
    if not news_items:
        return {}

    scores: dict[str, list[float]] = {}
    for item in news_items:
        votes = item.get("votes", {})
        liked = votes.get("liked", 0) or 0
        disliked = votes.get("disliked", 0) or 0
        important = votes.get("important", 0) or 0
        toxic = votes.get("toxic", 0) or 0

        total = liked + disliked + important + toxic
        if total == 0:
            sentiment = 0.0
        else:
            positive = liked + important * 0.5
            negative = disliked + toxic
            sentiment = (positive - negative) / total

        for currency in item.get("currencies", []):
            scores.setdefault(currency.upper(), []).append(sentiment)

    return {
        currency: round(sum(vals) / len(vals), 3)
        for currency, vals in scores.items()
        if vals
    }


def sentiment_from_price_action(price_change_pct: float) -> float:
    """
    Proxy sentiment from 24h price change when news is unavailable.
    Strong moves imply crowd sentiment. Normalised to [-1, 1].
    """
    return max(-1.0, min(1.0, price_change_pct / 20.0))
