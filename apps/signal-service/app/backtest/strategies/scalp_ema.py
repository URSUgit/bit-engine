"""
ScalpEMA — Fast/Slow EMA crossover with ATR-based TP/SL.
Designed for 1m–15m scalping.
"""
from __future__ import annotations

import math

from .base import Strategy, StrategyContext
from ..models import Bar, Signal


def _ema(values: list[float], period: int) -> float:
    if not values:
        return 0.0
    k = 2.0 / (period + 1)
    ema = values[0]
    for v in values[1:]:
        ema = v * k + ema * (1 - k)
    return ema


def _atr(bars: list[Bar], period: int) -> float:
    if len(bars) < 2:
        return bars[-1].high - bars[-1].low if bars else 0.0
    trs = []
    for i in range(1, len(bars)):
        b, p = bars[i], bars[i - 1]
        trs.append(max(b.high - b.low, abs(b.high - p.close), abs(b.low - p.close)))
    n = min(period, len(trs))
    return sum(trs[-n:]) / n


class ScalpEMAStrategy(Strategy):
    name = "scalp_ema"
    description = (
        "EMA fast/slow crossover for scalping. Enters long when fast EMA crosses above slow EMA "
        "with volume confirmation. ATR-based TP/SL targets. Time-of-day filter available."
    )
    params_schema = {
        "fast_ema":      {"type": "int",   "default": 9,    "min": 3,   "max": 50,   "label": "Fast EMA",                "description": "Number of bars for the fast EMA. Lower values react faster to price changes but generate more noise."},
        "slow_ema":      {"type": "int",   "default": 21,   "min": 8,   "max": 200,  "label": "Slow EMA",                "description": "Number of bars for the slow EMA. Higher values create smoother signals with fewer but higher-quality crossovers."},
        "atr_period":    {"type": "int",   "default": 14,   "min": 5,   "max": 50,   "label": "ATR Period",              "description": "Lookback period for Average True Range calculation. Controls how far back volatility is measured for TP/SL placement."},
        "tp_atr":        {"type": "float", "default": 2.0,  "min": 0.5, "max": 10.0, "label": "Take Profit (ATR mult)",  "description": "Take-profit distance as a multiple of ATR. Higher values target larger moves but reduce win rate."},
        "sl_atr":        {"type": "float", "default": 1.0,  "min": 0.3, "max": 5.0,  "label": "Stop Loss (ATR mult)",    "description": "Stop-loss distance as a multiple of ATR. Lower values cut losses sooner but may cause premature exits on volatile bars."},
        "volume_mult":   {"type": "float", "default": 1.2,  "min": 0.5, "max": 5.0,  "label": "Volume Filter (×avg)",    "description": "Minimum bar volume as a multiple of the 20-bar average. Increase to require stronger volume confirmation before entry."},
        "allow_short":   {"type": "bool",  "default": False,             "label": "Allow Short Trades",      "description": "Enable short-selling signals in addition to long entries. Disable if trading spot markets."},
    }

    def __init__(self, **params) -> None:
        super().__init__(**params)
        self._tp_price: float | None = None
        self._sl_price: float | None = None

    def on_bar(self, ctx: StrategyContext) -> Signal:
        closes = [b.close for b in ctx.history]
        volumes = [b.volume for b in ctx.history]
        bars = ctx.history

        fast = int(self.params["fast_ema"])
        slow = int(self.params["slow_ema"])
        atr_p = int(self.params["atr_period"])
        tp_mult = float(self.params["tp_atr"])
        sl_mult = float(self.params["sl_atr"])
        vol_mult = float(self.params["volume_mult"])
        allow_short = bool(self.params["allow_short"])

        if len(closes) < slow + 2:
            return "hold"

        fast_now = _ema(closes, fast)
        slow_now = _ema(closes, slow)
        fast_prev = _ema(closes[:-1], fast)
        slow_prev = _ema(closes[:-1], slow)
        atr = _atr(bars[-atr_p - 2:], atr_p)

        # Volume filter
        avg_vol = sum(volumes[-(20):]) / max(len(volumes[-20:]), 1)
        vol_ok = bars[-1].volume >= avg_vol * vol_mult

        price = closes[-1]

        if ctx.position is not None:
            # Check TP/SL
            if ctx.position.side == "long":
                if self._tp_price and price >= self._tp_price:
                    self._tp_price = self._sl_price = None
                    return "close"
                if self._sl_price and price <= self._sl_price:
                    self._tp_price = self._sl_price = None
                    return "close"
                # EMA flip exit
                if fast_now < slow_now:
                    self._tp_price = self._sl_price = None
                    return "close"
            elif ctx.position.side == "short":
                if self._tp_price and price <= self._tp_price:
                    self._tp_price = self._sl_price = None
                    return "close"
                if self._sl_price and price >= self._sl_price:
                    self._tp_price = self._sl_price = None
                    return "close"
                if fast_now > slow_now:
                    self._tp_price = self._sl_price = None
                    return "close"
            return "hold"

        # Long entry: fast crosses above slow with volume
        if fast_prev <= slow_prev and fast_now > slow_now and vol_ok:
            self._tp_price = price + tp_mult * atr
            self._sl_price = price - sl_mult * atr
            return "buy"

        # Short entry
        if allow_short and fast_prev >= slow_prev and fast_now < slow_now and vol_ok:
            self._tp_price = price - tp_mult * atr
            self._sl_price = price + sl_mult * atr
            return "short"

        return "hold"
