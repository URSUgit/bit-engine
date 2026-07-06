"""RSI with MA trend filter — only takes RSI signals in the direction of the trend."""
from __future__ import annotations

from .base import Strategy, StrategyContext, Signal


def _ema(values: list[float], period: int) -> list[float]:
    if len(values) < period:
        return [float("nan")] * len(values)
    k = 2.0 / (period + 1)
    result = [float("nan")] * len(values)
    result[period - 1] = sum(values[:period]) / period
    for i in range(period, len(values)):
        result[i] = values[i] * k + result[i - 1] * (1 - k)
    return result


def _rsi(closes: list[float], period: int) -> list[float]:
    n = len(closes)
    result = [float("nan")] * n
    if n <= period:
        return result
    avg_gain = avg_loss = 0.0
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        if d > 0:
            avg_gain += d
        else:
            avg_loss -= d
    avg_gain /= period
    avg_loss /= period

    def rsi_val(g: float, l: float) -> float:
        return 100.0 if l == 0 else 100 - 100 / (1 + g / l)

    result[period] = rsi_val(avg_gain, avg_loss)
    for i in range(period + 1, n):
        d = closes[i] - closes[i - 1]
        g = max(d, 0)
        l = abs(min(d, 0))
        avg_gain = (avg_gain * (period - 1) + g) / period
        avg_loss = (avg_loss * (period - 1) + l) / period
        result[i] = rsi_val(avg_gain, avg_loss)
    return result


class RSIMAFilterStrategy(Strategy):
    name = "rsi_ma_filter"
    description = (
        "RSI with EMA trend filter: only takes oversold RSI signals when price is above "
        "the slow EMA (uptrend), avoiding counter-trend trades in downtrends."
    )

    params = {
        "rsi_period":  {"default": 14, "min": 5, "max": 30,  "step": 1,    "label": "RSI Period",       "type": "int"},
        "oversold":    {"default": 35, "min": 20, "max": 50,  "step": 1,    "label": "Oversold Level",   "type": "int"},
        "overbought":  {"default": 65, "min": 50, "max": 80,  "step": 1,    "label": "Overbought Level", "type": "int"},
        "ema_period":  {"default": 50, "min": 10, "max": 200, "step": 5,    "label": "Trend EMA Period", "type": "int"},
        "min_bars":    {"default": 60, "min": 30, "max": 200, "step": 10,   "label": "Min warmup bars",  "type": "int"},
    }

    def on_bar(self, ctx: StrategyContext) -> Signal:
        rsi_p    = int(self.get_param("rsi_period", 14))
        oversold = self.get_param("oversold", 35)
        overbought = self.get_param("overbought", 65)
        ema_p    = int(self.get_param("ema_period", 50))
        min_b    = int(self.get_param("min_bars", 60))

        h = ctx.history
        needed = max(rsi_p, ema_p) + 2
        if len(h) < max(needed, min_b):
            return "hold"

        closes = [b.close for b in h]
        rsi = _rsi(closes, rsi_p)
        ema = _ema(closes, ema_p)

        curr_rsi = rsi[-1]
        prev_rsi = rsi[-2]
        curr_ema = ema[-1]

        if curr_rsi != curr_rsi or prev_rsi != prev_rsi or curr_ema != curr_ema:
            return "hold"

        curr_close = h[-1].close
        in_uptrend = curr_close > curr_ema

        # Buy: RSI crosses above oversold in an uptrend
        if not ctx.position:
            if in_uptrend and prev_rsi <= oversold and curr_rsi > oversold:
                return "buy"

        # Exit: RSI crosses into overbought
        if ctx.position and ctx.position.side == "long":
            if curr_rsi >= overbought:
                return "sell"
            # Stop: price fell below EMA — trend invalidated
            if not in_uptrend:
                return "sell"

        return "hold"
