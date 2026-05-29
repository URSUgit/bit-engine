"""
VWAPReversion — Mean reversion when price deviates from VWAP by N standard deviations.
Ideal for 1m–5m intraday scalping on high-volume assets.
"""
from __future__ import annotations

import math

from .base import Strategy, StrategyContext
from ..models import Bar, Signal


def _rolling_vwap(bars: list[Bar], window: int) -> tuple[float, float]:
    """Return (VWAP, price_std) over last `window` bars."""
    w = bars[-window:]
    total_vol = sum(b.volume for b in w)
    if total_vol == 0:
        mid = (w[-1].high + w[-1].low + w[-1].close) / 3
        return mid, 1.0
    vwap = sum((b.high + b.low + b.close) / 3 * b.volume for b in w) / total_vol
    prices = [(b.high + b.low + b.close) / 3 for b in w]
    mean = sum(prices) / len(prices)
    variance = sum((p - mean) ** 2 for p in prices) / max(len(prices) - 1, 1)
    return vwap, math.sqrt(variance)


class VWAPReversionStrategy(Strategy):
    name = "vwap_reversion"
    description = (
        "Buy when price falls below VWAP - N×σ; sell when price returns to VWAP. "
        "Optionally go short above VWAP + N×σ. Uses rolling VWAP over a configurable window."
    )
    params_schema = {
        "vwap_window": {"type": "int",   "default": 50,  "min": 10, "max": 500,  "label": "VWAP Window (bars)"},
        "entry_sigma": {"type": "float", "default": 1.5, "min": 0.5,"max": 5.0,  "label": "Entry σ Deviation"},
        "exit_sigma":  {"type": "float", "default": 0.1, "min": 0.0,"max": 1.5,  "label": "Exit σ (near VWAP)"},
        "allow_short": {"type": "bool",  "default": False,            "label": "Allow Short Trades"},
        "min_volume_ratio": {"type": "float", "default": 0.5, "min": 0.1, "max": 3.0, "label": "Min Volume Ratio"},
    }

    def on_bar(self, ctx: StrategyContext) -> Signal:
        window = int(self.params["vwap_window"])
        entry_sigma = float(self.params["entry_sigma"])
        exit_sigma = float(self.params["exit_sigma"])
        allow_short = bool(self.params["allow_short"])
        min_vol_ratio = float(self.params["min_volume_ratio"])

        bars = ctx.history
        if len(bars) < window + 5:
            return "hold"

        vwap, std = _rolling_vwap(bars, window)
        if std == 0:
            return "hold"

        price = bars[-1].close
        deviation = (price - vwap) / std

        # Volume filter: bar volume vs recent average
        recent_vols = [b.volume for b in bars[-20:]]
        avg_vol = sum(recent_vols) / len(recent_vols)
        vol_ok = bars[-1].volume >= avg_vol * min_vol_ratio

        if ctx.position is not None:
            if ctx.position.side == "long":
                # Exit when price returns near VWAP or overshoots
                if deviation >= -exit_sigma:
                    return "close"
            elif ctx.position.side == "short":
                if deviation <= exit_sigma:
                    return "close"
            return "hold"

        if deviation <= -entry_sigma and vol_ok:
            return "buy"
        if allow_short and deviation >= entry_sigma and vol_ok:
            return "short"

        return "hold"
