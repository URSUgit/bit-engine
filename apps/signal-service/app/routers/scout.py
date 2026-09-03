"""YouTube trading scout API: watch channels, analyze videos, get live
signals/strategy suggestions, and instantly backtest what a video claims."""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.scout.extract import parse_video_id
from app.scout.service import scout_service
from app.scout.strategies_store import strategies_store

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


@router.get("/channels/{cid}/latest")
async def channel_latest_video(cid: str):
    try:
        video = await scout_service.latest_video(cid)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not fetch channel feed: {exc!r}")
    if not video:
        raise HTTPException(status_code=404, detail="No videos found for this channel")
    return video


class DiscoverIn(BaseModel):
    query: str = Field(min_length=2, max_length=120)
    auto_watch: bool = False


@router.post("/discover")
async def discover(body: DiscoverIn):
    """Search YouTube for candidate trading channels (no API key). Optionally
    starts watching every candidate found, tagged as auto-discovered."""
    candidates = await scout_service.discover_channels(body.query)
    if body.auto_watch:
        for c in candidates:
            try:
                ch = await scout_service.watch(c["id"], auto=True, query=body.query)
                c["watching"] = True
                c["name"] = ch["name"]
            except Exception:
                pass
    return {"query": body.query, "candidates": candidates}


@router.get("/discovered")
async def discovered(limit: int = Query(30, ge=1, le=60)):
    return list(scout_service.discovered)[:limit]


class AnalyzeIn(BaseModel):
    url: str = Field(min_length=6, description="YouTube video URL or 11-char id")


@router.post("/analyze")
async def analyze(body: AnalyzeIn):
    vid = parse_video_id(body.url)
    if not vid:
        raise HTTPException(status_code=422, detail="Not a recognizable YouTube video URL/id")
    return await scout_service.analyze_video(vid)


@router.get("/analyze_stream")
async def analyze_stream(url: str = Query(..., min_length=6)):
    """Server-Sent Events view of a single video's live analysis: title →
    transcript → strategy extraction → guest check → frame OCR → done.
    Manual-trigger only (not used by the background poll loop)."""
    vid = parse_video_id(url)
    if not vid:
        raise HTTPException(status_code=422, detail="Not a recognizable YouTube video URL/id")

    async def event_stream():
        async for event in scout_service.analyze_video_live(vid):
            yield f"data: {json.dumps(event)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


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


class AnchoredBacktestIn(BaseModel):
    analysis_id: int
    signal_index: int = 0


@router.post("/backtest/anchored")
async def anchored_backtest(body: AnchoredBacktestIn):
    """Replay a video's actual call: enter at the real historical price at
    the exact video timestamp the trader said it, using their own stated
    stop-loss/take-profit, and see what really happened."""
    try:
        return await scout_service.anchored_backtest(body.analysis_id, body.signal_index)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/strategies")
async def list_strategies():
    """Every named strategy model extracted from any analyzed video (background
    poll or manual analysis alike), for the Backtester page's persistent,
    editable strategy queue. Newest first."""
    return strategies_store.list_entries()


class StrategyPatchIn(BaseModel):
    name: str | None = None
    params: dict | None = None
    pairs: list[str] | None = None
    position_pct: float | None = None
    risk_pct: float | None = None
    stop_loss_pct: float | None = None
    take_profit_pct: float | None = None
    leverage: float | None = None


@router.patch("/strategies/{entry_id}")
async def update_strategy(entry_id: int, body: StrategyPatchIn):
    try:
        return strategies_store.update_entry(entry_id, body.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/strategies/{entry_id}")
async def delete_strategy(entry_id: int):
    if not strategies_store.delete_entry(entry_id):
        raise HTTPException(status_code=404, detail="Unknown strategy id")
    return {"removed": entry_id}


@router.get("/traders")
async def list_traders():
    """Every trader (channel) with at least one persisted technical strategy,
    for the trader-index page."""
    return await scout_service.list_traders()


@router.get("/traders/{trader}")
async def trader_profile(trader: str, period: str = "all"):
    """A trader's video/strategy history plus aggregate performance,
    backtested over the requested window (1m/3m/6m/1y/all)."""
    try:
        return await scout_service.trader_profile(trader, period)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/poll")
async def poll_now():
    """Force an immediate poll of all watched channels."""
    fresh = await scout_service.poll_once()
    return {"new_videos": len(fresh), "analyses": [a["id"] for a in fresh]}
