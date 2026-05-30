"""
RSIDivergence — Hidden and regular RSI divergence detector.
Enters on confirmed divergence within a rolling lookback window.
"""
from __future__ import annotations

from .base import Strategy, StrategyContext
from ..models import Bar, Signal


def _rsi(closes: list[float], period: int) -> float:
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


def _find_local_lows(values: list[float], window: int = 5) -> list[tuple[int, float]]:
    """Return (index, value) of local minima with at least `window` bars on each side."""
    lows = []
    for i in range(window, len(values) - window):
        if values[i] == min(values[i - window: i + window + 1]):
            lows.append((i, values[i]))
    return lows


def _find_local_highs(values: list[float], window: int = 5) -> list[tuple[int, float]]:
    highs = []
    for i in range(window, len(values) - window):
        if values[i] == max(values[i - window: i + window + 1]):
            highs.append((i, values[i]))
    return highs


class RSIDivergenceStrategy(Strategy):
    name = "rsi_divergence"
    description = (
        "Detects bullish RSI divergence (price lower low, RSI higher low) for long entries, "
        "and bearish divergence (price higher high, RSI lower high) for short entries. "
        "Works best on 5m–1h timeframes."
    )
    params_schema = {
        "rsi_period":   {"type": "int",   "default": 14, "min": 5,  "max": 50,  "label": "RSI Period",                        "description": "Lookback period for RSI calculation. Standard is 14. Shorter periods make RSI more sensitive to recent price changes."},
        "lookback":     {"type": "int",   "default": 30, "min": 10, "max": 100, "label": "Divergence Lookback",               "description": "Number of bars to scan for divergence pivots. Larger values catch longer-term divergences but may produce stale signals."},
        "pivot_window": {"type": "int",   "default": 5,  "min": 2,  "max": 15,  "label": "Pivot Detection Window",            "description": "Number of bars on each side required to confirm a local high or low. Higher values find stronger, more significant pivots."},
        "rsi_os":       {"type": "float", "default": 40, "min": 20, "max": 50,  "label": "RSI Oversold Zone",                 "description": "RSI must be below this level at the second low to qualify as a bullish divergence. Lower values filter for more extreme setups."},
        "rsi_ob":       {"type": "float", "default": 60, "min": 50, "max": 80,  "label": "RSI Overbought Zone",               "description": "RSI must be above this level at the second high to qualify as a bearish divergence. Higher values filter for more extreme setups."},
        "exit_bars":    {"type": "int",   "default": 20, "min": 3,  "max": 100, "label": "Max Holding Bars",                  "description": "Maximum number of bars to hold a position before a time-based exit. Prevents getting stuck in slow-moving trades."},
        "allow_short":  {"type": "bool",  "default": False,          "label": "Allow Bearish Divergence Shorts",  "description": "Enable short entries on bearish RSI divergence signals. Disable if trading spot markets."},
    }

    def __init__(self, **params) -> None:
        super().__init__(**params)
        self._entry_bar: int = -1
        self._bar_count: int = 0

    def on_bar(self, ctx: StrategyContext) -> Signal:
        self._bar_count += 1
        closes = [b.close for b in ctx.history]
        period = int(self.params["rsi_period"])
        lookback = int(self.params["lookback"])
        pw = int(self.params["pivot_window"])
        os_lvl = float(self.params["rsi_os"])
        ob_lvl = float(self.params["rsi_ob"])
        exit_bars = int(self.params["exit_bars"])
        allow_short = bool(self.params["allow_short"])

        min_bars = period + lookback + pw * 2 + 5
        if len(closes) < min_bars:
            return "hold"

        # Exit by bar count
        if ctx.position is not None:
            bars_held = self._bar_count - self._entry_bar
            if bars_held >= exit_bars:
                return "close"
            return "hold"

        # Compute RSI series for the lookback window
        rsi_series = [_rsi(closes[:i + 1], period) for i in range(len(closes) - lookback, len(closes))]
        price_series = closes[-lookback:]

        price_lows = _find_local_lows(price_series, pw)
        rsi_lows = _find_local_lows(rsi_series, pw)
        price_highs = _find_local_highs(price_series, pw)
        rsi_highs = _find_local_highs(rsi_series, pw)

        # Bullish divergence: last 2 price lows descending, last 2 RSI lows ascending
        if len(price_lows) >= 2 and len(rsi_lows) >= 2:
            pl1, pl2 = price_lows[-2], price_lows[-1]
            rl1, rl2 = rsi_lows[-2], rsi_lows[-1]
            # Price makes lower low, RSI makes higher low
            if pl2[1] < pl1[1] and rl2[1] > rl1[1] and rl2[1] < os_lvl:
                self._entry_bar = self._bar_count
                return "buy"

        # Bearish divergence: price higher high, RSI lower high
        if allow_short and len(price_highs) >= 2 and len(rsi_highs) >= 2:
            ph1, ph2 = price_highs[-2], price_highs[-1]
            rh1, rh2 = rsi_highs[-2], rsi_highs[-1]
            if ph2[1] > ph1[1] and rh2[1] < rh1[1] and rh2[1] > ob_lvl:
                self._entry_bar = self._bar_count
                return "short"

        return "hold"
