"""
FundingArb — Perpetual futures funding rate carry trade.
Goes short when funding is very positive (longs pay shorts),
goes long when funding is very negative (shorts pay longs).
Requires funding_rate in ctx.properties (populated by engine when use_funding_rates=True).
Falls back to a simple momentum filter when no funding data is available.
"""
from __future__ import annotations

from .base import Strategy, StrategyContext
from ..models import Bar, Signal


def _rsi(closes: list[float], period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    ag = sum(gains[-period:]) / period
    al = sum(losses[-period:]) / period
    if al == 0:
        return 100.0
    return 100.0 - 100.0 / (1.0 + ag / al)


class FundingArbStrategy(Strategy):
    name = "funding_arb"
    description = (
        "Exploits funding rate extremes on perpetual futures. "
        "High positive funding → go short (paid by longs). "
        "High negative funding → go long (paid by shorts). "
        "Uses RSI as a momentum filter to avoid fighting strong trends."
    )
    params_schema = {
        "min_rate":       {"type": "float", "default": 0.0005, "min": 0.0001, "max": 0.01, "label": "Min Funding Rate",        "description": "Minimum absolute funding rate (e.g. 0.0005 = 0.05%) required to trigger an entry. Higher values only trade during extreme funding periods with larger carry income."},
        "hold_bars":      {"type": "int",   "default": 480,    "min": 1,      "max": 2880,  "label": "Hold Bars (1m=480 = 8h)", "description": "Maximum number of bars to hold the position before a time-based exit. At 1-minute bars, 480 equals one 8-hour funding cycle."},
        "rsi_period":     {"type": "int",   "default": 14,     "min": 5,      "max": 50,    "label": "RSI Period",              "description": "Lookback period for RSI calculation. Standard is 14. Shorter periods make RSI more sensitive to recent price changes."},
        "rsi_max_long":   {"type": "float", "default": 65,     "min": 50,     "max": 80,    "label": "RSI Max (long entry)",    "description": "RSI must be below this threshold to allow a long entry, avoiding entries into strongly overbought conditions. Lower values add a stricter momentum filter."},
        "rsi_min_short":  {"type": "float", "default": 35,     "min": 20,     "max": 50,    "label": "RSI Min (short entry)",   "description": "RSI must be above this threshold to allow a short entry, avoiding entries into strongly oversold conditions. Higher values add a stricter momentum filter."},
        "allow_short":    {"type": "bool",  "default": True,                   "label": "Allow Short Trades",       "description": "Enable short entries when funding rates are highly positive. Disable if trading spot markets or to only collect on negative-funding longs."},
    }

    def __init__(self, **params) -> None:
        super().__init__(**params)
        self._entry_bar: int = 0
        self._bar_count: int = 0

    def on_bar(self, ctx: StrategyContext) -> Signal:
        self._bar_count += 1
        closes = [b.close for b in ctx.history]
        min_rate = float(self.params["min_rate"])
        hold_bars = int(self.params["hold_bars"])
        rsi_p = int(self.params["rsi_period"])
        rsi_max_l = float(self.params["rsi_max_long"])
        rsi_min_s = float(self.params["rsi_min_short"])
        allow_short = bool(self.params["allow_short"])

        if len(closes) < rsi_p + 2:
            return "hold"

        rsi = _rsi(closes, rsi_p)
        funding = ctx.properties.get("funding_rate")  # float | None

        if ctx.position is not None:
            bars_held = self._bar_count - self._entry_bar
            if bars_held >= hold_bars:
                return "close"
            return "hold"

        if funding is not None:
            # HIGH positive funding → short (longs paying, so be a short)
            if allow_short and funding >= min_rate and rsi > rsi_min_s:
                self._entry_bar = self._bar_count
                return "short"
            # HIGH negative funding → long (shorts paying, so be a long)
            if funding <= -min_rate and rsi < rsi_max_l:
                self._entry_bar = self._bar_count
                return "buy"
        else:
            # No funding data: simple mean reversion fallback
            if rsi <= 30:
                self._entry_bar = self._bar_count
                return "buy"
            if allow_short and rsi >= 70:
                self._entry_bar = self._bar_count
                return "short"

        return "hold"
