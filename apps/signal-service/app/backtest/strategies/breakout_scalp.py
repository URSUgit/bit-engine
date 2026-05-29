"""
BreakoutScalp — High/low breakout with volume confirmation.
Scalps the initial thrust when price breaks a N-bar range.
"""
from __future__ import annotations

from .base import Strategy, StrategyContext
from ..models import Bar, Signal


def _atr(bars: list[Bar], period: int) -> float:
    if len(bars) < 2:
        return bars[-1].high - bars[-1].low if bars else 0.0
    trs = []
    for i in range(1, len(bars)):
        b, p = bars[i], bars[i - 1]
        trs.append(max(b.high - b.low, abs(b.high - p.close), abs(b.low - p.close)))
    n = min(period, len(trs))
    return sum(trs[-n:]) / n


class BreakoutScalpStrategy(Strategy):
    name = "breakout_scalp"
    description = (
        "Enters long when price breaks above the highest high of the last N bars "
        "with above-average volume. Uses ATR-based trailing stop. "
        "Can also short breakdowns below the N-bar low."
    )
    params_schema = {
        "lookback":       {"type": "int",   "default": 20,  "min": 5,   "max": 200, "label": "Breakout Lookback (bars)"},
        "volume_mult":    {"type": "float", "default": 1.5, "min": 0.8, "max": 5.0, "label": "Volume Confirmation (×avg)"},
        "atr_period":     {"type": "int",   "default": 14,  "min": 5,   "max": 50,  "label": "ATR Period"},
        "trail_atr_mult": {"type": "float", "default": 1.5, "min": 0.5, "max": 5.0, "label": "Trailing Stop (ATR mult)"},
        "tp_atr_mult":    {"type": "float", "default": 3.0, "min": 1.0, "max": 10.0,"label": "Take Profit (ATR mult)"},
        "allow_short":    {"type": "bool",  "default": False,            "label": "Allow Short Breakdowns"},
    }

    def __init__(self, **params) -> None:
        super().__init__(**params)
        self._tp: float | None = None
        self._trail_stop: float | None = None

    def on_bar(self, ctx: StrategyContext) -> Signal:
        bars = ctx.history
        lookback = int(self.params["lookback"])
        vol_mult = float(self.params["volume_mult"])
        atr_p = int(self.params["atr_period"])
        trail_mult = float(self.params["trail_atr_mult"])
        tp_mult = float(self.params["tp_atr_mult"])
        allow_short = bool(self.params["allow_short"])

        if len(bars) < lookback + atr_p + 2:
            return "hold"

        current = bars[-1]
        prior = bars[-(lookback + 1):-1]  # last N bars excluding current

        highest_high = max(b.high for b in prior)
        lowest_low = min(b.low for b in prior)
        atr = _atr(bars[-(atr_p + 2):], atr_p)

        avg_vol = sum(b.volume for b in bars[-20:]) / 20
        vol_ok = current.volume >= avg_vol * vol_mult

        price = current.close

        if ctx.position is not None:
            if ctx.position.side == "long":
                # Update trailing stop
                if self._trail_stop is not None:
                    new_stop = price - trail_mult * atr
                    self._trail_stop = max(self._trail_stop, new_stop)
                if self._tp and price >= self._tp:
                    self._tp = self._trail_stop = None
                    return "close"
                if self._trail_stop and price <= self._trail_stop:
                    self._tp = self._trail_stop = None
                    return "close"
            elif ctx.position.side == "short":
                if self._trail_stop is not None:
                    new_stop = price + trail_mult * atr
                    self._trail_stop = min(self._trail_stop, new_stop)
                if self._tp and price <= self._tp:
                    self._tp = self._trail_stop = None
                    return "close"
                if self._trail_stop and price >= self._trail_stop:
                    self._tp = self._trail_stop = None
                    return "close"
            return "hold"

        # Long breakout
        if current.close > highest_high and vol_ok:
            self._tp = price + tp_mult * atr
            self._trail_stop = price - trail_mult * atr
            return "buy"

        # Short breakdown
        if allow_short and current.close < lowest_low and vol_ok:
            self._tp = price - tp_mult * atr
            self._trail_stop = price + trail_mult * atr
            return "short"

        return "hold"
