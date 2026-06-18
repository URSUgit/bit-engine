"""Keltner Channel strategy — ATR-based envelope breakout/mean-reversion."""
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


def _atr(bars, period: int) -> list[float]:
    n = len(bars)
    result = [float("nan")] * n
    trs: list[float] = []
    for i in range(1, n):
        hl = bars[i].high - bars[i].low
        hpc = abs(bars[i].high - bars[i - 1].close)
        lpc = abs(bars[i].low - bars[i - 1].close)
        trs.append(max(hl, hpc, lpc))
    if len(trs) < period:
        return result
    atr_val = sum(trs[:period]) / period
    result[period] = atr_val
    for i in range(period, len(trs)):
        atr_val = (atr_val * (period - 1) + trs[i]) / period
        result[i + 1] = atr_val
    return result


class KeltnerChannelStrategy(Strategy):
    name = "keltner_channel"
    description = (
        "Keltner Channel breakout: enters long when close breaks above EMA + mult*ATR, "
        "exits when price returns to EMA. Mean-reversion variant also available."
    )

    params = {
        "ema_period": {"default": 20, "min": 5, "max": 100, "step": 1, "label": "EMA Period", "type": "int"},
        "atr_period": {"default": 14, "min": 5, "max": 30, "step": 1, "label": "ATR Period", "type": "int"},
        "multiplier": {"default": 2.0, "min": 0.5, "max": 4.0, "step": 0.25, "label": "ATR Multiplier", "type": "float"},
        "mode": {"default": 0, "min": 0, "max": 1, "step": 1, "label": "Mode (0=breakout, 1=reversion)", "type": "int"},
        "min_bars": {"default": 50, "min": 30, "max": 200, "step": 10, "label": "Min bars warmup", "type": "int"},
    }

    def on_bar(self, ctx: StrategyContext) -> Signal:
        ema_p = int(self.get_param("ema_period", 20))
        atr_p = int(self.get_param("atr_period", 14))
        mult  = self.get_param("multiplier", 2.0)
        mode  = int(self.get_param("mode", 0))
        min_b = int(self.get_param("min_bars", 50))

        h = ctx.history
        needed = max(ema_p, atr_p) + 2
        if len(h) < max(needed, min_b):
            return "hold"

        closes = [b.close for b in h]
        ema    = _ema(closes, ema_p)
        atr    = _atr(h, atr_p)

        curr_ema = ema[-1]
        curr_atr = atr[-1]
        prev_ema = ema[-2]
        if curr_ema != curr_ema or curr_atr != curr_atr or curr_atr == 0:
            return "hold"

        upper = curr_ema + mult * curr_atr
        lower = curr_ema - mult * curr_atr
        prev_upper = prev_ema + mult * (atr[-2] if atr[-2] == atr[-2] else curr_atr)

        curr_close = h[-1].close
        prev_close = h[-2].close

        if mode == 0:
            # Breakout mode: buy above upper, exit at EMA
            just_broke_up = prev_close <= prev_upper and curr_close > upper
            if just_broke_up:
                return "buy"
            if ctx.position and ctx.position.side == "long":
                if curr_close < curr_ema:
                    return "sell"
        else:
            # Mean-reversion: buy at lower band touch, exit at EMA/upper
            below_lower = curr_close < lower and prev_close >= lower
            if below_lower:
                return "buy"
            if ctx.position and ctx.position.side == "long":
                if curr_close >= curr_ema:
                    return "sell"

        return "hold"
