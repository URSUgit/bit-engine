"""In-memory price + signal cache with TTL expiry."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class PriceRecord:
    symbol: str
    price: float
    price_change_pct_24h: float
    volume_usdt_24h: float
    high_24h: float = 0.0
    low_24h: float = 0.0
    closes: list[float] = field(default_factory=list)
    rsi: float = 50.0
    asset_class: str = "crypto"
    market_cap: float = 0.0
    updated_at: float = field(default_factory=time.time)

    @property
    def age_seconds(self) -> float:
        return time.time() - self.updated_at

    @property
    def is_stale(self) -> bool:
        return self.age_seconds > 120  # 2-minute TTL


class PriceCache:
    def __init__(self) -> None:
        self._prices: dict[str, PriceRecord] = {}
        self._news_sentiment: dict[str, float] = {}
        self._last_refresh: float = 0.0

    # ── prices ──────────────────────────────────────────────────────────────

    def set(self, symbol: str, record: PriceRecord) -> None:
        self._prices[symbol] = record

    def get(self, symbol: str) -> Optional[PriceRecord]:
        return self._prices.get(symbol)

    def all(self) -> list[PriceRecord]:
        return list(self._prices.values())

    def by_asset_class(self, asset_class: str) -> list[PriceRecord]:
        return [r for r in self._prices.values() if r.asset_class == asset_class]

    # ── news sentiment ───────────────────────────────────────────────────────

    def set_sentiment(self, scores: dict[str, float]) -> None:
        self._news_sentiment.update(scores)

    def get_sentiment(self, symbol: str) -> float:
        """Return sentiment score for a symbol (e.g. 'BTC', 'BTCUSDT')."""
        # Try exact match, then strip USDT suffix
        key = symbol.upper().replace("USDT", "").replace("USD", "")
        return self._news_sentiment.get(key, 0.0)

    def all_sentiment(self) -> dict[str, float]:
        return dict(self._news_sentiment)

    # ── metadata ─────────────────────────────────────────────────────────────

    @property
    def last_refresh(self) -> float:
        return self._last_refresh

    def mark_refreshed(self) -> None:
        self._last_refresh = time.time()

    @property
    def seconds_since_refresh(self) -> float:
        return time.time() - self._last_refresh if self._last_refresh else 9999

    def summary(self) -> dict:
        return {
            "symbols": len(self._prices),
            "stale": sum(1 for r in self._prices.values() if r.is_stale),
            "seconds_since_refresh": round(self.seconds_since_refresh, 1),
            "asset_classes": {
                cls: len(self.by_asset_class(cls))
                for cls in {"crypto", "stock", "forex"}
            },
        }


# Module-level singleton
price_cache = PriceCache()
