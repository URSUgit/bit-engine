"""CCI (Commodity Channel Index) mean-reversion with trend filter."""
from __future__ import annotations

from .base import Strategy, StrategyContext
from ..models import Signal


def _cci(bars, period: int) -> float | None:
    """Compute the current CCI value."""
    if len(bars) < period:
        return None
    window = bars[-period:]
    typical_prices = [(b.high + b.low + b.close) / 3.0 for b in window]
    sma_tp = sum(typical_prices) / period
    mean_dev = sum(abs(tp - sma_tp) for tp in typical_prices) / period
    if mean_dev == 0:
        return 0.0
    return (typical_prices[-1] - sma_tp) / (0.015 * mean_dev)


def _atr(bars, period: int) -> float:
    if len(bars) < 2:
        return bars[-1].high - bars[-1].low if bars else 0.0
    trs = []
    for i in range(max(1, len(bars) - period), len(bars)):
        h, l, pc = bars[i].high, bars[i].low, bars[i - 1].close
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    return sum(trs) / len(trs) if trs else 0.0


def _ema(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    k = 2.0 / (period + 1)
    ema = sum(values[:period]) / period
    for v in values[period:]:
        ema = v * k + ema * (1 - k)
    return ema


class CCIStrategy(Strategy):
    name = "cci"
    description = (
        "CCI mean-reversion: enters long when CCI crosses up from below -100 "
        "(oversold extreme). Exits on CCI crossing above +100 or ATR stop. "
        "Optional 50-bar EMA trend filter."
    )
    params_schema = {
        "period":       {"type": "int",   "default": 20,   "min": 5,    "max": 50,  "label": "CCI Period"},
        "oversold":     {"type": "float", "default": -100, "min": -200, "max": -50, "label": "Oversold"},
        "overbought":   {"type": "float", "default": 100,  "min": 50,   "max": 200, "label": "Overbought"},
        "atr_period":   {"type": "int",   "default": 14,   "min": 5,    "max": 30,  "label": "ATR Period"},
        "stop_mult":    {"type": "float", "default": 2.5,  "min": 0.5,  "max": 5.0, "label": "Stop (×ATR)", "step": 0.5},
        "trend_filter": {"type": "int",   "default": 0,    "min": 0,    "max": 1,   "label": "EMA Trend Filter"},
    }

    def __init__(self, **params) -> None:
        super().__init__(**params)
        self._entry_price: float | None = None

    def on_bar(self, ctx: StrategyContext) -> Signal:
        bars         = ctx.history
        closes       = ctx.closes
        period       = int(self.params["period"])
        oversold     = float(self.params["oversold"])
        overbought   = float(self.params["overbought"])
        atr_p        = int(self.params["atr_period"])
        stop_mult    = float(self.params["stop_mult"])
        trend_filter = bool(int(self.params["trend_filter"]))

        if len(bars) < period + 1:
            return "hold"

        cci_now  = _cci(bars,      period)
        cci_prev = _cci(bars[:-1], period)
        if cci_now is None or cci_prev is None:
            return "hold"

        price = closes[-1]
        atr   = _atr(bars, atr_p)

        if ctx.position is None:
            # Optional trend filter: only long when price is above the 50-bar EMA
            if trend_filter:
                ema50 = _ema(closes, 50)
                if ema50 is not None and price < ema50:
                    return "hold"

            # BUY: CCI was below oversold and just crossed above it
            if cci_prev <= oversold < cci_now:
                self._entry_price = price
                return "buy"
        else:
            # ATR stop-loss
            if self._entry_price is not None and atr > 0:
                if price < self._entry_price - stop_mult * atr:
                    self._entry_price = None
                    return "close"
            # EXIT: CCI crosses above overbought threshold
            if cci_prev < overbought <= cci_now:
                self._entry_price = None
                return "close"

        return "hold"
