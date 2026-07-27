"""YouTube trading scout API: watch channels, analyze videos, get live
signals/strategy suggestions, and instantly backtest what a video claims."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.scout.extract import parse_video_id
from app.scout.service import scout_service

router = APIRouter()


@router.get("/status")
async def status():
    return scout_service.status()


@router.get("/channels")
async def channels():
    return list(scout_service.channels.values())


class ChannelIn(BaseModel):
    ref: str = Field(min_length=2, description="Channel id (UC…), @handle, or URL")


@router.post("/channels")
async def watch_channel(body: ChannelIn):
    try:
        return await scout_service.watch(body.ref)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not resolve channel: {exc!r}")


@router.delete("/channels/{cid}")
async def unwatch_channel(cid: str):
    if not scout_service.unwatch(cid):
        raise HTTPException(status_code=404, detail="Channel not watched")
    return {"removed": cid}


class AnalyzeIn(BaseModel):
    url: str = Field(min_length=6, description="YouTube video URL or 11-char id")


@router.post("/analyze")
async def analyze(body: AnalyzeIn):
    vid = parse_video_id(body.url)
    if not vid:
        raise HTTPException(status_code=422, detail="Not a recognizable YouTube video URL/id")
    return await scout_service.analyze_video(vid)


@router.get("/feed")
async def feed(limit: int = Query(30, ge=1, le=200)):
    return list(scout_service.analyses)[:limit]


class BacktestIn(BaseModel):
    analysis_id: int
    strategy_index: int = 0
    symbol: str | None = None


@router.post("/backtest")
async def backtest(body: BacktestIn):
    try:
        return await scout_service.quick_backtest(body.analysis_id, body.strategy_index, body.symbol)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/poll")
async def poll_now():
    """Force an immediate poll of all watched channels."""
    fresh = await scout_service.poll_once()
    return {"new_videos": len(fresh), "analyses": [a["id"] for a in fresh]}
