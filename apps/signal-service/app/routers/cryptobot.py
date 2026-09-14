from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.copilot import BitEngineBotStore, CopilotUnavailable, ask_copilot
from app.cryptobot.bot import (
    NOT_LIVE_DEPLOYABLE, BotConfig, all_bots, create_bot, get_bot, remove_bot,
)
from app.cryptobot.exchange import LIVE_TRADING
from app.cryptobot.hyperliquid_exchange import TESTNET_TRADING as HYPERLIQUID_TESTNET_TRADING
from app.cryptobot.ledger import get_ledger
from app.scout.strategies_store import strategies_store

log = logging.getLogger(__name__)

router = APIRouter()


def _pnl_summary(bot) -> dict:
    """Realized (from closed ledger trades) + unrealized (mark-to-market on
    any open position) PnL for one bot — shared by the single-bot status
    payload and the leaderboard so the two never drift apart."""
    status = bot.status()
    trades = get_ledger().for_bot(status.bot_id, n=10_000)
    closed = [t for t in trades if t["pnl_usd"] is not None]
    realized_pnl = sum(t["pnl_usd"] for t in closed)
    deployed = sum(t["quote_usd"] for t in trades if t["side"] == "BUY")

    unrealized_pnl = 0.0
    if status.position and status.last_price:
        unrealized_pnl = (status.last_price - status.position["entry_price"]) * status.position["size"]

    total_pnl = realized_pnl + unrealized_pnl
    wins = sum(1 for t in closed if t["pnl_usd"] > 0)
    return {
        "total_pnl": round(total_pnl, 4),
        "realized_pnl": round(realized_pnl, 4),
        "unrealized_pnl": round(unrealized_pnl, 4),
        "roi_pct": round((total_pnl / deployed) * 100, 2) if deployed else 0.0,
        "win_rate": round((wins / len(closed)) * 100, 1) if closed else 0.0,
        "total_trades": len(trades),
        "deployed_usd": round(deployed, 2),
    }


def _server_live_trading_enabled(exchange: str) -> bool:
    """Whether THIS bot's own exchange has its server-side live gate open —
    Bitget and Hyperliquid testnet are independent switches (see exchange.py /
    hyperliquid_exchange.py), so a bot must report its own venue's gate, not
    the other one's."""
    return HYPERLIQUID_TESTNET_TRADING if exchange == "hyperliquid_testnet" else LIVE_TRADING


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
        "exchange": cfg.exchange,
        "position_size_usd": cfg.position_size_usd,
        "poll_seconds": cfg.poll_seconds,
        "note": cfg.note,
        "bars_seen": status.bars_seen,
        "last_signal": status.last_signal,
        "last_price": status.last_price,
        "position": status.position,
        "trades_count": status.trades_count,
        "last_error": status.last_error,
        "started_at": status.started_at,
        "uptime_seconds": round(status.uptime_seconds, 1),
        "server_live_trading_enabled": _server_live_trading_enabled(cfg.exchange),
        **_pnl_summary(bot),
    }


class CreateBotRequest(BaseModel):
    trader: str
    strategy_id: int          # a strategies_store entry id belonging to this trader
    symbol: str | None = None  # defaults to the strategy's own backtested pair
    position_size_usd: float = 25.0
    poll_seconds: float = 300.0
    interval: str = "1d"      # bar timeframe; "1d" matches how strategies are backtested
    exchange: Literal["bitget", "hyperliquid_testnet"] = "bitget"


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
        exchange=body.exchange,
    )
    bot = await create_bot(config)
    return _status_dict(bot)


@router.get("/bots")
async def list_bots():
    return [_status_dict(bot) for bot in all_bots().values()]


@router.get("/bots/leaderboard")
async def bots_leaderboard():
    """Rank every currently-running bot by total PnL (realized + unrealized),
    social-leaderboard style — same shape as the trader/paper leaderboards.
    Must be registered before /bots/{bot_id} or that path param would
    swallow the "leaderboard" segment as a bot_id."""
    rows = []
    for bot in all_bots().values():
        status = bot.status()
        rows.append({
            "bot_id": status.bot_id,
            "trader": status.trader,
            "strategy": status.strategy,
            "symbol": status.symbol,
            "exchange": bot.config.exchange,
            "mode": status.mode,
            "note": bot.config.note,
            "position_open": status.position is not None,
            **_pnl_summary(bot),
        })

    rows.sort(key=lambda r: r["total_pnl"], reverse=True)
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return rows


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


class NoteIn(BaseModel):
    note: str = Field(max_length=500)


@router.patch("/bots/{bot_id}/note")
async def set_note(bot_id: str, body: NoteIn):
    """Attach a short rationale ("thesis") to a bot deployment — why this
    trader's strategy was deployed. Shown on the bots list and bot detail
    page, never fed into trading logic."""
    bot = get_bot(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    bot.set_note(body.note.strip())
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


# ── Config copilot ────────────────────────────────────────────────────────────
# The model only ever *proposes* a change. /copilot/ask runs the agent and
# returns a structured turn; /copilot/apply writes a single parameter and is
# called only after the human confirms the card in the UI.

class CopilotAskIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


class CopilotApplyIn(BaseModel):
    parameter_key: str = Field(min_length=1, max_length=100)
    new_value: float | int | bool | str


def _proposal_dict(p) -> dict | None:
    return None if p is None else asdict(p)


@router.post("/bots/{bot_id}/copilot/ask")
async def copilot_ask(bot_id: str, body: CopilotAskIn):
    """Ask the config copilot about this bot. Never mutates anything."""
    if not get_bot(bot_id):
        raise HTTPException(status_code=404, detail="Bot not found")
    try:
        turn = await asyncio.to_thread(
            ask_copilot,
            bot_id=bot_id,
            user_message=body.message.strip(),
            store=BitEngineBotStore(),
        )
    except CopilotUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        log.exception("copilot ask failed for bot %s", bot_id)
        raise HTTPException(status_code=502, detail=f"Copilot failed: {exc}")
    return {
        "thought": turn.thought,
        "analysis": turn.analysis,
        "proposal": _proposal_dict(turn.proposal),
        "tool_calls": turn.tool_calls,
    }


@router.post("/bots/{bot_id}/copilot/apply")
async def copilot_apply(bot_id: str, body: CopilotApplyIn):
    """Apply one human-confirmed parameter change. The model never calls this."""
    if not get_bot(bot_id):
        raise HTTPException(status_code=404, detail="Bot not found")
    try:
        updated = BitEngineBotStore().apply_config_change(
            bot_id, body.parameter_key, body.new_value,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except (TypeError, ValueError) as exc:
        # e.g. a value the strategy constructor rejects — the bot keeps running
        # on its previous params (see CryptoBot.set_strategy_params).
        raise HTTPException(status_code=400, detail=f"Invalid value: {exc}")
    return {"applied": True, "parameter": asdict(updated)}


@router.get("/bots/{bot_id}/copilot/config")
async def copilot_config(bot_id: str):
    """The bot's tunable parameters, as the copilot sees them — lets the UI
    render the panel without duplicating the schema-to-control mapping."""
    try:
        snapshot = BitEngineBotStore().get_bot_snapshot(bot_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Bot not found")
    return {
        "bot_id": snapshot.bot_id,
        "name": snapshot.name,
        "mode": snapshot.mode.value,
        "symbol": snapshot.symbol,
        "strategy_key": snapshot.strategy_key,
        "config": [asdict(p) for p in snapshot.config],
    }
