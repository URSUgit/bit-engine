from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Query, HTTPException

from app.models.trader import Trader, TraderStats

router = APIRouter()


@router.get("", response_model=list[Trader])
async def list_traders(
    sort_by: str = Query("roi_30d", pattern="^(roi_30d|roi_90d|sharpe_ratio|win_rate_pct|follower_count)$"),
    risk_level: Optional[str] = Query(None),
    protocol: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """List traders sorted and filtered. Powers the leaderboard."""
    # TODO: query TimescaleDB for aggregated trader stats
    return []


@router.get("/leaderboard", response_model=list[Trader])
async def get_leaderboard(
    period: str = Query("30d", pattern="^(7d|30d|90d|all)$"),
    limit: int = Query(100, ge=1, le=500),
):
    """Leaderboard endpoint — verified on-chain performance ranking."""
    return []


@router.get("/{trader_id}", response_model=Trader)
async def get_trader(trader_id: str):
    raise HTTPException(status_code=404, detail="Trader not found")


@router.get("/{trader_id}/stats", response_model=TraderStats)
async def get_trader_stats(trader_id: str, period: str = Query("30d")):
    raise HTTPException(status_code=404, detail="Trader not found")


@router.get("/{trader_id}/positions")
async def get_trader_positions(trader_id: str):
    # TODO: fetch live positions from on-chain indexer or exchange API
    return {"data": [], "traderId": trader_id}


@router.get("/{trader_id}/history")
async def get_trader_history(
    trader_id: str,
    limit: int = Query(100, ge=1, le=1000),
):
    # TODO: query TimescaleDB trade history
    return {"data": [], "traderId": trader_id}
