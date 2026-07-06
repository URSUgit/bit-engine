"""Market regime classification: label each bar as bull/bear/ranging/high-vol/low-vol."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    import pandas as pd


class Regime:
    BULL_TREND = "bull_trend"
    BEAR_TREND = "bear_trend"
    RANGING = "ranging"
    HIGH_VOL = "high_vol"
    LOW_VOL = "low_vol"


@dataclass
class RegimeStat:
    regime: str
    bar_count: int
    bar_pct: float
    trade_count: int
    win_rate: float
    avg_pnl_pct: float
    total_pnl: float
    best_trade_pct: float
    worst_trade_pct: float


@dataclass
class RegimeAnalysisResult:
    regime_per_bar: list[dict]
    stats: list[RegimeStat]
    dominant_regime: str
    best_regime: str
    insight: str


def _ema(series: np.ndarray, period: int) -> np.ndarray:
    out = np.full_like(series, np.nan)
    k = 2.0 / (period + 1)
    # seed with SMA
    if len(series) < period:
        return out
    out[period - 1] = series[:period].mean()
    for i in range(period, len(series)):
        out[i] = series[i] * k + out[i - 1] * (1 - k)
    return out


def _atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int) -> np.ndarray:
    n = len(close)
    tr = np.zeros(n)
    tr[0] = high[0] - low[0]
    for i in range(1, n):
        tr[i] = max(high[i] - low[i], abs(high[i] - close[i - 1]), abs(low[i] - close[i - 1]))
    atr = np.full(n, np.nan)
    atr[period - 1] = tr[:period].mean()
    k = 1.0 / period
    for i in range(period, n):
        atr[i] = tr[i] * k + atr[i - 1] * (1 - k)
    return atr


def _adx(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int) -> np.ndarray:
    n = len(close)
    plus_dm = np.zeros(n)
    minus_dm = np.zeros(n)
    tr = np.zeros(n)
    for i in range(1, n):
        h_diff = high[i] - high[i - 1]
        l_diff = low[i - 1] - low[i]
        plus_dm[i] = h_diff if h_diff > l_diff and h_diff > 0 else 0
        minus_dm[i] = l_diff if l_diff > h_diff and l_diff > 0 else 0
        tr[i] = max(high[i] - low[i], abs(high[i] - close[i - 1]), abs(low[i] - close[i - 1]))

    # Wilder smoothing
    atr_s = np.full(n, np.nan)
    pdm_s = np.full(n, np.nan)
    mdm_s = np.full(n, np.nan)
    if n <= period:
        return np.zeros(n)
    atr_s[period] = tr[1 : period + 1].sum()
    pdm_s[period] = plus_dm[1 : period + 1].sum()
    mdm_s[period] = minus_dm[1 : period + 1].sum()
    for i in range(period + 1, n):
        atr_s[i] = atr_s[i - 1] - atr_s[i - 1] / period + tr[i]
        pdm_s[i] = pdm_s[i - 1] - pdm_s[i - 1] / period + plus_dm[i]
        mdm_s[i] = mdm_s[i - 1] - mdm_s[i - 1] / period + minus_dm[i]

    with np.errstate(invalid="ignore", divide="ignore"):
        pdi = np.where(atr_s > 0, 100 * pdm_s / atr_s, 0.0)
        mdi = np.where(atr_s > 0, 100 * mdm_s / atr_s, 0.0)
        dx = np.where((pdi + mdi) > 0, 100 * np.abs(pdi - mdi) / (pdi + mdi), 0.0)

    adx = np.full(n, np.nan)
    start = period * 2
    if n <= start:
        return np.zeros(n)
    adx[start] = dx[period + 1 : start + 1].mean()
    for i in range(start + 1, n):
        adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period

    return np.nan_to_num(adx)


def classify_regimes(df: "pd.DataFrame", ema_period: int = 20, atr_period: int = 14, adx_period: int = 14) -> list[dict]:
    """Classify each bar in df into a regime. df must have columns: ts, open, high, low, close, volume."""
    n = len(df)
    if n < max(ema_period, atr_period, adx_period) * 2:
        return [{"ts": str(df.iloc[i]["ts"]), "regime": Regime.RANGING, "close": float(df.iloc[i]["close"]), "adx": 0.0, "atr_pct": 0.0} for i in range(n)]

    close = df["close"].to_numpy(dtype=float)
    high = df["high"].to_numpy(dtype=float)
    low = df["low"].to_numpy(dtype=float)

    ema = _ema(close, ema_period)
    atr = _atr(high, low, close, atr_period)
    adx = _adx(high, low, close, adx_period)

    # ATR as % of close
    atr_pct = np.where(close > 0, atr / close * 100, 0.0)

    # Percentile thresholds (computed on valid values only)
    valid_atr = atr_pct[~np.isnan(atr_pct) & (atr_pct > 0)]
    p75 = float(np.percentile(valid_atr, 75)) if len(valid_atr) > 0 else 1.0
    p25 = float(np.percentile(valid_atr, 25)) if len(valid_atr) > 0 else 0.2

    result = []
    for i in range(n):
        ts = str(df.iloc[i]["ts"])
        c = float(close[i])
        adx_v = float(adx[i]) if not np.isnan(adx[i]) else 0.0
        atr_p = float(atr_pct[i]) if not np.isnan(atr_pct[i]) else 0.0

        # EMA slope: % change from 10 bars ago
        slope = 0.0
        if i >= 10 and not np.isnan(ema[i]) and not np.isnan(ema[i - 10]) and ema[i - 10] > 0:
            slope = (ema[i] - ema[i - 10]) / ema[i - 10] * 100

        if atr_p > p75 * 1.5:
            regime = Regime.HIGH_VOL
        elif atr_p < p25 * 0.7:
            regime = Regime.LOW_VOL
        elif adx_v >= 25 and slope > 0.2:
            regime = Regime.BULL_TREND
        elif adx_v >= 25 and slope < -0.2:
            regime = Regime.BEAR_TREND
        else:
            regime = Regime.RANGING

        result.append({"ts": ts, "regime": regime, "close": c, "adx": round(adx_v, 2), "atr_pct": round(atr_p, 4)})

    return result


def compute_regime_stats(regime_per_bar: list[dict], trades: list[dict], total_bars: int) -> list[RegimeStat]:
    """Bucket trades into regimes by matching entry_time to nearest bar ts."""
    # Build a ts→regime lookup
    ts_regime: dict[str, str] = {r["ts"]: r["regime"] for r in regime_per_bar}
    bar_ts_list = [r["ts"] for r in regime_per_bar]

    # Count bars per regime
    bar_counts: dict[str, int] = {}
    for r in regime_per_bar:
        bar_counts[r["regime"]] = bar_counts.get(r["regime"], 0) + 1

    # Bucket trades
    regime_trades: dict[str, list[dict]] = {
        Regime.BULL_TREND: [], Regime.BEAR_TREND: [],
        Regime.RANGING: [], Regime.HIGH_VOL: [], Regime.LOW_VOL: [],
    }

    for t in trades:
        entry_ts = str(t.get("entry_time", ""))
        # Direct lookup, else find closest bar
        regime = ts_regime.get(entry_ts)
        if regime is None and bar_ts_list:
            # Find closest ts by string prefix (date)
            entry_date = entry_ts[:10]
            for r in regime_per_bar:
                if r["ts"][:10] >= entry_date:
                    regime = r["regime"]
                    break
            if regime is None:
                regime = regime_per_bar[-1]["regime"]
        regime_trades.setdefault(regime, []).append(t)

    stats = []
    all_regimes = [Regime.BULL_TREND, Regime.BEAR_TREND, Regime.RANGING, Regime.HIGH_VOL, Regime.LOW_VOL]
    for reg in all_regimes:
        tr_list = regime_trades.get(reg, [])
        bc = bar_counts.get(reg, 0)
        if bc == 0 and len(tr_list) == 0:
            continue
        wins = [t for t in tr_list if t.get("pnl", 0) > 0]
        win_rate = len(wins) / len(tr_list) * 100 if tr_list else 0.0
        pnl_pcts = [t.get("pnl_pct", 0) for t in tr_list]
        avg_pnl_pct = float(np.mean(pnl_pcts)) if pnl_pcts else 0.0
        total_pnl = sum(t.get("pnl", 0) for t in tr_list)
        best = max(pnl_pcts) if pnl_pcts else 0.0
        worst = min(pnl_pcts) if pnl_pcts else 0.0
        stats.append(RegimeStat(
            regime=reg,
            bar_count=bc,
            bar_pct=round(bc / total_bars * 100, 1) if total_bars > 0 else 0.0,
            trade_count=len(tr_list),
            win_rate=round(win_rate, 1),
            avg_pnl_pct=round(avg_pnl_pct, 2),
            total_pnl=round(total_pnl, 2),
            best_trade_pct=round(best, 2),
            worst_trade_pct=round(worst, 2),
        ))

    return stats
