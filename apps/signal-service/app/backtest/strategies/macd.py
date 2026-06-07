"""MACD signal-line crossover with ATR trailing stop."""
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


def _macd_values(closes: list[float], fast: int, slow: int, signal: int) -> tuple[float, float, float] | None:
    """Return (macd_line, signal_line, histogram) or None if not enough data."""
    if len(closes) < slow + signal:
        return None
    fast_ema = _ema(closes, fast)
    slow_ema = _ema(closes, slow)
    if fast_ema is None or slow_ema is None:
        return None
    macd_line = fast_ema - slow_ema

    # Build a MACD series long enough for the signal EMA
    macd_series: list[float] = []
    for i in range(slow, len(closes) + 1):
        fe = _ema(closes[:i], fast)
        se = _ema(closes[:i], slow)
        if fe is not None and se is not None:
            macd_series.append(fe - se)

    sig_ema = _ema(macd_series, signal)
    if sig_ema is None:
        return None
    return macd_line, sig_ema, macd_line - sig_ema


def _atr(bars, period: int) -> float:
    if len(bars) < 2:
        return bars[-1].high - bars[-1].low if bars else 0.0
    trs = []
    for i in range(max(1, len(bars) - period), len(bars)):
        h, l, pc = bars[i].high, bars[i].low, bars[i - 1].close
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    return sum(trs) / len(trs) if trs else 0.0


class MACDStrategy(Strategy):
    name = "macd"
    description = (
        "MACD signal-line crossover: enters long when MACD crosses above its signal line "
        "and exits when it crosses back below. ATR trailing stop limits downside."
    )
    params_schema = {
        "fast":        {"type": "int",   "default": 12,  "min": 3,   "max": 50,  "label": "Fast EMA"},
        "slow":        {"type": "int",   "default": 26,  "min": 5,   "max": 200, "label": "Slow EMA"},
        "signal":      {"type": "int",   "default": 9,   "min": 2,   "max": 50,  "label": "Signal EMA"},
        "atr_period":  {"type": "int",   "default": 14,  "min": 5,   "max": 50,  "label": "ATR Period"},
        "trail_mult":  {"type": "float", "default": 2.0, "min": 0.5, "max": 5.0, "label": "Trailing Stop (× ATR)", "step": 0.5},
    }

    def __init__(self, **params) -> None:
        super().__init__(**params)
        self._trail_high: float | None = None

    def on_bar(self, ctx: StrategyContext) -> Signal:
        closes = ctx.closes
        bars   = ctx.history
        fast_p   = int(self.params["fast"])
        slow_p   = int(self.params["slow"])
        sig_p    = int(self.params["signal"])
        atr_p    = int(self.params["atr_period"])
        trail_m  = float(self.params["trail_mult"])

        min_bars = slow_p + sig_p + 1
        if len(closes) < min_bars:
            return "hold"

        now  = _macd_values(closes,      fast_p, slow_p, sig_p)
        prev = _macd_values(closes[:-1], fast_p, slow_p, sig_p)
        if now is None or prev is None:
            return "hold"

        macd_now, sig_now, _ = now
        macd_prev, sig_prev, _ = prev
        atr   = _atr(bars, atr_p)
        price = closes[-1]

        if ctx.position is None:
            # Bullish MACD crossover: MACD crosses above signal
            if macd_prev <= sig_prev and macd_now > sig_now:
                self._trail_high = price
                return "buy"
        else:
            # Update trailing peak
            if self._trail_high is None or price > self._trail_high:
                self._trail_high = price

            # ATR trailing stop below peak
            if atr > 0 and self._trail_high is not None:
                if price < self._trail_high - trail_m * atr:
                    self._trail_high = None
                    return "close"

            # Bearish MACD crossover exit
            if macd_prev >= sig_prev and macd_now < sig_now:
                self._trail_high = None
                return "close"

        return "hold"
