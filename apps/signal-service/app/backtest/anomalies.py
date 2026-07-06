"""
Anomaly detection on OHLCV bar series.

Detects unusual market conditions that affect scalping:
  volume_spike, price_gap, flash_crash, flash_pump,
  liquidity_vacuum, high_volatility_low_volume,
  spread_anomaly, momentum_exhaustion
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal

from .models import Bar


AnomalyType = Literal[
    "volume_spike",
    "price_gap_up",
    "price_gap_down",
    "flash_crash",
    "flash_pump",
    "liquidity_vacuum",
    "spread_anomaly",
    "momentum_exhaustion",
]


@dataclass
class AnomalyConfig:
    volume_spike_z: float = 3.0          # z-score threshold for volume
    price_gap_pct: float = 0.5           # % gap from prev close
    flash_move_pct: float = 3.0          # % move within flash_window bars
    flash_window_bars: int = 5
    spread_multiplier: float = 5.0       # high-low vs ATR ratio
    liquidity_window: int = 20           # bars for baseline stats
    min_bars_required: int = 25          # need at least this many bars to run


@dataclass
class Anomaly:
    timestamp: int           # unix seconds
    type: AnomalyType
    severity: int            # 1 (weak) – 5 (extreme)
    price: float
    description: str
    suggested_action: str
    bar_index: int = 0


# ── helpers ───────────────────────────────────────────────────────────────────

def _rolling(values: list[float], window: int) -> tuple[float, float]:
    """Return (mean, std) for last `window` values."""
    w = values[-window:]
    n = len(w)
    if n == 0:
        return 0.0, 1.0
    mean = sum(w) / n
    variance = sum((x - mean) ** 2 for x in w) / max(n - 1, 1)
    return mean, math.sqrt(variance)


def _atr(bars: list[Bar], period: int = 14) -> float:
    if len(bars) < 2:
        return bars[-1].high - bars[-1].low if bars else 0.0
    trs = []
    for i in range(1, len(bars)):
        b, prev = bars[i], bars[i - 1]
        trs.append(max(b.high - b.low, abs(b.high - prev.close), abs(b.low - prev.close)))
    period = min(period, len(trs))
    return sum(trs[-period:]) / period


# ── detector ─────────────────────────────────────────────────────────────────

class AnomalyDetector:
    """Scan a list of Bars and return all detected anomalies."""

    def scan(
        self,
        bars: list[Bar],
        config: AnomalyConfig | None = None,
    ) -> list[Anomaly]:
        cfg = config or AnomalyConfig()
        if len(bars) < cfg.min_bars_required:
            return []

        anomalies: list[Anomaly] = []
        volumes = [b.volume for b in bars]

        for i in range(cfg.liquidity_window, len(bars)):
            bar = bars[i]
            prev = bars[i - 1]
            win = cfg.liquidity_window

            # ── volume spike ──────────────────────────────────────────────────
            vol_mean, vol_std = _rolling(volumes[:i], win)
            if vol_std > 0:
                z = (bar.volume - vol_mean) / vol_std
                if z >= cfg.volume_spike_z:
                    severity = min(5, max(1, int(z - cfg.volume_spike_z + 1)))
                    anomalies.append(Anomaly(
                        timestamp=bar.ts,
                        type="volume_spike",
                        severity=severity,
                        price=bar.close,
                        bar_index=i,
                        description=(
                            f"Volume {bar.volume:,.0f} is {z:.1f}σ above "
                            f"{win}-bar mean {vol_mean:,.0f}"
                        ),
                        suggested_action="Expect increased volatility; widen stops or stand aside.",
                    ))

            # ── price gap ─────────────────────────────────────────────────────
            if prev.close > 0:
                gap_pct = (bar.open - prev.close) / prev.close * 100
                if abs(gap_pct) >= cfg.price_gap_pct:
                    atype: AnomalyType = "price_gap_up" if gap_pct > 0 else "price_gap_down"
                    severity = min(5, max(1, int(abs(gap_pct) / cfg.price_gap_pct)))
                    action = (
                        "Gap up may fill — consider fade entry below gap"
                        if gap_pct > 0
                        else "Gap down may fill — consider long entry above gap"
                    )
                    anomalies.append(Anomaly(
                        timestamp=bar.ts,
                        type=atype,
                        severity=severity,
                        price=bar.open,
                        bar_index=i,
                        description=f"Opening gap {gap_pct:+.2f}% from prior close ${prev.close:,.2f}",
                        suggested_action=action,
                    ))

            # ── flash crash / pump ────────────────────────────────────────────
            fw = cfg.flash_window_bars
            if i >= fw:
                window_bars = bars[i - fw + 1: i + 1]
                hi = max(b.high for b in window_bars)
                lo = min(b.low for b in window_bars)
                ref_price = window_bars[0].open
                if ref_price > 0:
                    drop = (ref_price - lo) / ref_price * 100
                    pump = (hi - ref_price) / ref_price * 100
                    if drop >= cfg.flash_move_pct:
                        sev = min(5, max(1, int(drop / cfg.flash_move_pct)))
                        anomalies.append(Anomaly(
                            timestamp=bar.ts,
                            type="flash_crash",
                            severity=sev,
                            price=bar.close,
                            bar_index=i,
                            description=f"Price fell {drop:.1f}% in {fw} bars ({window_bars[0].timestamp} – {bar.timestamp})",
                            suggested_action="Potential snap-back; wait for stabilisation before entry.",
                        ))
                    elif pump >= cfg.flash_move_pct:
                        sev = min(5, max(1, int(pump / cfg.flash_move_pct)))
                        anomalies.append(Anomaly(
                            timestamp=bar.ts,
                            type="flash_pump",
                            severity=sev,
                            price=bar.close,
                            bar_index=i,
                            description=f"Price surged {pump:.1f}% in {fw} bars",
                            suggested_action="Potential reversion; reduce long exposure or fade if volume confirms.",
                        ))

            # ── liquidity vacuum (wide bar, low volume) ───────────────────────
            bar_range = bar.high - bar.low
            atr = _atr(bars[max(0, i - 14): i + 1])
            if atr > 0 and bar.volume > 0:
                range_z = bar_range / atr
                # High range with anomalously low volume → thin book
                if range_z >= 3.0 and bar.volume < vol_mean * 0.4:
                    anomalies.append(Anomaly(
                        timestamp=bar.ts,
                        type="liquidity_vacuum",
                        severity=3,
                        price=bar.close,
                        bar_index=i,
                        description=(
                            f"Wide bar ({range_z:.1f}× ATR) on low volume "
                            f"({bar.volume / vol_mean:.0%} of avg)"
                        ),
                        suggested_action="Thin order book — expect large slippage; reduce position size.",
                    ))

            # ── spread anomaly (unusually wide candle relative to ATR) ────────
            if atr > 0 and bar_range >= cfg.spread_multiplier * atr:
                sev = min(5, max(2, int(bar_range / atr - cfg.spread_multiplier + 1)))
                anomalies.append(Anomaly(
                    timestamp=bar.ts,
                    type="spread_anomaly",
                    severity=sev,
                    price=bar.close,
                    bar_index=i,
                    description=f"Bar range {bar_range:.4f} is {bar_range/atr:.1f}× ATR ({atr:.4f})",
                    suggested_action="Extreme intra-bar volatility — use limit orders only.",
                ))

            # ── momentum exhaustion ────────────────────────────────────────────
            if i >= cfg.liquidity_window + 5:
                # Price made new high but volume declining for last 3 bars
                recent = bars[i - 4: i + 1]
                vol_declining = all(
                    recent[j].volume < recent[j - 1].volume for j in range(2, 5)
                )
                price_at_high = bar.close >= max(b.high for b in bars[i - win: i])
                if vol_declining and price_at_high and bar.volume < vol_mean:
                    anomalies.append(Anomaly(
                        timestamp=bar.ts,
                        type="momentum_exhaustion",
                        severity=2,
                        price=bar.close,
                        bar_index=i,
                        description="Price at multi-bar high but volume declining — bullish momentum fading",
                        suggested_action="Consider tightening stops on long positions; potential reversal setup.",
                    ))

        # deduplicate: keep highest severity per bar per type
        seen: dict[tuple[int, str], Anomaly] = {}
        for a in anomalies:
            key = (a.bar_index, a.type)
            if key not in seen or a.severity > seen[key].severity:
                seen[key] = a

        return sorted(seen.values(), key=lambda a: a.timestamp)
