"""Triple EMA (TEMA) crossover strategy."""
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


def _tema(closes: list[float], period: int) -> list[float]:
    ema1 = _ema(closes, period)
    valid = [v for v in ema1 if v == v]  # non-nan
    if not valid:
        return [float("nan")] * len(closes)
    ema2 = _ema(ema1, period)
    ema3 = _ema(ema2, period)
    result = []
    for e1, e2, e3 in zip(ema1, ema2, ema3):
        if e1 != e1 or e2 != e2 or e3 != e3:
            result.append(float("nan"))
        else:
            result.append(3 * e1 - 3 * e2 + e3)
    return result


class TripleEMAStrategy(Strategy):
    name = "triple_ema"
    description = "Triple EMA (TEMA) fast/slow crossover. Reduces EMA lag for faster signal response."

    params = {
        "fast_period": {"default": 9, "min": 3, "max": 30, "step": 1, "label": "Fast TEMA Period", "type": "int"},
        "slow_period": {"default": 21, "min": 10, "max": 100, "step": 1, "label": "Slow TEMA Period", "type": "int"},
        "signal_period": {"default": 5, "min": 2, "max": 15, "step": 1, "label": "Signal Period (EMA of diff)", "type": "int"},
        "min_bars": {"default": 60, "min": 30, "max": 200, "step": 10, "label": "Min bars warmup", "type": "int"},
    }

    def on_bar(self, ctx: StrategyContext) -> Signal:
        fast_p = int(self.get_param("fast_period", 9))
        slow_p = int(self.get_param("slow_period", 21))
        sig_p = int(self.get_param("signal_period", 5))
        min_bars = int(self.get_param("min_bars", 60))

        h = ctx.history
        if len(h) < max(slow_p * 3 + sig_p, min_bars):
            return "hold"

        closes = [b.close for b in h]
        fast = _tema(closes, fast_p)
        slow = _tema(closes, slow_p)

        # Filter NaN
        diff = [f - s if f == f and s == s else float("nan") for f, s in zip(fast, slow)]

        curr_fast = fast[-1]
        curr_slow = slow[-1]
        prev_fast = fast[-2]
        prev_slow = slow[-2]

        if curr_fast != curr_fast or curr_slow != curr_slow or prev_fast != prev_fast or prev_slow != prev_slow:
            return "hold"

        just_crossed_above = prev_fast < prev_slow and curr_fast >= curr_slow
        just_crossed_below = prev_fast > prev_slow and curr_fast <= curr_slow

        if just_crossed_above:
            return "buy"
        if just_crossed_below:
            if ctx.position and ctx.position.side == "long":
                return "sell"
        return "hold"
