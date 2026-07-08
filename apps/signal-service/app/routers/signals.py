from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel

from app.models.signal import Signal, SignalCreate, SignalDirection, SignalSource
from app.feeds import signal_engine

log = logging.getLogger(__name__)
router = APIRouter()


def _to_signal(raw: dict) -> Signal:
    """Convert engine dict to Signal model."""
    from datetime import datetime
    return Signal(
        id=raw["id"],
        asset=raw["asset"],
        direction=raw["direction"],
        confidence=raw["confidence"],
        source=raw.get("source", "technical"),
        reasoning=raw.get("reasoning"),
        metadata=raw.get("metadata", {}),
        created_at=datetime.fromisoformat(raw["created_at"].replace("Z", "+00:00")) if isinstance(raw["created_at"], str) else raw["created_at"],
        is_active=raw.get("is_active", True),
    )


@router.get("", response_model=list[Signal])
async def list_signals(
    asset: Optional[str] = Query(None),
    direction: Optional[SignalDirection] = Query(None),
    source: Optional[SignalSource] = Query(None),
    min_confidence: float = Query(0.0, ge=0, le=1),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """Live signals from RSI + momentum + news sentiment engine."""
    raws = signal_engine.get_signals(
        asset=asset,
        direction=direction.value if direction else None,
        source=source.value if source else None,
        min_confidence=min_confidence,
        limit=limit,
        offset=offset,
    )
    return [_to_signal(r) for r in raws]


@router.get("/latest", response_model=list[Signal])
async def get_latest_signals(limit: int = Query(20, ge=1, le=100)):
    """Most recent active signals sorted by confidence."""
    raws = signal_engine.get_signals(limit=limit)
    return [_to_signal(r) for r in raws]


@router.get("/{signal_id}", response_model=Signal)
async def get_signal(signal_id: str):
    raw = signal_engine.get_signal_by_id(signal_id)
    if not raw:
        raise HTTPException(status_code=404, detail="Signal not found")
    return _to_signal(raw)


@router.post("", response_model=Signal, status_code=201)
async def create_signal(payload: SignalCreate):
    """Ingest a manually created signal."""
    import uuid
    signal = Signal(
        **payload.model_dump(),
        id=str(uuid.uuid4()),
        created_at=datetime.now(timezone.utc),
    )
    return signal


# ── Signal Builder test endpoint ───────────────────────────────────────────────

class ConditionSpec(BaseModel):
    indicator: str          # e.g. "RSI(14)", "EMA(20)", "MACD"
    op: str                 # ">", "<", ">=", "<=", "==", "crosses_above", "crosses_below"
    value: str              # numeric threshold or another indicator name
    compare_to: str = "value"  # "value" | "indicator"


class TestBuilderRequest(BaseModel):
    conditions: list[ConditionSpec]
    symbol: str = "BTC-USD"
    interval: str = "1d"
    start_date: str = "2024-01-01"
    end_date: Optional[str] = None


class TestBuilderResponse(BaseModel):
    symbol: str
    interval: str
    start_date: str
    end_date: str
    bar_count: int
    signal_count: int
    avg_return_pct: float
    win_rate: float
    sample_signals: list[str]   # ISO timestamps where signal fired
    warnings: list[str]


def _compute_indicator(name: str, closes: list[float], idx: int) -> tuple[float, str | None]:
    """
    Compute a single indicator value at bar index *idx* from the *closes* list.
    Returns (value, warning_or_None).
    """
    n = len(closes)
    warning = None

    def _sma(period: int) -> float | None:
        if idx + 1 < period:
            return None
        window = closes[idx + 1 - period: idx + 1]
        return sum(window) / period

    def _ema(period: int) -> float | None:
        """Iterative EMA from index 0 up to idx."""
        if n < period:
            return None
        k = 2 / (period + 1)
        ema = sum(closes[:period]) / period
        for i in range(period, idx + 1):
            ema = closes[i] * k + ema * (1 - k)
        return ema

    name_upper = name.strip().upper()

    # EMA(N)
    if name_upper.startswith("EMA(") and name_upper.endswith(")"):
        try:
            period = int(name_upper[4:-1])
            val = _ema(period)
            return (val if val is not None else 0.0, None if val is not None else f"Not enough bars for {name}")
        except ValueError:
            pass

    # SMA(N)
    if name_upper.startswith("SMA(") and name_upper.endswith(")"):
        try:
            period = int(name_upper[4:-1])
            val = _sma(period)
            return (val if val is not None else 0.0, None if val is not None else f"Not enough bars for {name}")
        except ValueError:
            pass

    # RSI(N)
    if name_upper.startswith("RSI(") and name_upper.endswith(")"):
        try:
            period = int(name_upper[4:-1])
            if idx + 1 < period + 1:
                return (0.0, f"Not enough bars for {name}")
            window = closes[idx - period: idx + 1]
            gains = [max(window[i] - window[i - 1], 0) for i in range(1, len(window))]
            losses = [max(window[i - 1] - window[i], 0) for i in range(1, len(window))]
            avg_gain = sum(gains) / period if period else 0
            avg_loss = sum(losses) / period if period else 0
            rs = avg_gain / avg_loss if avg_loss > 0 else 100.0
            rsi = 100 - (100 / (1 + rs))
            return (rsi, None)
        except ValueError:
            pass

    # MACD — returns the MACD line (EMA12 - EMA26)
    if name_upper == "MACD":
        ema12 = _ema(12)
        ema26 = _ema(26)
        if ema12 is None or ema26 is None:
            return (0.0, f"Not enough bars for MACD")
        return (ema12 - ema26, None)

    # ADX(N) — simplified: returns average |close diff| / avg close (proxy)
    if name_upper.startswith("ADX(") and name_upper.endswith(")"):
        try:
            period = int(name_upper[4:-1])
            if idx + 1 < period + 1:
                return (0.0, f"Not enough bars for {name}")
            window = closes[idx - period: idx + 1]
            diffs = [abs(window[i] - window[i - 1]) for i in range(1, len(window))]
            avg_diff = sum(diffs) / len(diffs) if diffs else 0
            avg_close = sum(window) / len(window) if window else 1
            adx_proxy = (avg_diff / avg_close) * 100
            return (adx_proxy, None)
        except ValueError:
            pass

    # Plain number passthrough
    try:
        return (float(name), None)
    except ValueError:
        pass

    warning = f"Indicator '{name}' not implemented; using 0.0"
    return (0.0, warning)


def _eval_condition(cond: ConditionSpec, closes: list[float], idx: int) -> tuple[bool, float, float, list[str]]:
    """
    Evaluate a single condition at bar *idx*.
    Returns (met, lhs_val, rhs_val, warnings).
    """
    warnings: list[str] = []

    lhs, w = _compute_indicator(cond.indicator, closes, idx)
    if w:
        warnings.append(w)

    # Determine rhs
    try:
        rhs = float(cond.value)
    except ValueError:
        rhs, w = _compute_indicator(cond.value, closes, idx)
        if w:
            warnings.append(w)

    op = cond.op
    if op == ">":
        met = lhs > rhs
    elif op == "<":
        met = lhs < rhs
    elif op == ">=":
        met = lhs >= rhs
    elif op == "<=":
        met = lhs <= rhs
    elif op == "==":
        met = abs(lhs - rhs) < 1e-9
    elif op in ("crosses_above", "crosses_below"):
        if idx == 0:
            met = False
        else:
            prev_lhs, _ = _compute_indicator(cond.indicator, closes, idx - 1)
            try:
                prev_rhs = float(cond.value)
            except ValueError:
                prev_rhs, _ = _compute_indicator(cond.value, closes, idx - 1)
            if op == "crosses_above":
                met = prev_lhs <= prev_rhs and lhs > rhs
            else:
                met = prev_lhs >= prev_rhs and lhs < rhs
    else:
        met = False
        warnings.append(f"Unknown operator '{op}'")

    return met, lhs, rhs, warnings


@router.post("/test-builder", response_model=TestBuilderResponse)
async def test_signal_builder(req: TestBuilderRequest):
    """
    Back-test a custom set of indicator conditions against historical bars.

    For each bar in the date range, all conditions must be true simultaneously.
    Returns hit count, avg 5-bar forward return, win rate, and sample timestamps.
    """
    from app.backtest.data import HistoricalDataLoader

    loader = HistoricalDataLoader()
    end_iso = req.end_date or datetime.now(timezone.utc).date().isoformat()

    try:
        bars = await loader.load(req.symbol, req.start_date, end_iso, req.interval)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to load bars: {exc!r}")

    if len(bars) < 30:
        raise HTTPException(
            status_code=422,
            detail=f"Only {len(bars)} bars available — need at least 30 for meaningful results.",
        )

    closes = [b.close for b in bars]
    n = len(bars)
    FORWARD_BARS = 5

    signal_indices: list[int] = []
    all_warnings: list[str] = []

    for i in range(1, n - FORWARD_BARS):
        all_met = True
        for cond in req.conditions:
            met, _lhs, _rhs, warns = _eval_condition(cond, closes, i)
            all_warnings.extend(warns)
            if not met:
                all_met = False
                break
        if all_met:
            signal_indices.append(i)

    # Deduplicate warnings
    seen: set[str] = set()
    unique_warnings: list[str] = []
    for w in all_warnings:
        if w not in seen:
            seen.add(w)
            unique_warnings.append(w)

    # Compute forward returns
    forward_returns: list[float] = []
    for idx in signal_indices:
        entry = closes[idx]
        exit_price = closes[min(idx + FORWARD_BARS, n - 1)]
        if entry > 0:
            ret_pct = (exit_price - entry) / entry * 100
            forward_returns.append(ret_pct)

    signal_count = len(signal_indices)
    avg_return = sum(forward_returns) / len(forward_returns) if forward_returns else 0.0
    wins = sum(1 for r in forward_returns if r > 0)
    win_rate = wins / len(forward_returns) if forward_returns else 0.0

    sample_signals = [
        bars[i].timestamp.isoformat()
        for i in signal_indices[:10]
    ]

    return TestBuilderResponse(
        symbol=req.symbol,
        interval=req.interval,
        start_date=req.start_date,
        end_date=end_iso,
        bar_count=n,
        signal_count=signal_count,
        avg_return_pct=round(avg_return, 4),
        win_rate=round(win_rate, 4),
        sample_signals=sample_signals,
        warnings=unique_warnings,
    )
