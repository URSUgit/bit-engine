"""Signal generation engine — RSI + momentum + news sentiment."""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone

from .cache import PriceCache, PriceRecord, price_cache
from .crypto import fetch_all_crypto
from .stocks import fetch_all_stocks, fetch_all_forex
from .news import fetch_crypto_news, score_news_sentiment, sentiment_from_price_action

log = logging.getLogger(__name__)

CRYPTO_TO_TICKER = {
    "BTCUSDT": "BTC",
    "ETHUSDT": "ETH",
    "SOLUSDT": "SOL",
    "BNBUSDT": "BNB",
    "ADAUSDT": "ADA",
    "XRPUSDT": "XRP",
    "DOGEUSDT": "DOGE",
    "AVAXUSDT": "AVAX",
}


# ── Technical indicators ──────────────────────────────────────────────────────

def compute_rsi(closes: list[float], period: int = 14) -> float:
    """Standard 14-period Wilder RSI. Returns 50 if insufficient data."""
    if len(closes) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, len(closes)):
        delta = closes[i] - closes[i - 1]
        gains.append(max(delta, 0.0))
        losses.append(max(-delta, 0.0))
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100.0 - (100.0 / (1.0 + rs)), 2)


# ── Signal generation ─────────────────────────────────────────────────────────

