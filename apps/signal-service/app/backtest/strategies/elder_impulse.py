"""Elder Impulse System — MACD histogram + EMA alignment."""
from __future__ import annotations

from .base import Strategy, StrategyContext
from ..models import Signal


def _ema_series(values: list[float], period: int) -> list[float]:
    """Return the full EMA series, starting once there are `period` values."""
    result: list[float] = []
    if len(values) < period:
        return result
    k = 2.0 / (period + 1)
    ema = sum(values[:period]) / period
    result.append(ema)
    for v in values[period:]:
        ema = v * k + ema * (1 - k)
        result.append(ema)
    return result


def _macd_histogram_series(
    closes: list[float], fast: int, slow: int, signal: int
) -> list[float]:
    """
    Return the MACD histogram series.

    Length = len(closes) - slow - signal + 1 approximately.
    Each entry corresponds to bars[slow + signal - 1 + i] for i in range(len).
    """
    if len(closes) < slow + signal:
        return []

    # Build MACD line series from index `slow-1` onward
    macd_line_series: list[float] = []
    for i in range(slow, len(closes) + 1):
        fast_vals = closes[:i]
        slow_vals = closes[:i]
        if len(fast_vals) < fast or len(slow_vals) < slow:
            continue
        k_fast = 2.0 / (fast + 1)
        ema_fast = sum(fast_vals[:fast]) / fast
        for v in fast_vals[fast:]:
            ema_fast = v * k_fast + ema_fast * (1 - k_fast)
        k_slow = 2.0 / (slow + 1)
        ema_slow = sum(slow_vals[:slow]) / slow
        for v in slow_vals[slow:]:
            ema_slow = v * k_slow + ema_slow * (1 - k_slow)
        macd_line_series.append(ema_fast - ema_slow)

    if len(macd_line_series) < signal:
        return []

    # Signal line = EMA of MACD line
    k_sig = 2.0 / (signal + 1)
    sig_ema = sum(macd_line_series[:signal]) / signal
    histograms: list[float] = []
    histograms.append(macd_line_series[signal - 1] - sig_ema)
    for macd_val in macd_line_series[signal:]:
        sig_ema = macd_val * k_sig + sig_ema * (1 - k_sig)
        histograms.append(macd_val - sig_ema)

    return histograms


class ElderImpulseStrategy(Strategy):
    name = "elder_impulse"
    description = (
        "Elder Impulse System: enters when both the 13-bar EMA is rising AND "
        "the MACD histogram is rising (both forces aligned bullish = green bar). "
        "Exits when either force reverses (histogram falls or EMA flattens)."
    )
    params_schema = {
        "ema_period":  {"type": "int", "default": 13, "min": 5,  "max": 30, "label": "EMA Period"},
        "macd_fast":   {"type": "int", "default": 12, "min": 3,  "max": 30, "label": "MACD Fast"},
        "macd_slow":   {"type": "int", "default": 26, "min": 10, "max": 60, "label": "MACD Slow"},
        "macd_signal": {"type": "int", "default": 9,  "min": 3,  "max": 20, "label": "MACD Signal"},
        "confirm_bars":{"type": "int", "default": 2,  "min": 1,  "max": 5,  "label": "Confirmation bars"},
    }

    def on_bar(self, ctx: StrategyContext) -> Signal:
        closes       = ctx.closes
        ema_p        = int(self.params["ema_period"])
        macd_fast    = int(self.params["macd_fast"])
        macd_slow    = int(self.params["macd_slow"])
        macd_sig     = int(self.params["macd_signal"])
        confirm_bars = int(self.params["confirm_bars"])

        min_bars = macd_slow + macd_sig + confirm_bars + 1
        if len(closes) < min_bars:
            return "hold"

        ema_series  = _ema_series(closes, ema_p)
        hist_series = _macd_histogram_series(closes, macd_fast, macd_slow, macd_sig)

        # Need at least confirm_bars + 1 values in each series
        if len(ema_series) < confirm_bars + 1 or len(hist_series) < confirm_bars + 1:
            return "hold"

        ema_tail  = ema_series[-(confirm_bars + 1):]
        hist_tail = hist_series[-(confirm_bars + 1):]

        # Check if EMA is rising for the last confirm_bars consecutive bars
        ema_rising = all(ema_tail[i] > ema_tail[i - 1] for i in range(1, len(ema_tail)))
        # Check if histogram is rising for the last confirm_bars consecutive bars
        hist_rising = all(hist_tail[i] > hist_tail[i - 1] for i in range(1, len(hist_tail)))

        # Current-vs-previous comparison for exit
        ema_falling  = ema_series[-1] < ema_series[-2]
        hist_falling = hist_series[-1] < hist_series[-2]

        if ctx.position is None:
            # BUY: both forces aligned bullish for confirm_bars bars
            if ema_rising and hist_rising:
                return "buy"
        else:
            # EXIT: either force reverses
            if ema_falling or hist_falling:
                return "close"

        return "hold"
