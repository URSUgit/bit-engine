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
    """Return (macd_line, signal_line, histogram) or None if not enough data.

    Reference implementation, O(n^2): recomputes the EMA for every prefix.
    Kept as the ground truth for _MacdState's equivalence test; the live
    strategy uses the incremental state below (O(1) per bar).
    """
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


class _EmaState:
    """SMA-seeded incremental EMA, numerically identical to _ema()."""

    __slots__ = ("period", "k", "seed", "value")

    def __init__(self, period: int) -> None:
        self.period = period
        self.k = 2.0 / (period + 1)
        self.seed: list[float] = []
        self.value: float | None = None

    def update(self, v: float) -> float | None:
        if self.value is None:
            self.seed.append(v)
            if len(self.seed) == self.period:
                self.value = sum(self.seed) / self.period
                self.seed = []
        else:
            self.value = v * self.k + self.value * (1 - self.k)
        return self.value


class _MacdState:
    """Incremental MACD + signal line over a growing close series.

    Produces the same (macd, signal) pairs as _macd_values on every prefix,
    but in O(1) per appended close instead of O(n^2).
    """

    __slots__ = ("n", "last_close", "fast", "slow", "sig",
                 "macd_prev", "sig_prev", "macd_now", "sig_now")

    def __init__(self, fast: int, slow: int, signal: int) -> None:
        self.n = 0
        self.last_close: float | None = None
        self.fast = _EmaState(fast)
        self.slow = _EmaState(slow)
        self.sig = _EmaState(signal)
        self.macd_prev: float | None = None
        self.sig_prev: float | None = None
        self.macd_now: float | None = None
        self.sig_now: float | None = None

    def update(self, close: float) -> None:
        self.macd_prev, self.sig_prev = self.macd_now, self.sig_now
        fe = self.fast.update(close)
        se = self.slow.update(close)
        if fe is not None and se is not None:
            macd = fe - se
            self.macd_now = macd
            self.sig_now = self.sig.update(macd)
        self.n += 1
        self.last_close = close

    @classmethod
    def from_closes(cls, closes: list[float], fast: int, slow: int, signal: int) -> "_MacdState":
        st = cls(fast, slow, signal)
        for c in closes:
            st.update(c)
        return st


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
        self._macd = _MacdState(
            int(self.params["fast"]), int(self.params["slow"]), int(self.params["signal"])
        )

    def on_bar(self, ctx: StrategyContext) -> Signal:
        closes = ctx.closes
        bars   = ctx.history
        fast_p   = int(self.params["fast"])
        slow_p   = int(self.params["slow"])
        sig_p    = int(self.params["signal"])
        atr_p    = int(self.params["atr_period"])
        trail_m  = float(self.params["trail_mult"])

        # Advance the incremental MACD state by the newest close; rebuild
        # from scratch if the series didn't grow by exactly one bar (e.g.
        # the instance was reused on a different window).
        st = self._macd
        if st.n == len(closes) - 1 and (st.n == 0 or st.last_close == closes[-2]):
            st.update(closes[-1])
        elif st.n != len(closes) or st.last_close != closes[-1]:
            st = _MacdState.from_closes(closes, fast_p, slow_p, sig_p)
            self._macd = st

        min_bars = slow_p + sig_p + 1
        if len(closes) < min_bars:
            return "hold"

        if st.sig_now is None or st.sig_prev is None or st.macd_prev is None:
            return "hold"

        macd_now, sig_now = st.macd_now, st.sig_now
        macd_prev, sig_prev = st.macd_prev, st.sig_prev
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
