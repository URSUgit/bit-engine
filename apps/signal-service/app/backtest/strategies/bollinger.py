"""Bollinger Bands mean reversion."""
from __future__ import annotations

import math

from .base import Strategy, StrategyContext
from ..models import Signal


class BollingerStrategy(Strategy):
    name = "bollinger"
    description = "Buy when price closes below lower band; exit when it crosses back above the middle (SMA)."
    params_schema = {
        "period":  {"type": "int",   "default": 20,  "min": 5,   "max": 100},
        "std_dev": {"type": "float", "default": 2.0, "min": 1.0, "max": 4.0},
    }

    def on_bar(self, ctx: StrategyContext) -> Signal:
        closes = ctx.closes
        period = int(self.params["period"])
        k = float(self.params["std_dev"])

        if len(closes) < period:
            return "hold"

        window = closes[-period:]
        sma = sum(window) / period
        variance = sum((c - sma) ** 2 for c in window) / period
        std = math.sqrt(variance)
        upper = sma + k * std
        lower = sma - k * std
        price = closes[-1]

        if ctx.position is None:
            if price < lower:
                return "buy"
        else:
            if price > sma:
                return "close"
        return "hold"
