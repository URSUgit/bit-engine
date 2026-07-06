"""Ichimoku Cloud — Tenkan/Kijun crossover with Kumo confirmation."""
from __future__ import annotations

from .base import Strategy, StrategyContext
from ..models import Signal


class IchimokuStrategy(Strategy):
    name = "ichimoku"
    description = (
        "Ichimoku Cloud: enters long when Tenkan-sen crosses above Kijun-sen "
        "AND price is above the Kumo (cloud). Exits on reverse cross or price "
        "dropping below Kijun-sen."
    )
    params_schema = {
        "tenkan": {"type": "int", "default": 9,   "min": 5,   "max": 20,  "label": "Tenkan-sen period"},
        "kijun":  {"type": "int", "default": 26,  "min": 15,  "max": 52,  "label": "Kijun-sen period"},
        "senkou": {"type": "int", "default": 52,  "min": 26,  "max": 104, "label": "Senkou Span B period"},
    }

    @staticmethod
    def _midpoint(highs: list[float], lows: list[float], period: int) -> float | None:
        if len(highs) < period or len(lows) < period:
            return None
        return (max(highs[-period:]) + min(lows[-period:])) / 2.0

    def on_bar(self, ctx: StrategyContext) -> Signal:
        bars = ctx.history
        tenkan_p = int(self.params["tenkan"])
        kijun_p  = int(self.params["kijun"])
        senkou_p = int(self.params["senkou"])

        min_bars = senkou_p + 1
        if len(bars) < min_bars:
            return "hold"

        highs = [b.high  for b in bars]
        lows  = [b.low   for b in bars]

        # Current values
        tenkan_now = self._midpoint(highs, lows, tenkan_p)
        kijun_now  = self._midpoint(highs, lows, kijun_p)
        if tenkan_now is None or kijun_now is None:
            return "hold"

        # Previous bar values
        tenkan_prev = self._midpoint(highs[:-1], lows[:-1], tenkan_p)
        kijun_prev  = self._midpoint(highs[:-1], lows[:-1], kijun_p)
        if tenkan_prev is None or kijun_prev is None:
            return "hold"

        # Senkou Span A & B — current cloud values (no displacement for backtesting)
        span_a      = (tenkan_now + kijun_now) / 2.0
        span_b      = self._midpoint(highs, lows, senkou_p)
        if span_b is None:
            return "hold"
        kumo_top    = max(span_a, span_b)

        price = bars[-1].close

        if ctx.position is None:
            # Bullish: Tenkan crosses above Kijun AND price is above cloud
            tenkan_crossed_up = tenkan_prev <= kijun_prev and tenkan_now > kijun_now
            if tenkan_crossed_up and price > kumo_top:
                return "buy"
        else:
            # Exit: Tenkan crosses below Kijun OR price drops below Kijun-sen
            tenkan_crossed_down = tenkan_prev >= kijun_prev and tenkan_now < kijun_now
            if tenkan_crossed_down or price < kijun_now:
                return "close"

        return "hold"
