"""
Data quality engine — validates OHLCV integrity on top of the existing
SQLite bar store. Pure-Python (no pandas/numpy dependency) so it runs in any
environment. Detects gaps, price spikes, OHLC violations and computes a
0–100 completeness/quality score per (symbol, interval).
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone

from .models import Bar
from .storage import bar_storage

# Interval → seconds. Matches the interval strings used across the data layer.
INTERVAL_SECONDS: dict[str, int] = {
    "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1_800,
    "1h": 3_600, "2h": 7_200, "4h": 14_400, "6h": 21_600,
    "8h": 28_800, "12h": 43_200, "1d": 86_400, "1wk": 604_800,
}


@dataclass
class QualityIssue:
    kind: str          # "gap" | "spike" | "ohlc_violation" | "zero_volume" | "duplicate"
    severity: int      # 1 (info) – 5 (critical)
    ts: int            # unix seconds where the issue occurs
    detail: str
    iso: str = ""

    def __post_init__(self) -> None:
        if not self.iso and self.ts:
            self.iso = datetime.fromtimestamp(self.ts, tz=timezone.utc).isoformat()


@dataclass
class QualityReport:
    symbol: str
    interval: str
    bar_count: int
    expected_count: int
    completeness_pct: float          # present / expected * 100
    quality_score: float             # 0–100 weighted by issue severity
    gap_count: int
    spike_count: int
    ohlc_violation_count: int
    zero_volume_count: int
    duplicate_count: int
    earliest_iso: str | None
    latest_iso: str | None
    issues: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def _mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def _stddev(xs: list[float], mu: float) -> float:
    if len(xs) < 2:
        return 0.0
    var = sum((x - mu) ** 2 for x in xs) / (len(xs) - 1)
    return var ** 0.5


def detect_gaps(bars: list[Bar], interval: str) -> list[QualityIssue]:
    """Find missing bars: consecutive timestamps spaced > 1.5× the interval."""
    step = INTERVAL_SECONDS.get(interval)
    if not step or len(bars) < 2:
        return []
    issues: list[QualityIssue] = []
    for prev, cur in zip(bars, bars[1:]):
        delta = cur.ts - prev.ts
        if delta > step * 1.5:
            missing = round(delta / step) - 1
            # Severity scales with how many bars are missing.
            sev = 5 if missing > 50 else 4 if missing > 10 else 3 if missing > 2 else 2
            issues.append(QualityIssue(
                kind="gap", severity=sev, ts=prev.ts,
                detail=f"{missing} missing bar(s) between {datetime.fromtimestamp(prev.ts, tz=timezone.utc).isoformat()} and {datetime.fromtimestamp(cur.ts, tz=timezone.utc).isoformat()}",
            ))
    return issues


def detect_spikes(bars: list[Bar], sigma: float = 5.0) -> list[QualityIssue]:
    """Flag bars whose close-to-close return exceeds `sigma` standard deviations."""
    if len(bars) < 30:
        return []
    rets = []
    for prev, cur in zip(bars, bars[1:]):
        if prev.close > 0:
            rets.append((cur.close - prev.close) / prev.close)
    if len(rets) < 30:
        return []
    mu = _mean(rets)
    sd = _stddev(rets, mu)
    if sd == 0:
        return []
    issues: list[QualityIssue] = []
    for i, r in enumerate(rets):
        z = abs(r - mu) / sd
        if z > sigma:
            bar = bars[i + 1]
            sev = 5 if z > sigma * 2 else 4 if z > sigma * 1.4 else 3
            issues.append(QualityIssue(
                kind="spike", severity=sev, ts=bar.ts,
                detail=f"{r * 100:+.2f}% move ({z:.1f}σ) — close {bar.close:g}",
            ))
    return issues


def detect_ohlc_violations(bars: list[Bar]) -> list[QualityIssue]:
    """OHLC sanity: high must be >= open/close/low, low must be <= open/close."""
    issues: list[QualityIssue] = []
    for b in bars:
        bad = []
        if b.high < b.low:
            bad.append("high < low")
        if b.high < b.open or b.high < b.close:
            bad.append("high < open/close")
        if b.low > b.open or b.low > b.close:
            bad.append("low > open/close")
        if any(v < 0 for v in (b.open, b.high, b.low, b.close)):
            bad.append("negative price")
        if bad:
            issues.append(QualityIssue(
                kind="ohlc_violation", severity=5, ts=b.ts,
                detail="; ".join(bad) + f" (O={b.open:g} H={b.high:g} L={b.low:g} C={b.close:g})",
            ))
    return issues


def detect_zero_volume(bars: list[Bar]) -> list[QualityIssue]:
    """Bars with zero/negative volume — suspicious for liquid assets."""
    issues: list[QualityIssue] = []
    for b in bars:
        if b.volume <= 0:
            issues.append(QualityIssue(
                kind="zero_volume", severity=1, ts=b.ts,
                detail=f"volume={b.volume:g}",
            ))
    return issues


def detect_duplicates(bars: list[Bar]) -> list[QualityIssue]:
    """Repeated timestamps (should be impossible given the PK, but verify)."""
    seen: set[int] = set()
    issues: list[QualityIssue] = []
    for b in bars:
        if b.ts in seen:
            issues.append(QualityIssue(
                kind="duplicate", severity=4, ts=b.ts,
                detail="duplicate timestamp",
            ))
        seen.add(b.ts)
    return issues


def expected_bar_count(start_ts: int, end_ts: int, interval: str) -> int:
    step = INTERVAL_SECONDS.get(interval)
    if not step or end_ts <= start_ts:
        return 0
    return int((end_ts - start_ts) / step) + 1


def assess(symbol: str, interval: str, max_issues: int = 200) -> QualityReport:
    """Run all quality checks against the cached bars for a (symbol, interval)."""
    meta = bar_storage.get_meta(symbol, interval)
    if not meta or not meta.get("earliest_ts"):
        return QualityReport(
            symbol=symbol, interval=interval, bar_count=0, expected_count=0,
            completeness_pct=0.0, quality_score=0.0, gap_count=0, spike_count=0,
            ohlc_violation_count=0, zero_volume_count=0, duplicate_count=0,
            earliest_iso=None, latest_iso=None, issues=[],
        )

    start_ts, end_ts = meta["earliest_ts"], meta["latest_ts"]
    bars = bar_storage.get_bars(symbol, interval, start_ts, end_ts)

    gaps = detect_gaps(bars, interval)
    spikes = detect_spikes(bars)
    violations = detect_ohlc_violations(bars)
    zero_vol = detect_zero_volume(bars)
    dupes = detect_duplicates(bars)

    expected = expected_bar_count(start_ts, end_ts, interval)
    completeness = (len(bars) / expected * 100) if expected else 100.0
    completeness = min(completeness, 100.0)

    # Quality score: start at 100, subtract weighted penalties (severity × count),
    # capped so a single category can't zero the score on its own.
    def penalty(issues: list[QualityIssue], cap: float) -> float:
        return min(sum(i.severity for i in issues) * 0.5, cap)

    score = 100.0
    score -= penalty(violations, 40)     # data corruption is worst
    score -= penalty(dupes, 20)
    score -= penalty(gaps, 30)
    score -= penalty(spikes, 15)
    score -= penalty(zero_vol, 10)
    # Completeness directly drags the score too.
    score = score * (0.5 + 0.5 * completeness / 100)
    score = max(0.0, round(score, 1))

    all_issues = sorted(
        gaps + spikes + violations + zero_vol + dupes,
        key=lambda i: (-i.severity, i.ts),
    )[:max_issues]

    return QualityReport(
        symbol=symbol, interval=interval,
        bar_count=len(bars), expected_count=expected,
        completeness_pct=round(completeness, 1),
        quality_score=score,
        gap_count=len(gaps), spike_count=len(spikes),
        ohlc_violation_count=len(violations),
        zero_volume_count=len(zero_vol), duplicate_count=len(dupes),
        earliest_iso=datetime.fromtimestamp(start_ts, tz=timezone.utc).isoformat(),
        latest_iso=datetime.fromtimestamp(end_ts, tz=timezone.utc).isoformat(),
        issues=[i.__dict__ for i in all_issues],
    )
