"""Stochastic RSI — StochRSI crossover from oversold/overbought zones."""
from __future__ import annotations

from .base import Strategy, StrategyContext
from ..models import Signal


def _wilder_rsi_series(closes: list[float], period: int) -> list[float]:
    """Return a full RSI series using Wilder smoothing."""
    result: list[float] = []
    if len(closes) < period + 1:
        return result
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    avg_gain = sum(max(d, 0) for d in deltas[:period]) / period
    avg_loss = sum(max(-d, 0) for d in deltas[:period]) / period
    if avg_loss == 0:
        result.append(100.0)
    else:
        result.append(100.0 - 100.0 / (1.0 + avg_gain / avg_loss))
    for d in deltas[period:]:
        avg_gain = (avg_gain * (period - 1) + max(d, 0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-d, 0)) / period
        if avg_loss == 0:
            result.append(100.0)
        else:
            result.append(100.0 - 100.0 / (1.0 + avg_gain / avg_loss))
    return result


def _sma_series(values: list[float], period: int) -> list[float]:
    """Rolling SMA over `period`, returning values starting once there are enough."""
    result: list[float] = []
    for i in range(period - 1, len(values)):
        result.append(sum(values[i - period + 1 : i + 1]) / period)
    return result


def _atr(bars, period: int) -> float:
    if len(bars) < 2:
        return bars[-1].high - bars[-1].low if bars else 0.0
    trs = []
    for i in range(max(1, len(bars) - period), len(bars)):
        h, l, pc = bars[i].high, bars[i].low, bars[i - 1].close
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    return sum(trs) / len(trs) if trs else 0.0


class StochRSIStrategy(Strategy):
    name = "stoch_rsi"
    description = (
        "Stochastic RSI: applies the Stochastic formula to RSI values. "
        "Buys when %K crosses above %D from the oversold zone (<20). "
        "Exits when %K crosses below %D from overbought (>80) or ATR stop."
    )
    params_schema = {
        "rsi_period":   {"type": "int",   "default": 14,  "min": 5,   "max": 30,  "label": "RSI Period"},
        "stoch_period": {"type": "int",   "default": 14,  "min": 5,   "max": 30,  "label": "Stoch Period"},
        "smooth_k":     {"type": "int",   "default": 3,   "min": 1,   "max": 5,   "label": "Smooth %K"},
        "smooth_d":     {"type": "int",   "default": 3,   "min": 1,   "max": 5,   "label": "Smooth %D"},
        "oversold":     {"type": "float", "default": 20,  "min": 5,   "max": 35,  "label": "Oversold"},
        "overbought":   {"type": "float", "default": 80,  "min": 65,  "max": 95,  "label": "Overbought"},
        "atr_period":   {"type": "int",   "default": 14,  "min": 5,   "max": 30,  "label": "ATR Period"},
        "stop_mult":    {"type": "float", "default": 2.0, "min": 0.5, "max": 5.0, "label": "Stop Loss (×ATR)", "step": 0.5},
    }

    def __init__(self, **params) -> None:
        super().__init__(**params)
        self._entry_price: float | None = None

    def on_bar(self, ctx: StrategyContext) -> Signal:
        closes     = ctx.closes
        bars       = ctx.history
        rsi_p      = int(self.params["rsi_period"])
        stoch_p    = int(self.params["stoch_period"])
        smooth_k   = int(self.params["smooth_k"])
        smooth_d   = int(self.params["smooth_d"])
        oversold   = float(self.params["oversold"])
        overbought = float(self.params["overbought"])
        atr_p      = int(self.params["atr_period"])
        stop_mult  = float(self.params["stop_mult"])

        # Minimum bars needed: rsi_period + stoch_period + smooth_k + smooth_d
        min_bars = rsi_p + stoch_p + smooth_k + smooth_d + 5
        if len(closes) < min_bars:
            return "hold"

        # 1. Compute full RSI series
        rsi_series = _wilder_rsi_series(closes, rsi_p)
        if len(rsi_series) < stoch_p + smooth_k + smooth_d:
            return "hold"

        # 2. StochRSI: (RSI - min_RSI_N) / (max_RSI_N - min_RSI_N) * 100
        stoch_series: list[float] = []
        for i in range(stoch_p - 1, len(rsi_series)):
            window = rsi_series[i - stoch_p + 1 : i + 1]
            lo = min(window)
            hi = max(window)
            denom = hi - lo
            stoch_series.append((rsi_series[i] - lo) / denom * 100.0 if denom != 0 else 50.0)

        if len(stoch_series) < smooth_k + smooth_d:
            return "hold"

        # 3. %K = SMA(stoch_series, smooth_k)
        k_series = _sma_series(stoch_series, smooth_k)
        if len(k_series) < smooth_d + 1:
            return "hold"

        # 4. %D = SMA(%K, smooth_d)
        d_series = _sma_series(k_series, smooth_d)
        if len(d_series) < 2:
            return "hold"

        k_now,  d_now  = k_series[-1], d_series[-1]
        k_prev, d_prev = k_series[-2], d_series[-2]

        price = closes[-1]
        atr   = _atr(bars, atr_p)

        if ctx.position is None:
            # %K crosses above %D from the oversold zone
            if k_prev <= d_prev and k_now > d_now and k_prev < oversold:
                self._entry_price = price
                return "buy"
        else:
            # ATR stop-loss
            if self._entry_price is not None and atr > 0:
                if price < self._entry_price - stop_mult * atr:
                    self._entry_price = None
                    return "close"
            # %K crosses below %D from overbought
            if k_prev >= d_prev and k_now < d_now and k_prev > overbought:
                self._entry_price = None
                return "close"

        return "hold"
