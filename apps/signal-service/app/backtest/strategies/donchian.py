"""Donchian Channel breakout strategy — Richard Donchian's trend-following system."""
from __future__ import annotations

from .base import Strategy, StrategyContext, Signal


class DonchianChannelStrategy(Strategy):
    name = "donchian_channel"
    description = (
        "Donchian Channel: buys on 20-bar high breakout, exits when price falls below "
        "the lower 10-bar channel. Classic turtle-trading variant."
    )

    params = {
        "entry_period": {"default": 20, "min": 5, "max": 100, "step": 1, "label": "Entry Channel Period", "type": "int"},
        "exit_period":  {"default": 10, "min": 2, "max": 50,  "step": 1, "label": "Exit Channel Period",  "type": "int"},
        "min_bars":     {"default": 30, "min": 20, "max": 200, "step": 10, "label": "Min warmup bars", "type": "int"},
    }

    def on_bar(self, ctx: StrategyContext) -> Signal:
        entry_p = int(self.get_param("entry_period", 20))
        exit_p  = int(self.get_param("exit_period", 10))
        min_b   = int(self.get_param("min_bars", 30))

        h = ctx.history
        needed = max(entry_p, exit_p) + 2
        if len(h) < max(needed, min_b):
            return "hold"

        # Donchian entry: current close > highest high of last `entry_p` bars (excluding current)
        entry_highs = [b.high for b in h[-(entry_p + 1):-1]]
        entry_high  = max(entry_highs) if entry_highs else float("inf")

        # Donchian exit: current close < lowest low of last `exit_p` bars (excluding current)
        exit_lows = [b.low for b in h[-(exit_p + 1):-1]]
        exit_low  = min(exit_lows) if exit_lows else float("-inf")

        curr_close = h[-1].close

        if not ctx.position:
            if curr_close > entry_high:
                return "buy"
        elif ctx.position.side == "long":
            if curr_close < exit_low:
                return "sell"

        return "hold"
