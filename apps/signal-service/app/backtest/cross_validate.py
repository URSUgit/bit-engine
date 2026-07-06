"""
Cross-source data validation — fetch the same symbol/interval from multiple
independent exchanges and compare bar-by-bar. Divergence beyond a threshold
flags one source as unreliable. This is how you trust "best quality" data:
two independent feeds that agree.

Sources: Binance (primary), Bybit (independent), Kraken (independent).
All free, no API key. Pure-Python comparison (no pandas).
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone

import httpx

from .models import Bar
from .data import (
    BINANCE_SYMBOL_MAP, BINANCE_BASE, BINANCE_INTERVAL_MAP,
    KRAKEN_BASE, KRAKEN_CRYPTO_MAP, KRAKEN_INTERVAL_MAP, HEADERS,
)

# Bybit v5 spot symbols (same USDT pairs as Binance) and interval codes.
BYBIT_BASE = "https://api.bybit.com/v5/market/kline"
BYBIT_INTERVAL_MAP = {
    "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30",
    "1h": "60", "2h": "120", "4h": "240", "6h": "360", "12h": "720",
    "1d": "D", "1wk": "W",
}


@dataclass
class SourceResult:
    source: str
    ok: bool
    bar_count: int
    error: str | None = None


@dataclass
class CrossValidationReport:
    symbol: str
    interval: str
    sources: list[dict] = field(default_factory=list)
    compared_bars: int = 0
    matching_bars: int = 0          # bars within tolerance across sources
    max_divergence_pct: float = 0.0
    mean_divergence_pct: float = 0.0
    divergent_timestamps: list[dict] = field(default_factory=list)
    agreement_pct: float = 0.0
    verdict: str = "unknown"        # "trusted" | "minor_drift" | "conflict" | "insufficient"
    recommended_source: str = "binance"

    def to_dict(self) -> dict:
        return asdict(self)


async def _fetch_binance(symbol: str, interval: str, limit: int) -> list[Bar]:
    sym = BINANCE_SYMBOL_MAP.get(symbol)
    if not sym:
        return []
    code = BINANCE_INTERVAL_MAP.get(interval, "1d")
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(f"{BINANCE_BASE}/klines",
                        params={"symbol": sym, "interval": code, "limit": limit},
                        headers=HEADERS)
        r.raise_for_status()
        return [
            Bar(timestamp=datetime.fromtimestamp(k[0] / 1000, tz=timezone.utc),
                open=float(k[1]), high=float(k[2]), low=float(k[3]),
                close=float(k[4]), volume=float(k[5]))
            for k in r.json()
        ]


async def _fetch_bybit(symbol: str, interval: str, limit: int) -> list[Bar]:
    sym = BINANCE_SYMBOL_MAP.get(symbol)  # same USDT ticker as Binance
    code = BYBIT_INTERVAL_MAP.get(interval)
    if not sym or not code:
        return []
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(BYBIT_BASE,
                        params={"category": "spot", "symbol": sym,
                                "interval": code, "limit": min(limit, 1000)},
                        headers=HEADERS)
        r.raise_for_status()
        data = r.json()
        rows = data.get("result", {}).get("list", [])
        # Bybit returns newest-first: [startMs, open, high, low, close, volume, turnover]
        bars = [
            Bar(timestamp=datetime.fromtimestamp(int(k[0]) / 1000, tz=timezone.utc),
                open=float(k[1]), high=float(k[2]), low=float(k[3]),
                close=float(k[4]), volume=float(k[5]))
            for k in rows
        ]
        bars.sort(key=lambda b: b.ts)
        return bars


async def _fetch_kraken(symbol: str, interval: str, limit: int) -> list[Bar]:
    pair = KRAKEN_CRYPTO_MAP.get(symbol)
    mins = KRAKEN_INTERVAL_MAP.get(interval)
    if not pair or not mins:
        return []
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(f"{KRAKEN_BASE}/OHLC",
                        params={"pair": pair, "interval": mins},
                        headers=HEADERS)
        r.raise_for_status()
        data = r.json()
        result = data.get("result", {})
        rows = next((v for k, v in result.items() if k != "last"), [])
        bars = [
            Bar(timestamp=datetime.fromtimestamp(int(k[0]), tz=timezone.utc),
                open=float(k[1]), high=float(k[2]), low=float(k[3]),
                close=float(k[4]), volume=float(k[6]))
            for k in rows
        ]
        bars.sort(key=lambda b: b.ts)
        return bars[-limit:]


def _index(bars: list[Bar]) -> dict[int, Bar]:
    return {b.ts: b for b in bars}


async def cross_validate(
    symbol: str,
    interval: str = "1d",
    limit: int = 200,
    tolerance_pct: float = 0.1,
) -> CrossValidationReport:
    """
    Fetch the symbol from Binance + Bybit + Kraken and compare close prices on
    shared timestamps. `tolerance_pct` is the per-bar close divergence (in %)
    below which sources are considered to agree.
    """
    report = CrossValidationReport(symbol=symbol, interval=interval)

    fetchers = [
        ("binance", _fetch_binance),
        ("bybit", _fetch_bybit),
        ("kraken", _fetch_kraken),
    ]
    series: dict[str, dict[int, Bar]] = {}
    for name, fn in fetchers:
        try:
            bars = await fn(symbol, interval, limit)
            series[name] = _index(bars)
            report.sources.append(asdict(SourceResult(name, True, len(bars))))
        except Exception as e:
            report.sources.append(asdict(SourceResult(name, False, 0, str(e)[:160])))

    # Need at least two non-empty sources to compare.
    populated = {k: v for k, v in series.items() if v}
    if len(populated) < 2:
        report.verdict = "insufficient"
        report.recommended_source = next(iter(populated), "binance")
        return report

    # Reference = Binance if present, else the source with the most bars.
    ref_name = "binance" if populated.get("binance") else max(populated, key=lambda k: len(populated[k]))
    ref = populated[ref_name]
    others = {k: v for k, v in populated.items() if k != ref_name}

    divergences: list[float] = []
    divergent: list[dict] = []
    compared = 0
    matching = 0

    for ts, ref_bar in sorted(ref.items()):
        peer_closes = [(name, s[ts].close) for name, s in others.items() if ts in s]
        if not peer_closes:
            continue
        compared += 1
        bar_max_div = 0.0
        worst_peer = ""
        for name, close in peer_closes:
            if ref_bar.close > 0:
                div = abs(close - ref_bar.close) / ref_bar.close * 100
                if div > bar_max_div:
                    bar_max_div = div
                    worst_peer = name
        divergences.append(bar_max_div)
        if bar_max_div <= tolerance_pct:
            matching += 1
        elif len(divergent) < 50:
            divergent.append({
                "ts": ts,
                "iso": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(),
                "ref_source": ref_name,
                "ref_close": round(ref_bar.close, 6),
                "peer_source": worst_peer,
                "divergence_pct": round(bar_max_div, 4),
            })

    report.compared_bars = compared
    report.matching_bars = matching
    report.max_divergence_pct = round(max(divergences), 4) if divergences else 0.0
    report.mean_divergence_pct = round(sum(divergences) / len(divergences), 4) if divergences else 0.0
    report.divergent_timestamps = divergent
    report.agreement_pct = round(matching / compared * 100, 1) if compared else 0.0
    report.recommended_source = ref_name

    if compared == 0:
        report.verdict = "insufficient"
    elif report.agreement_pct >= 99:
        report.verdict = "trusted"
    elif report.agreement_pct >= 90:
        report.verdict = "minor_drift"
    else:
        report.verdict = "conflict"

    return report
