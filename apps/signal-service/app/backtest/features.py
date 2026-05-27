"""
Technical indicator feature engineering for oracle backtest entry analysis.

compute_features_at(bars, idx) returns every available indicator at bar `idx`.
compute_feature_series(bars, idx, length) returns the last `length` values of
every indicator, ending at bar `idx`, for time-series trajectory analysis.
"""
from __future__ import annotations

import math
from typing import Optional

from .models import Bar

# ── Primitive indicator helpers ───────────────────────────────────────────────

def _sma(values: list[float], period: int) -> Optional[float]:
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def _ema(values: list[float], period: int) -> Optional[float]:
    """Exponential moving average — classic Wilder initialisation."""
    if len(values) < period:
        return None
    k = 2.0 / (period + 1)
    ema = sum(values[:period]) / period
    for v in values[period:]:
        ema = v * k + ema * (1.0 - k)
    return ema


def _rsi(closes: list[float], period: int = 14) -> Optional[float]:
    if len(closes) < period + 1:
        return None
    changes = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [max(c, 0.0) for c in changes]
    losses = [abs(min(c, 0.0)) for c in changes]
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100.0
    return 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)


def _atr(bars: list[Bar], period: int = 14) -> Optional[float]:
    if len(bars) < period + 1:
        return None
    trs = [
        max(bars[i].high - bars[i].low,
            abs(bars[i].high - bars[i - 1].close),
            abs(bars[i].low  - bars[i - 1].close))
        for i in range(1, len(bars))
    ]
    if len(trs) < period:
        return None
    return sum(trs[-period:]) / period


def _bollinger(closes: list[float], period: int = 20) -> tuple[Optional[float], Optional[float], Optional[float]]:
    """Returns (lower, middle, upper). Std uses population formula."""
    if len(closes) < period:
        return None, None, None
    window = closes[-period:]
    mid = sum(window) / period
    std = math.sqrt(sum((c - mid) ** 2 for c in window) / period)
    return mid - 2 * std, mid, mid + 2 * std


def _stochastic_k(bars: list[Bar], period: int = 14) -> Optional[float]:
    if len(bars) < period:
        return None
    window = bars[-period:]
    low_min  = min(b.low  for b in window)
    high_max = max(b.high for b in window)
    if high_max == low_min:
        return 50.0
    return (bars[-1].close - low_min) / (high_max - low_min) * 100.0


# ── Main feature extractor ────────────────────────────────────────────────────

