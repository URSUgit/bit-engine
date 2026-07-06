from __future__ import annotations

from typing import Literal, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.polymarket.bot import BotConfig, BotMode, create_bot, get_bot, all_bots
from app.polymarket.clob import get_markets, get_orderbook, DRY_RUN
from app.polymarket.ledger import get_ledger

router = APIRouter()


# ─── Markets ──────────────────────────────────────────────────────────────────

@router.get("/markets")
async def list_markets(keyword: str = "", limit: int = 20):
    """Search active Polymarket markets."""
    try:
        markets = await get_markets(keyword=keyword, limit=limit)
        return [
            {
                "condition_id": m.condition_id,
                "question": m.question,
                "end_date": m.end_date_iso,
                "volume": m.volume,
            }
            for m in markets
        ]
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Polymarket API error: {exc}")


@router.get("/markets/{condition_id}/orderbook")
async def orderbook(condition_id: str):
    """Raw order book for a market."""
    data = await get_orderbook(condition_id)
    if not data:
        raise HTTPException(status_code=404, detail="Market not found or empty book")
    return data


# ─── Bot control ──────────────────────────────────────────────────────────────

class StartBotRequest(BaseModel):
    market_id: str
    entry_threshold: float = 0.40
    min_win_rate_edge: float = 0.08
    size_usdc: float = 10.0
    cooldown_seconds: float = 60.0
    mode: BotMode = "dry_run"


@router.post("/bot/start")
async def start_bot(body: StartBotRequest):
    """
    Start (or restart) a bot for a market.
    Mode defaults to dry_run — you must explicitly set 'live' to spend real money.
    """
    config = BotConfig(**body.model_dump())
    try:
        bot = await create_bot(config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "started", "market_id": body.market_id, "mode": body.mode, "dry_run": DRY_RUN}


@router.post("/bot/{market_id}/stop")
async def stop_bot(market_id: str):
    bot = get_bot(market_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not running for this market")
    await bot.stop()
    return {"status": "stopped", "market_id": market_id}


@router.post("/bot/{market_id}/mode")
async def set_mode(market_id: str, mode: Literal["dry_run", "live", "stopped"]):
    bot = get_bot(market_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    try:
        bot.set_mode(mode)  # type: ignore[arg-type]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"market_id": market_id, "mode": mode}


@router.get("/bot/{market_id}/status")
async def bot_status(market_id: str):
    bot = get_bot(market_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    s = bot.status()
    return {
        "mode": s.mode,
        "market_id": s.market_id,
        "question": s.market_question,
        "ticks_processed": s.ticks_processed,
        "trades_attempted": s.trades_attempted,
        "trades_skipped": s.trades_skipped,
        "last_price": s.last_tick_price,
        "last_decision": s.last_decision,
        "feeds": s.feed_stats,
        "uptime_seconds": round(s.uptime_seconds, 1),
    }


@router.get("/bots")
async def list_bots():
    return [
        {"market_id": mid, "mode": bot.config.mode, "status": bot.status().mode}
        for mid, bot in all_bots().items()
    ]


# ─── Ledger / P&L ─────────────────────────────────────────────────────────────

@router.get("/ledger/summary")
async def ledger_summary():
    return get_ledger().summary()


@router.get("/ledger/trades")
async def ledger_trades(n: int = 20):
    return get_ledger().recent(n)


@router.post("/ledger/resolve/{trade_id}")
async def resolve_trade(trade_id: str, won: bool):
    """Manually mark a trade as win/loss when market resolves."""
    trade = get_ledger().resolve(trade_id, won)
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")
    return {"trade_id": trade_id, "won": won, "pnl_usdc": trade.pnl_usdc}