def _generate_signal(record: PriceRecord, sentiment: float) -> dict | None:
    """
    Generate a signal dict for a price record + sentiment score.
    Returns None if no actionable signal exists.

    Rules:
      RSI < 28 OR (RSI < 35 AND sentiment > 0.1)  → BUY
      RSI > 72 OR (RSI > 65 AND sentiment < -0.1) → SELL
      Otherwise → None (no signal)

    Confidence = blend of RSI extremity + abs(sentiment) + abs(price_change)
    """
    rsi = record.rsi
    pct_change = record.price_change_pct_24h
    symbol = record.symbol
    asset = CRYPTO_TO_TICKER.get(symbol, symbol)

    direction = None
    reasoning_parts = []

    if rsi < 28 or (rsi < 35 and sentiment > 0.1):
        direction = "buy"
        reasoning_parts.append(f"RSI={rsi:.1f} (oversold)")
    elif rsi > 72 or (rsi > 65 and sentiment < -0.1):
        direction = "sell"
        reasoning_parts.append(f"RSI={rsi:.1f} (overbought)")

    if direction is None and abs(pct_change) >= 7:
        direction = "buy" if pct_change > 0 else "sell"
        reasoning_parts.append(f"Strong momentum {pct_change:+.1f}% in 24h")

    if direction is None:
        return None

    if sentiment > 0.15:
        reasoning_parts.append(f"bullish news sentiment ({sentiment:+.2f})")
    elif sentiment < -0.15:
        reasoning_parts.append(f"bearish news sentiment ({sentiment:+.2f})")

    # Confidence: 0.40 base + RSI contribution + sentiment contribution
    rsi_extreme = max(0, (50 - rsi) / 50 if direction == "buy" else (rsi - 50) / 50)
    sentiment_boost = min(0.2, abs(sentiment) * 0.4)
    momentum_boost = min(0.15, abs(pct_change) / 40)
    confidence = round(min(0.97, 0.40 + rsi_extreme * 0.35 + sentiment_boost + momentum_boost), 2)

    source = "technical"
    if abs(sentiment) > 0.1:
        source = "finbert" if record.asset_class == "crypto" else "finbert"

    return {
        "id": str(uuid.uuid4()),
        "asset": asset,
        "direction": direction,
        "confidence": confidence,
        "source": source,
        "reasoning": "; ".join(reasoning_parts),
        "metadata": {
            "rsi": rsi,
            "price": record.price,
            "price_change_pct_24h": pct_change,
            "news_sentiment": round(sentiment, 3),
            "asset_class": record.asset_class,
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
        "is_active": True,
    }


# ── Refresh loop ───────────────────────────────────────────────────────────────

class SignalEngine:
    def __init__(self, cache: PriceCache) -> None:
        self._cache = cache
        self._signals: list[dict] = []
        self._running = False

    async def refresh(self) -> None:
        """Fetch all data, compute RSI, generate signals. Called by background task."""
        log.info("SignalEngine: refreshing market data...")
        try:
            crypto_data, news_items, stock_data, forex_data = await asyncio.gather(
                fetch_all_crypto(),
                fetch_crypto_news(),
                fetch_all_stocks(),
                fetch_all_forex(),
                return_exceptions=True,
            )

            # Handle exceptions from gather
            if isinstance(crypto_data, Exception):
                log.warning("Crypto fetch failed: %s", crypto_data)
                crypto_data = {}
            if isinstance(news_items, Exception):
                log.warning("News fetch failed: %s", news_items)
                news_items = []
            if isinstance(stock_data, Exception):
                log.warning("Stock fetch failed: %s", stock_data)
                stock_data = {}
            if isinstance(forex_data, Exception):
                log.warning("Forex fetch failed: %s", forex_data)
                forex_data = {}

            # Update news sentiment
            sentiment_scores = score_news_sentiment(news_items)
            self._cache.set_sentiment(sentiment_scores)

            # Process crypto
            for symbol, data in crypto_data.items():
                closes = data.get("closes", [])
                rsi = compute_rsi(closes)
                rec = PriceRecord(
                    symbol=symbol,
                    price=data["price"],
                    price_change_pct_24h=data["price_change_pct_24h"],
                    volume_usdt_24h=data["volume_usdt_24h"],
                    high_24h=data.get("high_24h", 0),
                    low_24h=data.get("low_24h", 0),
                    closes=closes,
                    rsi=rsi,
                    asset_class="crypto",
                )
                self._cache.set(symbol, rec)

            # Process stocks
            for symbol, data in stock_data.items():
                closes = data.get("closes", [])
                rsi = compute_rsi(closes)
                rec = PriceRecord(
                    symbol=symbol,
                    price=data["price"],
                    price_change_pct_24h=data["price_change_pct_24h"],
                    volume_usdt_24h=data.get("volume_usdt_24h", 0),
                    high_24h=data.get("high_24h", 0),
                    low_24h=data.get("low_24h", 0),
                    closes=closes,
                    rsi=rsi,
                    asset_class="stock",
                )
                self._cache.set(symbol, rec)

            # Process forex
            for symbol, data in forex_data.items():
                rec = PriceRecord(
                    symbol=symbol,
                    price=data["price"],
                    price_change_pct_24h=data.get("price_change_pct_24h", 0),
                    volume_usdt_24h=0,
                    rsi=50.0,
                    asset_class="forex",
                )
                self._cache.set(symbol, rec)

            # Generate signals
            news_available = bool(sentiment_scores)
            new_signals = []
            for record in self._cache.all():
                ticker = CRYPTO_TO_TICKER.get(record.symbol, record.symbol)
                if news_available:
                    sentiment = self._cache.get_sentiment(ticker)
                else:
                    # Fall back to price-action proxy when news feed is down
                    sentiment = sentiment_from_price_action(record.price_change_pct_24h)
                sig = _generate_signal(record, sentiment)
                if sig:
                    new_signals.append(sig)

            # Keep most recent 200 signals
            self._signals = sorted(
                new_signals + [s for s in self._signals if s not in new_signals],
                key=lambda s: s["confidence"],
                reverse=True,
            )[:200]

            self._cache.mark_refreshed()
            log.info(
                "SignalEngine: refreshed — %d prices, %d signals generated",
                len(self._cache.all()),
                len(new_signals),
            )
        except Exception as e:
            log.error("SignalEngine refresh error: %s", e, exc_info=True)

    def get_signals(
        self,
        asset: str | None = None,
        direction: str | None = None,
        source: str | None = None,
        min_confidence: float = 0.0,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        sigs = self._signals
        if asset:
            sigs = [s for s in sigs if s["asset"].upper() == asset.upper()]
        if direction:
            sigs = [s for s in sigs if s["direction"] == direction]
        if source:
            sigs = [s for s in sigs if s["source"] == source]
        sigs = [s for s in sigs if s["confidence"] >= min_confidence]
        return sigs[offset: offset + limit]

    def get_signal_by_id(self, signal_id: str) -> dict | None:
        return next((s for s in self._signals if s["id"] == signal_id), None)

    async def start_background_refresh(self, interval_seconds: int = 60) -> None:
        """Run periodic refresh loop. Called on app startup."""
        self._running = True
        # Run once immediately
        await self.refresh()
        # Then loop
        while self._running:
            await asyncio.sleep(interval_seconds)
            if self._running:
                await self.refresh()

    def stop(self) -> None:
        self._running = False


# Module-level singleton
signal_engine = SignalEngine(price_cache)
