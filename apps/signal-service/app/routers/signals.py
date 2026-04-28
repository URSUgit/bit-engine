from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Query, HTTPException

from app.models.signal import Signal, SignalCreate, SignalDirection, SignalSource

router = APIRouter()


@router.get("", response_model=list[Signal])
async def list_signals(
    asset: Optional[str] = Query(None),
    direction: Optional[SignalDirection] = Query(None),
    source: Optional[SignalSource] = Query(None),
    min_confidence: float = Query(0.0, ge=0, le=1),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """List signals with optional filters. Results are sorted by confidence desc."""
    # TODO: query MongoDB for signals
    return []


@router.get("/latest", response_model=list[Signal])
async def get_latest_signals(limit: int = Query(20, ge=1, le=100)):
    """Return the most recent active signals across all assets."""
    return []


@router.get("/{signal_id}", response_model=Signal)
async def get_signal(signal_id: str):
    # TODO: fetch from MongoDB
    raise HTTPException(status_code=404, detail="Signal not found")


@router.post("", response_model=Signal, status_code=201)
async def create_signal(payload: SignalCreate):
    """Internal endpoint to ingest a new signal from scrapers or FinBERT pipeline."""
    import uuid
    from datetime import datetime
    signal = Signal(
        **payload.model_dump(),
        id=str(uuid.uuid4()),
        created_at=datetime.utcnow(),
    )
    # TODO: persist to MongoDB and publish to Kafka
    return signal
