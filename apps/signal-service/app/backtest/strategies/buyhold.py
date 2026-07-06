"""Buy-and-hold benchmark — used to compare any strategy against the underlying asset."""
from __future__ import annotations

from .base import Strategy, StrategyContext
from ..models import Signal


class BuyHoldStrategy(Strategy):
    name = "buy_and_hold"
    description = "Buy on the first bar and hold to the end. Pure benchmark."
    params_schema = {}

    def on_bar(self, ctx: StrategyContext) -> Signal:
        if ctx.position is None:
            return "buy"
        return "hold"
