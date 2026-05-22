"""Moving average crossover — classic trend-following strategy."""
from __future__ import annotations

from .base import Strategy, StrategyContext
from ..models import Signal


def _sma(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


class MACrossStrategy(Strategy):
    name = "ma_cross"
    description = "Buy when fast MA crosses above slow MA; exit when it crosses below."
    params_schema = {
        "fast_period": {"type": "int", "default": 20,  "min": 2,  "max": 100},
        "slow_period": {"type": "int", "default": 50, "min": 5,  "max": 400},
    }

    def on_bar(self, ctx: StrategyContext) -> Signal:
        closes = ctx.closes
        fast_p = int(self.params["fast_period"])
        slow_p = int(self.params["slow_period"])
        if len(closes) < slow_p + 1:
            return "hold"

        fast_now = _sma(closes, fast_p)
        slow_now = _sma(closes, slow_p)
        fast_prev = _sma(closes[:-1], fast_p)
        slow_prev = _sma(closes[:-1], slow_p)

        if None in (fast_now, slow_now, fast_prev, slow_prev):
            return "hold"

        if ctx.position is None:
            if fast_prev <= slow_prev and fast_now > slow_now:
                return "buy"
        else:
            if fast_prev >= slow_prev and fast_now < slow_now:
                return "close"
        return "hold"
