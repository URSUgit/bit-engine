"""Aroon Oscillator strategy — trend direction and strength indicator."""
from __future__ import annotations

from .base import Strategy, StrategyContext, Signal


def _aroon(bars, period: int) -> tuple[list[float], list[float]]:
    """Returns (aroon_up, aroon_down) lists."""
    n = len(bars)
    up   = [float("nan")] * n
    down = [float("nan")] * n
    for i in range(period, n):
        window = bars[i - period:i + 1]
        hh_pos = max(range(len(window)), key=lambda x: window[x].high)
        ll_pos = max(range(len(window)), key=lambda x: -window[x].low)
        bars_since_high = period - hh_pos
        bars_since_low  = period - ll_pos
        up[i]   = (period - bars_since_high) / period * 100
        down[i] = (period - bars_since_low)  / period * 100
    return up, down


class AroonStrategy(Strategy):
    name = "aroon"
    description = (
        "Aroon Oscillator: buys when Aroon Up crosses above Aroon Down above the bullish "
        "threshold; exits when Aroon Up drops below threshold or Down takes over."
    )

    params = {
        "period":    {"default": 25, "min": 5,  "max": 100, "step": 1, "label": "Aroon Period",        "type": "int"},
        "threshold": {"default": 70, "min": 50, "max": 90,  "step": 5, "label": "Bullish Threshold %", "type": "int"},
        "min_bars":  {"default": 40, "min": 20, "max": 200, "step": 10, "label": "Min warmup bars",    "type": "int"},
    }

    def on_bar(self, ctx: StrategyContext) -> Signal:
        period    = int(self.get_param("period", 25))
        threshold = self.get_param("threshold", 70)
        min_b     = int(self.get_param("min_bars", 40))

        h = ctx.history
        if len(h) < max(period + 2, min_b):
            return "hold"

        up, down = _aroon(h, period)

        curr_up, curr_down = up[-1], down[-1]
        prev_up, prev_down = up[-2], down[-2]

        if curr_up != curr_up or curr_down != curr_down:
            return "hold"

        # Bullish cross: up crosses above down AND up is in strong zone
        bullish_cross = prev_up <= prev_down and curr_up > curr_down and curr_up >= threshold
        # Bearish signal for exit
        bearish = curr_down > curr_up or curr_up < threshold - 10

        if not ctx.position:
            if bullish_cross:
                return "buy"
        elif ctx.position.side == "long":
            if bearish:
                return "sell"

        return "hold"
