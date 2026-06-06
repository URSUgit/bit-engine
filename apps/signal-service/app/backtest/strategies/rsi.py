"""RSI mean-reversion strategy with ATR stop-loss and optional trend filter."""
from __future__ import annotations

import math

from .base import Strategy, StrategyContext
from ..models import Signal


def _wilder_rsi(closes: list[float], period: int) -> float:
    """Wilder-smoothed RSI — the standard implementation used by most platforms."""
    if len(closes) < period + 1:
        return 50.0
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    # Seed with simple average over first period
    avg_gain = sum(max(d, 0) for d in deltas[:period]) / period
    avg_loss = sum(max(-d, 0) for d in deltas[:period]) / period
    # Wilder smooth remaining deltas
    for d in deltas[period:]:
        avg_gain = (avg_gain * (period - 1) + max(d, 0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-d, 0)) / period
    if avg_loss == 0:
        return 100.0
    return 100.0 - (100.0 / (1.0 + avg_gain / avg_loss))


def _atr(bars, period: int) -> float:
    """Average True Range over the last `period` bars."""
    if len(bars) < 2:
        return bars[-1].high - bars[-1].low if bars else 0.0
    true_ranges = []
    for i in range(max(1, len(bars) - period), len(bars)):
        h, l, prev_c = bars[i].high, bars[i].low, bars[i - 1].close
        true_ranges.append(max(h - l, abs(h - prev_c), abs(l - prev_c)))
    return sum(true_ranges) / len(true_ranges) if true_ranges else 0.0


def _sma(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


class RSIStrategy(Strategy):
    name = "rsi"
    description = (
        "RSI mean-reversion: enters long when RSI crosses up from oversold. "
        "Exits on overbought cross or ATR-based stop-loss. "
        "Optional 50-bar SMA trend filter keeps us on the right side."
    )
    params_schema = {
        "period":          {"type": "int",   "default": 14,  "min": 2,   "max": 50,  "label": "RSI Period"},
        "oversold":        {"type": "float", "default": 40,  "min": 10,  "max": 49,  "label": "Oversold"},
        "overbought":      {"type": "float", "default": 65,  "min": 51,  "max": 90,  "label": "Overbought"},
        "atr_period":      {"type": "int",   "default": 14,  "min": 5,   "max": 50,  "label": "ATR Period"},
        "stop_atr_mult":   {"type": "float", "default": 2.5, "min": 0.5, "max": 5.0, "label": "Stop Loss (× ATR)", "step": 0.5},
        "trend_filter":    {"type": "int",   "default": 0,   "min": 0,   "max": 1,   "label": "200 SMA Trend Filter"},
    }

    def __init__(self, **params) -> None:
        super().__init__(**params)
        self._entry_price: float | None = None

    def on_bar(self, ctx: StrategyContext) -> Signal:
        closes = ctx.closes
        bars   = ctx.history
        period       = int(self.params["period"])
        oversold     = float(self.params["oversold"])
        overbought   = float(self.params["overbought"])
        atr_period   = int(self.params["atr_period"])
        stop_mult    = float(self.params["stop_atr_mult"])
        use_trend    = bool(int(self.params["trend_filter"]))

        if len(closes) < period + 2:
            return "hold"

        rsi_now  = _wilder_rsi(closes,      period)
        rsi_prev = _wilder_rsi(closes[:-1], period)
        atr      = _atr(bars, atr_period)
        price    = closes[-1]

        if ctx.position is None:
            # Trend filter: only go long when price is above 200-bar SMA (bull market)
            if use_trend:
                sma200 = _sma(closes, 200)
                if sma200 is not None and price < sma200:
                    return "hold"

            if rsi_prev <= oversold < rsi_now:
                self._entry_price = price
                return "buy"
        else:
            # ATR stop-loss
            if self._entry_price is not None and atr > 0:
                if price < self._entry_price - stop_mult * atr:
                    self._entry_price = None
                    return "close"
            # Overbought exit
            if rsi_prev >= overbought > rsi_now:
                self._entry_price = None
                return "close"

        return "hold"
