"""
AnomalyFade — Fades volume-spike + price-gap anomalies.
Enters counter-trend after detecting an extreme move on anomalous volume,
betting on mean reversion.
"""
from __future__ import annotations

import math

from .base import Strategy, StrategyContext
from ..models import Bar, Signal


def _rolling_stats(values: list[float], window: int) -> tuple[float, float]:
    w = values[-window:]
    n = len(w)
    if n == 0:
        return 0.0, 1.0
    mean = sum(w) / n
    var = sum((x - mean) ** 2 for x in w) / max(n - 1, 1)
    return mean, math.sqrt(var)


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


class AnomalyFadeStrategy(Strategy):
    name = "anomaly_fade"
    description = (
        "Counter-trend strategy that fades anomalous price spikes on extreme volume. "
        "After detecting a volume spike Z-score AND a significant price move, "
        "enters in the opposite direction expecting partial reversion. "
        "Best on liquid assets (BTC, ETH) on 1m–5m timeframes."
    )
    params_schema = {
        "volume_z":       {"type": "float", "default": 3.0, "min": 1.5, "max": 8.0,  "label": "Volume Z-Score Threshold"},
        "move_pct":       {"type": "float", "default": 1.0, "min": 0.2, "max": 5.0,  "label": "Price Move % to Fade"},
        "fade_bars":      {"type": "int",   "default": 15,  "min": 3,   "max": 100,  "label": "Max Bars in Trade"},
        "rsi_confirm":    {"type": "float", "default": 70,  "min": 55,  "max": 90,   "label": "RSI Overbought (fade threshold)"},
        "revert_pct":     {"type": "float", "default": 0.4, "min": 0.1, "max": 2.0,  "label": "Take Profit % (reversion target)"},
        "allow_long_fade":{"type": "bool",  "default": True,             "label": "Fade Crashes (go long after drop)"},
        "stats_window":   {"type": "int",   "default": 20,  "min": 10,  "max": 100,  "label": "Stats Window (bars)"},
    }

    def __init__(self, **params) -> None:
        super().__init__(**params)
        self._entry_bar = 0
        self._bar_count = 0
        self._tp: float | None = None
        self._sl: float | None = None

    def on_bar(self, ctx: StrategyContext) -> Signal:
        self._bar_count += 1
        bars = ctx.history
        closes = [b.close for b in bars]
        volumes = [b.volume for b in bars]
        window = int(self.params["stats_window"])

        if len(bars) < window + 5:
            return "hold"

        vol_z = float(self.params["volume_z"])
        move_pct = float(self.params["move_pct"])
        fade_bars = int(self.params["fade_bars"])
        rsi_ob = float(self.params["rsi_confirm"])
        revert_pct = float(self.params["revert_pct"])
        allow_long = bool(self.params["allow_long_fade"])

        if ctx.position is not None:
            bars_held = self._bar_count - self._entry_bar
            price = closes[-1]
            if self._tp and (
                (ctx.position.side == "short" and price <= self._tp) or
                (ctx.position.side == "long" and price >= self._tp)
            ):
                self._tp = self._sl = None
                return "close"
            if self._sl and (
                (ctx.position.side == "short" and price >= self._sl) or
                (ctx.position.side == "long" and price <= self._sl)
            ):
                self._tp = self._sl = None
                return "close"
            if bars_held >= fade_bars:
                self._tp = self._sl = None
                return "close"
            return "hold"

        # Detect anomaly
        vol_mean, vol_std = _rolling_stats(volumes[:-1], window)
        current_z = (volumes[-1] - vol_mean) / vol_std if vol_std > 0 else 0.0
        price_move = (closes[-1] - closes[-2]) / closes[-2] * 100 if closes[-2] > 0 else 0.0
        rsi = _rsi(closes, 14)

        # Fade pump: large up move + volume spike + RSI overbought
        if (
            current_z >= vol_z
            and price_move >= move_pct
            and rsi >= rsi_ob
        ):
            p = closes[-1]
            self._tp = p * (1 - revert_pct / 100)
            self._sl = p * (1 + move_pct / 100)  # stop at the same % above entry
            self._entry_bar = self._bar_count
            return "short"

        # Fade crash: large down move + volume spike
        rsi_os = 100 - rsi_ob  # symmetric oversold level
        if (
            allow_long
            and current_z >= vol_z
            and price_move <= -move_pct
            and rsi <= rsi_os
        ):
            p = closes[-1]
            self._tp = p * (1 + revert_pct / 100)
            self._sl = p * (1 - move_pct / 100)
            self._entry_bar = self._bar_count
            return "buy"

        return "hold"
