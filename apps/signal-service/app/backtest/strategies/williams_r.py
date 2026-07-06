"""Williams %R strategy — momentum oscillator by Larry Williams."""
from __future__ import annotations

from .base import Strategy, StrategyContext, Signal


class WilliamsRStrategy(Strategy):
    name = "williams_r"
    description = "Williams %R momentum oscillator. Enters long on oversold recovery, exits on overbought."

    params = {
        "period": {"default": 14, "min": 5, "max": 50, "step": 1, "label": "Lookback Period", "type": "int"},
        "oversold": {"default": -80.0, "min": -95.0, "max": -60.0, "step": 5.0, "label": "Oversold Threshold", "type": "float"},
        "overbought": {"default": -20.0, "min": -40.0, "max": -5.0, "step": 5.0, "label": "Overbought Threshold", "type": "float"},
        "confirm_bars": {"default": 2, "min": 1, "max": 5, "step": 1, "label": "Confirmation bars", "type": "int"},
    }

    def _williams_r(self, bars, period: int) -> list[float]:
        n = len(bars)
        result = [float("nan")] * n
        for i in range(period - 1, n):
            window = bars[i - period + 1:i + 1]
            hh = max(b.high for b in window)
            ll = min(b.low for b in window)
            close = bars[i].close
            if hh == ll:
                result[i] = -50.0
            else:
                result[i] = (hh - close) / (hh - ll) * -100.0
        return result

    def on_bar(self, ctx: StrategyContext) -> Signal:
        period = int(self.get_param("period", 14))
        oversold = self.get_param("oversold", -80.0)
        overbought = self.get_param("overbought", -20.0)
        confirm = int(self.get_param("confirm_bars", 2))

        h = ctx.history
        if len(h) < period + confirm + 2:
            return "hold"

        wr = self._williams_r(h, period)

        # Need enough recent values
        recent = wr[-(confirm + 2):]
        if any(v != v for v in recent):
            return "hold"

        curr = wr[-1]
        prev = wr[-2]

        # Buy: was in oversold, now crossing above oversold level
        if prev <= oversold and curr > oversold:
            # All recent bars were in oversold before this one
            if all(wr[-(confirm + 1 + i)] <= oversold for i in range(confirm)):
                return "buy"

        # Exit: crossed into overbought
        if ctx.position and ctx.position.side == "long":
            if prev > overbought and curr <= overbought:
                return "sell"
            if curr >= -5.0:
                return "sell"

        return "hold"
