from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.cryptobot.bot import (
    NOT_LIVE_DEPLOYABLE, BotConfig, all_bots, create_bot, get_bot, remove_bot,
)
from app.cryptobot.exchange import LIVE_TRADING
from app.cryptobot.ledger import get_ledger
from app.scout.strategies_store import strategies_store

router = APIRouter()


def _status_dict(bot) -> dict:
    status = bot.status()
    cfg = bot.config
    return {
        "bot_id": status.bot_id,
        "mode": status.mode,
        "trader": status.trader,
        "strategy": status.strategy,
        "strategy_id": cfg.strategy_id,
        "strategy_params": cfg.strategy_params,
        "symbol": status.symbol,
        "interval": status.interval,
        "position_size_usd": cfg.position_size_usd,
        "poll_seconds": cfg.poll_seconds,
        "bars_seen": status.bars_seen,
        "last_signal": status.last_signal,
        "last_price": status.last_price,
        "position": status.position,
        "trades_count": status.trades_count,
        "last_error": status.last_error,
        "started_at": status.started_at,
        "uptime_seconds": round(status.uptime_seconds, 1),
        "server_live_trading_enabled": LIVE_TRADING,
    }


class CreateBotRequest(BaseModel):
    trader: str
    strategy_id: int          # a strategies_store entry id belonging to this trader
    symbol: str | None = None  # defaults to the strategy's own backtested pair
    position_size_usd: float = 25.0
    poll_seconds: float = 300.0
    interval: str = "1d"      # bar timeframe; "1d" matches how strategies are backtested


@router.post("/bots")
async def create_bot_endpoint(body: CreateBotRequest):
    """Deploy one of a trader's backtested strategies as a bot.

    Always starts in dry_run — mode can only ever be promoted afterwards,
    via /bots/{bot_id}/mode, and never straight to live.
    """
    entry = next((e for e in strategies_store.entries if e["id"] == body.strategy_id), None)
    if entry is None or entry.get("trader") != body.trader:
        raise HTTPException(status_code=404, detail="Unknown strategy for this trader")
    if entry["strategy"] in NOT_LIVE_DEPLOYABLE:
        raise HTTPException(
            status_code=400,
            detail=f"'{entry['strategy']}' uses full look-ahead and cannot run live.",
        )

    symbol = body.symbol or (entry.get("pairs") or ["BTC-USD"])[0]
    config = BotConfig(
        bot_id=uuid.uuid4().hex[:10],
        trader=body.trader,
        strategy_id=entry["id"],
        strategy_key=entry["strategy"],
        strategy_params=entry.get("params") or {},
        symbol=symbol,
        interval=body.interval,
        position_size_usd=body.position_size_usd,
        poll_seconds=body.poll_seconds,
        mode="dry_run",
    )
    bot = await create_bot(config)
    return _status_dict(bot)


@router.get("/bots")
async def list_bots():
    return [_status_dict(bot) for bot in all_bots().values()]


@router.get("/bots/{bot_id}")
async def bot_status(bot_id: str):
    bot = get_bot(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    return _status_dict(bot)


@router.get("/bots/{bot_id}/activity")
async def bot_activity(bot_id: str):
    bot = get_bot(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    return bot.activity()


@router.post("/bots/{bot_id}/mode")
async def set_mode(bot_id: str, mode: Literal["dry_run", "live", "stopped"]):
    bot = get_bot(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    try:
        bot.set_mode(mode)  # type: ignore[arg-type]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _status_dict(bot)


@router.post("/bots/{bot_id}/stop")
async def stop_bot(bot_id: str):
    removed = await remove_bot(bot_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Bot not found")
    return {"status": "stopped", "bot_id": bot_id}


@router.get("/bots/{bot_id}/trades")
async def bot_trades(bot_id: str, n: int = 50):
    return get_ledger().for_bot(bot_id, n)