def compute_features_at(bars: list[Bar], idx: int) -> dict[str, Optional[float]]:
    """
    Compute every available technical indicator at bar index `idx`.
    Uses only bars[:idx+1] (no look-ahead).
    Returns a flat dict of feature_name -> float | None.
    """
    history = bars[: idx + 1]
    closes  = [b.close for b in history]
    volumes = [b.volume for b in history]

    if not closes:
        return {}

    price   = closes[-1]
    f: dict[str, Optional[float]] = {}

    # ── RSI ──────────────────────────────────────────────────────────────────
    for period in (7, 14, 21):
        f[f"rsi_{period}"] = _rsi(closes, period)

    # ── SMA distance (%) ─────────────────────────────────────────────────────
    for period in (10, 20, 50, 100, 200):
        sma = _sma(closes, period)
        f[f"sma_{period}_dist_pct"] = (price / sma - 1.0) * 100.0 if sma else None

    # ── EMA distance (%) ─────────────────────────────────────────────────────
    for period in (9, 21, 55):
        ema = _ema(closes, period)
        f[f"ema_{period}_dist_pct"] = (price / ema - 1.0) * 100.0 if ema else None

    # ── Bollinger Bands ───────────────────────────────────────────────────────
    bb_lo, bb_mid, bb_hi = _bollinger(closes, 20)
    if bb_hi is not None and bb_hi != bb_lo:
        f["bb_position"]  = (price - bb_lo) / (bb_hi - bb_lo)
        f["bb_width_pct"] = (bb_hi - bb_lo) / bb_mid * 100.0 if bb_mid else None
    else:
        f["bb_position"]  = None
        f["bb_width_pct"] = None

    # ── ATR ──────────────────────────────────────────────────────────────────
    atr = _atr(history, 14)
    f["atr_14_pct"] = atr / price * 100.0 if (atr and price) else None

    # ── Volume ratio ─────────────────────────────────────────────────────────
    if len(volumes) >= 20:
        avg_vol = sum(volumes[-20:]) / 20
        f["volume_ratio_20"] = volumes[-1] / avg_vol if avg_vol > 0 else None
    else:
        f["volume_ratio_20"] = None

    # ── Rate of change (%) ───────────────────────────────────────────────────
    for lookback in (5, 10, 20):
        if len(closes) > lookback:
            prev = closes[-lookback - 1]
            f[f"roc_{lookback}"] = (price / prev - 1.0) * 100.0 if prev else None
        else:
            f[f"roc_{lookback}"] = None

    # ── MACD (12-26, normalised by price) ────────────────────────────────────
    ema12 = _ema(closes, 12)
    ema26 = _ema(closes, 26)
    if ema12 is not None and ema26 is not None:
        macd_line = ema12 - ema26
        f["macd_pct"] = macd_line / price * 100.0 if price else None
    else:
        f["macd_pct"] = None

    # ── Stochastic %K ────────────────────────────────────────────────────────
    f["stoch_k_14"] = _stochastic_k(history, 14)

    # ── Realized volatility (20-bar std of log-returns, annualised-ish) ──────
    if len(closes) >= 21:
        log_rets = [
            math.log(closes[i] / closes[i - 1])
            for i in range(len(closes) - 20, len(closes))
        ]
        mu  = sum(log_rets) / len(log_rets)
        vol = math.sqrt(sum((r - mu) ** 2 for r in log_rets) / len(log_rets))
        f["volatility_20"] = vol * 100.0
    else:
        f["volatility_20"] = None

    # ── Distance from N-bar extremes (%) ─────────────────────────────────────
    for lookback in (14, 50):
        if len(history) >= lookback:
            highs = [b.high for b in history[-lookback:]]
            lows  = [b.low  for b in history[-lookback:]]
            f[f"dist_from_{lookback}bar_high"] = (price / max(highs) - 1.0) * 100.0
            f[f"dist_from_{lookback}bar_low"]  = (price / min(lows)  - 1.0) * 100.0
        else:
            f[f"dist_from_{lookback}bar_high"] = None
            f[f"dist_from_{lookback}bar_low"]  = None

    return f


# ── Time-series extractor ─────────────────────────────────────────────────────

def compute_feature_series(
    bars: list[Bar],
    idx: int,
    length: int = 20,
) -> dict[str, list[Optional[float]]]:
    """
    Return the last `length` values of every indicator ending at bar `idx`.
    Each key maps to a list of `length` floats (earliest first).
    Earlier bars may have None if data is insufficient.
    """
    start = max(0, idx - length + 1)
    series: dict[str, list[Optional[float]]] = {}

    for bar_idx in range(start, idx + 1):
        snap = compute_features_at(bars, bar_idx)
        for key, val in snap.items():
            series.setdefault(key, []).append(val)

    # Pad with None at the front if the series started late
    for key in list(series.keys()):
        pad = length - len(series[key])
        if pad > 0:
            series[key] = [None] * pad + series[key]

    return series


# ── Canonical feature list (defines output order) ────────────────────────────

FEATURE_NAMES: list[str] = [
    "rsi_7", "rsi_14", "rsi_21",
    "sma_10_dist_pct", "sma_20_dist_pct", "sma_50_dist_pct",
    "sma_100_dist_pct", "sma_200_dist_pct",
    "ema_9_dist_pct", "ema_21_dist_pct", "ema_55_dist_pct",
    "bb_position", "bb_width_pct",
    "atr_14_pct",
    "volume_ratio_20",
    "roc_5", "roc_10", "roc_20",
    "macd_pct",
    "stoch_k_14",
    "volatility_20",
    "dist_from_14bar_high", "dist_from_14bar_low",
    "dist_from_50bar_high", "dist_from_50bar_low",
]
