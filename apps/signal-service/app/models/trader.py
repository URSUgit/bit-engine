from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class RiskLevel(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class TraderStats(BaseModel):
    roi_30d: float = Field(..., description="30-day return on investment (%)")
    roi_90d: float
    roi_all_time: float
    sharpe_ratio: float
    max_drawdown_pct: float
    win_rate_pct: float
    avg_trade_duration_hours: float
    total_trades: int
    pnl_usd_30d: float


class Trader(BaseModel):
    id: str
    wallet_address: str
    handle: Optional[str] = None
    avatar_url: Optional[str] = None
    protocols: list[str] = Field(default_factory=list)
    risk_level: RiskLevel = RiskLevel.medium
    stats: Optional[TraderStats] = None
    follower_count: int = 0
    verified: bool = False
    last_active: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CopyConfig(BaseModel):
    trader_id: str
    allocation_usdc: float = Field(..., gt=0)
    max_position_size_usdc: float = Field(..., gt=0)
    stop_loss_pct: float = Field(default=5.0, ge=0.1, le=50.0)
    max_daily_loss_pct: float = Field(default=3.0, ge=0.1, le=20.0)
    copy_leverage: bool = False
