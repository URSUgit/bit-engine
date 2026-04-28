from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class SignalDirection(str, Enum):
    buy = "buy"
    sell = "sell"
    hold = "hold"


class SignalSource(str, Enum):
    finbert = "finbert"
    on_chain = "on_chain"
    twitter = "twitter"
    reddit = "reddit"
    telegram = "telegram"
    technical = "technical"
    whale_alert = "whale_alert"


class SignalCreate(BaseModel):
    asset: str
    direction: SignalDirection
    confidence: float = Field(..., ge=0.0, le=1.0)
    source: SignalSource
    reasoning: Optional[str] = None
    raw_text: Optional[str] = None
    metadata: dict = Field(default_factory=dict)


class Signal(SignalCreate):
    id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: Optional[datetime] = None
    is_active: bool = True

    model_config = {"from_attributes": True}
