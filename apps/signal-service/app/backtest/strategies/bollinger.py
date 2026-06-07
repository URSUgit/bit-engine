"""Bollinger Bands mean-reversion with ATR-based stop-loss and take-profit."""
from __future__ import annotations

import math

from .base import Strategy, StrategyContext
from ..models import Signal


def _atr(bars, period: int) -> float:
    if len(bars) < 2:
        return bars[-1].high - bars[-1].low if bars else 0.0
    trs = []
    for i in range(max(1, len(bars) - period), len(bars)):
        h, l, pc = bars[i].high, bars[i].low, bars[i - 1].close
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    return sum(trs) / len(trs) if trs else 0.0


class BollingerStrategy(Strategy):
    name = "bollinger"
    description = (
        "Bollinger Bands mean-reversion: buys when price closes below the lower band. "
        "Exits on take-profit (upper band re-touch), stop-loss (ATR-based), "
        "or when price crosses back above the middle SMA."
    )
    params_schema = {
        "period":     {"type": "int",   "default": 20,  "min": 5,   "max": 100, "label": "BB Period"},
        "std_dev":    {"type": "float", "default": 2.0, "min": 1.0, "max": 4.0, "label": "Std Dev", "step": 0.5},
        "atr_period": {"type": "int",   "default": 14,  "min": 5,   "max": 50,  "label": "ATR Period"},
        "stop_mult":  {"type": "float", "default": 2.0, "min": 0.5, "max": 5.0, "label": "Stop Loss (× ATR)", "step": 0.5},
        "tp_mult":    {"type": "float", "default": 3.0, "min": 0.5, "max": 8.0, "label": "Take Profit (× ATR)", "step": 0.5},
    }

    def __init__(self, **params) -> None:
        super().__init__(**params)
        self._entry_price: float | None = None

    def on_bar(self, ctx: StrategyContext) -> Signal:
        closes  = ctx.closes
        bars    = ctx.history
        period    = int(self.params["period"])
        k         = float(self.params["std_dev"])
        atr_p     = int(self.params["atr_period"])
        stop_mult = float(self.params["stop_mult"])
        tp_mult   = float(self.params["tp_mult"])

        if len(closes) < max(period, atr_p) + 1:
            return "hold"

        window = closes[-period:]
        sma    = sum(window) / period
        var    = sum((c - sma) ** 2 for c in window) / period
        std    = math.sqrt(var)
        upper  = sma + k * std
        lower  = sma - k * std
        price  = closes[-1]
        atr    = _atr(bars, atr_p)

        if ctx.position is None:
            if price < lower:
                self._entry_price = price
                return "buy"
        else:
            entry = self._entry_price or price
            # ATR stop-loss (hard floor)
            if atr > 0 and price < entry - stop_mult * atr:
                self._entry_price = None
                return "close"
            # ATR take-profit (price up N×ATR from entry)
            if atr > 0 and price > entry + tp_mult * atr:
                self._entry_price = None
                return "close"
            # Mean-reversion exit: price back above the SMA
            if price > sma:
                self._entry_price = None
                return "close"

        return "hold"
