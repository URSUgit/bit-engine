"""Heikin Ashi Trend strategy — smoothed candlestick trend follower."""
from __future__ import annotations

import math
from .base import Strategy, StrategyContext, Signal


def _ha_bars(bars) -> list[tuple[float, float, float, float]]:
    """Returns list of (ha_open, ha_high, ha_low, ha_close)."""
    result: list[tuple[float, float, float, float]] = []
    for i, b in enumerate(bars):
        ha_close = (b.open + b.high + b.low + b.close) / 4
        if i == 0:
            ha_open = (b.open + b.close) / 2
        else:
            ha_open = (result[i - 1][0] + result[i - 1][3]) / 2
        ha_high = max(b.high, ha_open, ha_close)
        ha_low  = min(b.low,  ha_open, ha_close)
        result.append((ha_open, ha_high, ha_low, ha_close))
    return result


def _atr_simple(bars, period: int) -> float:
    """Simple ATR for the last `period` bars."""
    trs: list[float] = []
    for i in range(max(1, len(bars) - period), len(bars)):
        hl  = bars[i].high - bars[i].low
        hpc = abs(bars[i].high - bars[i - 1].close)
        lpc = abs(bars[i].low  - bars[i - 1].close)
        trs.append(max(hl, hpc, lpc))
    return sum(trs) / len(trs) if trs else 0.0


class HeikinAshiStrategy(Strategy):
    name = "heikin_ashi"
    description = (
        "Heikin Ashi trend follower: uses smoothed HA bars to identify clean trends. "
        "Enters on consecutive bullish HA candles with no lower wicks; exits on reversal."
    )

    params = {
        "confirm_bars": {"default": 2, "min": 1, "max": 5, "step": 1, "label": "Consecutive HA bull bars to enter", "type": "int"},
        "no_lower_wick": {"default": 1, "min": 0, "max": 1, "step": 1, "label": "Require no lower wick (0/1)", "type": "int"},
        "atr_period": {"default": 14, "min": 5, "max": 30, "step": 1, "label": "ATR Period (for noise filter)", "type": "int"},
        "min_bars": {"default": 40, "min": 20, "max": 200, "step": 10, "label": "Min warmup bars", "type": "int"},
    }

    def on_bar(self, ctx: StrategyContext) -> Signal:
        confirm  = int(self.get_param("confirm_bars", 2))
        no_wick  = int(self.get_param("no_lower_wick", 1))
        atr_p    = int(self.get_param("atr_period", 14))
        min_bars = int(self.get_param("min_bars", 40))

        h = ctx.history
        needed = confirm + atr_p + 2
        if len(h) < max(needed, min_bars):
            return "hold"

        ha = _ha_bars(h)

        # Check the last `confirm` HA bars are bullish
        recent_ha = ha[-(confirm + 1):]  # one extra for context

        def is_bull(bar: tuple[float, float, float, float]) -> bool:
            ha_open, ha_high, ha_low, ha_close = bar
            if ha_close <= ha_open:
                return False
            if no_wick and (ha_low < min(ha_open, ha_close) - 1e-10):
                return False
            return True

        def is_bear(bar: tuple[float, float, float, float]) -> bool:
            ha_open, ha_high, ha_low, ha_close = bar
            return ha_close < ha_open

        all_bull = all(is_bull(recent_ha[i]) for i in range(-confirm, 0))
        curr_bear = is_bear(ha[-1])
        prev_bull = is_bull(ha[-2])

        # ATR noise filter — require current candle body > 0.1 * ATR
        atr = _atr_simple(h, atr_p)
        curr_ha = ha[-1]
        body = abs(curr_ha[3] - curr_ha[0])
        if atr > 0 and body < 0.1 * atr:
            return "hold"

        if all_bull and not ctx.position:
            return "buy"

        if ctx.position and ctx.position.side == "long":
            # Exit on first bearish HA candle after a bull run
            if curr_bear and prev_bull:
                return "sell"

        return "hold"
