"""SuperTrend strategy — ATR-based adaptive trend band."""
from __future__ import annotations

from .base import Strategy, StrategyContext, Signal


class SuperTrendStrategy(Strategy):
    name = "supertrend"
    description = "ATR-based SuperTrend trend-following. Enters long/short when price crosses the SuperTrend band."

    params = {
        "atr_period": {"default": 10, "min": 5, "max": 30, "step": 1, "label": "ATR Period", "type": "int"},
        "multiplier": {"default": 3.0, "min": 1.0, "max": 6.0, "step": 0.5, "label": "ATR Multiplier", "type": "float"},
        "min_bars": {"default": 30, "min": 15, "max": 100, "step": 5, "label": "Min bars warmup", "type": "int"},
    }

    def _compute_atr(self, bars, period: int) -> list[float]:
        n = len(bars)
        tr = [bars[0].high - bars[0].low]
        for i in range(1, n):
            h, l, pc = bars[i].high, bars[i].low, bars[i - 1].close
            tr.append(max(h - l, abs(h - pc), abs(l - pc)))
        atr = [0.0] * n
        if n < period:
            return atr
        atr[period - 1] = sum(tr[:period]) / period
        for i in range(period, n):
            atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period
        return atr

    def on_bar(self, ctx: StrategyContext) -> Signal:
        atr_period = int(self.get_param("atr_period", 10))
        mult = self.get_param("multiplier", 3.0)
        min_bars = int(self.get_param("min_bars", 30))

        h = ctx.history
        if len(h) < max(atr_period + 5, min_bars):
            return "hold"

        atrs = self._compute_atr(h, atr_period)
        n = len(h)

        # Build SuperTrend bands iteratively (vectorized-ish in Python)
        up_basic = [(h[i].high + h[i].low) / 2 + mult * atrs[i] for i in range(n)]
        dn_basic = [(h[i].high + h[i].low) / 2 - mult * atrs[i] for i in range(n)]

        up = [up_basic[0]] * n
        dn = [dn_basic[0]] * n
        trend = [1] * n  # 1 = uptrend, -1 = downtrend

        for i in range(1, n):
            up[i] = min(up_basic[i], up[i - 1]) if h[i - 1].close > up[i - 1] else up_basic[i]
            dn[i] = max(dn_basic[i], dn[i - 1]) if h[i - 1].close < dn[i - 1] else dn_basic[i]
            if trend[i - 1] == 1:
                trend[i] = 1 if h[i].close > dn[i] else -1
            else:
                trend[i] = -1 if h[i].close < up[i] else 1

        curr_trend = trend[-1]
        prev_trend = trend[-2]

        if prev_trend == -1 and curr_trend == 1:
            return "buy"
        if prev_trend == 1 and curr_trend == -1:
            return "sell" if ctx.position and ctx.position.side == "long" else "hold"

        return "hold"
