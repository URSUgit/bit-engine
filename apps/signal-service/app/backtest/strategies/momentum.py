"""Momentum / breakout strategy — buy strength, exit on weakness."""
from __future__ import annotations

from .base import Strategy, StrategyContext
from ..models import Signal


class MomentumStrategy(Strategy):
    name = "momentum"
    description = (
        "Buy when N-bar return exceeds threshold and price is above its lookback MA. "
        "Exit when N-bar return turns negative or price falls below MA."
    )
    params_schema = {
        "lookback":       {"type": "int",   "default": 20,   "min": 5,   "max": 200},
        "entry_pct":      {"type": "float", "default": 5.0,  "min": 0.5, "max": 50},
        "trail_stop_pct": {"type": "float", "default": 8.0,  "min": 1.0, "max": 50},
    }

    def on_bar(self, ctx: StrategyContext) -> Signal:
        closes = ctx.closes
        lookback = int(self.params["lookback"])
        entry_pct = float(self.params["entry_pct"])
        trail_pct = float(self.params["trail_stop_pct"])

        if len(closes) < lookback + 1:
            return "hold"

        ret_pct = (closes[-1] - closes[-lookback - 1]) / closes[-lookback - 1] * 100
        sma = sum(closes[-lookback:]) / lookback

        if ctx.position is None:
            if ret_pct >= entry_pct and closes[-1] > sma:
                return "buy"
        else:
            # Trailing stop from highest close since entry
            in_trade_closes = [
                b.close for b in ctx.history if b.timestamp >= ctx.position.entry_time
            ]
            peak = max(in_trade_closes) if in_trade_closes else closes[-1]
            drawdown_from_peak = (peak - closes[-1]) / peak * 100 if peak > 0 else 0
            if drawdown_from_peak >= trail_pct or closes[-1] < sma:
                return "close"
        return "hold"
