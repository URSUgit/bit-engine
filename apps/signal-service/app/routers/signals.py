from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Query, HTTPException

from app.models.signal import Signal, SignalCreate, SignalDirection, SignalSource
from app.feeds import signal_engine

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
    from datetime import datetime, timezone
    signal = Signal(
        **payload.model_dump(),
        id=str(uuid.uuid4()),
        created_at=datetime.now(timezone.utc),
    )
    return signal
