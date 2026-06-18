"""DEMA Cross strategy — Double Exponential Moving Average crossover."""
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


def _dema(closes: list[float], period: int) -> list[float]:
    """DEMA = 2 * EMA(close) - EMA(EMA(close)) — reduces lag vs plain EMA."""
    e1 = _ema(closes, period)
    e2 = _ema(e1, period)
    result = []
    for v1, v2 in zip(e1, e2):
        if v1 != v1 or v2 != v2:
            result.append(float("nan"))
        else:
            result.append(2 * v1 - v2)
    return result


class DEMACrossStrategy(Strategy):
    name = "dema_cross"
    description = (
        "Double EMA (DEMA) fast/slow crossover. DEMA reduces lag compared to regular EMA, "
        "giving faster crossover signals while retaining smoothing."
    )

    params = {
        "fast_period":  {"default": 12, "min": 3,  "max": 50,  "step": 1,  "label": "Fast DEMA Period",    "type": "int"},
        "slow_period":  {"default": 26, "min": 10, "max": 200, "step": 1,  "label": "Slow DEMA Period",    "type": "int"},
        "atr_filter":   {"default": 1,  "min": 0,  "max": 1,   "step": 1,  "label": "ATR noise filter 0/1","type": "int"},
        "min_bars":     {"default": 60, "min": 30, "max": 200, "step": 10, "label": "Min warmup bars",     "type": "int"},
    }

    def _simple_atr(self, bars, period: int) -> float:
        trs = []
        for i in range(max(1, len(bars) - period), len(bars)):
            hl  = bars[i].high - bars[i].low
            hpc = abs(bars[i].high - bars[i - 1].close)
            lpc = abs(bars[i].low  - bars[i - 1].close)
            trs.append(max(hl, hpc, lpc))
        return sum(trs) / len(trs) if trs else 0.0

    def on_bar(self, ctx: StrategyContext) -> Signal:
        fast_p   = int(self.get_param("fast_period", 12))
        slow_p   = int(self.get_param("slow_period", 26))
        atr_filt = int(self.get_param("atr_filter", 1))
        min_b    = int(self.get_param("min_bars", 60))

        h = ctx.history
        needed = slow_p * 2 + 2
        if len(h) < max(needed, min_b):
            return "hold"

        closes = [b.close for b in h]
        fast = _dema(closes, fast_p)
        slow = _dema(closes, slow_p)

        curr_fast, prev_fast = fast[-1], fast[-2]
        curr_slow, prev_slow = slow[-1], slow[-2]

        if any(v != v for v in [curr_fast, prev_fast, curr_slow, prev_slow]):
            return "hold"

        # ATR noise filter: require crossover gap > 0.1 * ATR
        if atr_filt:
            atr = self._simple_atr(h, 14)
            if atr > 0 and abs(curr_fast - curr_slow) < 0.1 * atr:
                return "hold"

        crossed_above = prev_fast <= prev_slow and curr_fast > curr_slow
        crossed_below = prev_fast >= prev_slow and curr_fast < curr_slow

        if crossed_above:
            return "buy"
        if crossed_below and ctx.position and ctx.position.side == "long":
            return "sell"
        return "hold"
