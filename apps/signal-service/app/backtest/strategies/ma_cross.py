"""EMA crossover with ATR trailing stop and volume confirmation."""
from __future__ import annotations

from .base import Strategy, StrategyContext
from ..models import Signal


def _ema(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    k = 2.0 / (period + 1)
    ema = sum(values[:period]) / period
    for v in values[period:]:
        ema = v * k + ema * (1 - k)
    return ema


def _sma(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def _atr(bars, period: int) -> float:
    if len(bars) < 2:
        return bars[-1].high - bars[-1].low if bars else 0.0
    trs = []
    for i in range(max(1, len(bars) - period), len(bars)):
        h, l, pc = bars[i].high, bars[i].low, bars[i - 1].close
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    return sum(trs) / len(trs) if trs else 0.0


class MACrossStrategy(Strategy):
    name = "ma_cross"
    description = (
        "EMA crossover trend-follower: buys when fast EMA crosses above slow EMA "
        "with volume confirmation. Exits on reverse cross or ATR trailing stop."
    )
    params_schema = {
        "fast_period":  {"type": "int",   "default": 20,  "min": 2,   "max": 100, "label": "Fast EMA"},
        "slow_period":  {"type": "int",   "default": 50,  "min": 5,   "max": 400, "label": "Slow EMA"},
        "atr_period":   {"type": "int",   "default": 14,  "min": 5,   "max": 50,  "label": "ATR Period"},
        "trail_mult":   {"type": "float", "default": 2.5, "min": 1.0, "max": 6.0, "label": "Trailing Stop (× ATR)", "step": 0.5},
        "vol_filter":   {"type": "int",   "default": 1,   "min": 0,   "max": 1,   "label": "Volume Filter"},
    }

    def __init__(self, **params) -> None:
        super().__init__(**params)
        self._trail_high: float | None = None  # highest close since entry (long)

    def on_bar(self, ctx: StrategyContext) -> Signal:
        closes = ctx.closes
        bars   = ctx.history
        fast_p   = int(self.params["fast_period"])
        slow_p   = int(self.params["slow_period"])
        atr_p    = int(self.params["atr_period"])
        trail_m  = float(self.params["trail_mult"])
        vol_f    = bool(int(self.params["vol_filter"]))

        if len(closes) < slow_p + 1:
            return "hold"

        fast_now  = _ema(closes,      fast_p)
        slow_now  = _ema(closes,      slow_p)
        fast_prev = _ema(closes[:-1], fast_p)
        slow_prev = _ema(closes[:-1], slow_p)

        if None in (fast_now, slow_now, fast_prev, slow_prev):
            return "hold"

        atr   = _atr(bars, atr_p)
        price = closes[-1]

        if ctx.position is None:
            bullish_cross = fast_prev <= slow_prev and fast_now > slow_now
            if not bullish_cross:
                return "hold"

            # Volume confirmation: current bar volume > 20-bar average
            if vol_f and len(bars) >= 20:
                vols    = [b.volume for b in bars[-20:]]
                avg_vol = sum(vols) / len(vols)
                if bars[-1].volume < avg_vol:
                    return "hold"

            self._trail_high = price
            return "buy"
        else:
            # Update trailing high
            if self._trail_high is None or price > self._trail_high:
                self._trail_high = price

            # Trailing stop: close if price falls more than trail_mult * ATR below peak
            if atr > 0 and self._trail_high is not None:
                if price < self._trail_high - trail_m * atr:
                    self._trail_high = None
                    return "close"

            # Bearish cross exit
            if fast_prev >= slow_prev and fast_now < slow_now:
                self._trail_high = None
                return "close"

        return "hold"
