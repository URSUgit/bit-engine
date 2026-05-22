"""RSI mean-reversion strategy — buy when oversold, sell when overbought."""
from __future__ import annotations

from .base import Strategy, StrategyContext
from ..models import Signal


def _rsi(closes: list[float], period: int) -> float:
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
    return 100.0 - (100.0 / (1.0 + rs))


class RSIStrategy(Strategy):
    name = "rsi"
    description = "Buy when RSI crosses below the oversold threshold; sell when it crosses above overbought."
    params_schema = {
        "period":      {"type": "int",   "default": 14, "min": 2,  "max": 50},
        "oversold":    {"type": "float", "default": 30, "min": 10, "max": 45},
        "overbought":  {"type": "float", "default": 70, "min": 55, "max": 90},
    }

    def on_bar(self, ctx: StrategyContext) -> Signal:
        closes = ctx.closes
        period = int(self.params["period"])
        if len(closes) < period + 2:
            return "hold"

        rsi_now = _rsi(closes, period)
        rsi_prev = _rsi(closes[:-1], period)
        oversold = float(self.params["oversold"])
        overbought = float(self.params["overbought"])

        if ctx.position is None:
            # Enter long when RSI crosses up through oversold
            if rsi_prev <= oversold < rsi_now:
                return "buy"
        else:
            # Exit when RSI crosses down through overbought
            if rsi_prev >= overbought > rsi_now:
                return "close"

        return "hold"
