"""Paper trading REST endpoints."""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import asdict
from math import isfinite
from typing import Optional
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.backtest.history import backtest_history
from app.backtest.models import BacktestRunEvidence
from app.paper.store import PaperStore, PaperPosition, PaperTrade
from app.paper.forward import advance, market_snapshot, new_run

log = logging.getLogger("signal_service.paper")
router = APIRouter()

# Module-level singleton — one SQLite file shared by all requests.
_store = PaperStore()


# ── Helpers ──────────────────────────────────────────────────────────────────

_BINANCE_PRICE_URL = "https://api.binance.com/api/v3/ticker/price"


async def _fetch_live_prices(symbols: set[str]) -> dict[str, float]:
    """Fetch current spot prices for one or more symbols from Binance.

    Binance's bulk endpoint doesn't preserve request order, so results are
    keyed by the response's own "symbol" field, not by request position.
    """
    if not symbols:
        return {}
    syms = sorted(symbols)
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            if len(syms) == 1:
                r = await client.get(_BINANCE_PRICE_URL, params={"symbol": syms[0]})
                r.raise_for_status()
                data = r.json()
                return {data["symbol"]: float(data["price"])}
            r = await client.get(
                _BINANCE_PRICE_URL,
                params={"symbols": json.dumps(syms, separators=(",", ":"))},
            )
            r.raise_for_status()
            return {item["symbol"]: float(item["price"]) for item in r.json()}
    except Exception as exc:
        log.debug("live price lookup failed for %s: %s", syms, exc)
        return {}


def _cached_backtest_price(symbol: str) -> Optional[float]:
    """Fallback only: most recent close from the backtest bar cache.

    This cache is populated by backtest data downloads and can hold bars
    from arbitrary historical ranges — never treat it as a live price, only
    as a last resort when the live Binance fetch fails.
    """
    try:
        from app.backtest.storage import bar_storage

        sym_upper = symbol.upper()
        for interval in ("1h", "15m", "1d", "4h", "5m"):
            meta = bar_storage.get_meta(sym_upper, interval)
            if not meta or not meta.get("latest_ts"):
                continue
            latest_ts = meta["latest_ts"]
            bars = bar_storage.get_bars(sym_upper, interval, latest_ts - 1, latest_ts + 1)
            if bars:
                return bars[-1].close
    except Exception as exc:
        log.debug("bar_storage price lookup failed for %s: %s", symbol, exc)
    return None


def _enrich_position(pos: PaperPosition, live_prices: dict[str, float]) -> dict:
    d = asdict(pos)
    cp = (
        live_prices.get(pos.symbol.upper())
        or _cached_backtest_price(pos.symbol)
        or pos.entry_price
    )
    if pos.side == "long":
        pnl = (cp - pos.entry_price) * pos.size
    else:
        pnl = (pos.entry_price - cp) * pos.size
    pnl_pct = (pnl / pos.notional * 100) if pos.notional else 0.0
    roe_pct = pnl_pct  # no leverage tracking in this simple model
    d.update(
        current_price=cp,
        current_pnl=round(pnl, 6),
        current_pnl_pct=round(pnl_pct, 4),
        roe_pct=round(roe_pct, 4),
    )
    return d


# ── Request / Response schemas ────────────────────────────────────────────────

class OpenPositionRequest(BaseModel):
    symbol: str
    side: str = Field(..., pattern="^(long|short)$")
    entry_price: float = Field(..., gt=0)
    size: float = Field(..., gt=0)
    strategy: str = "manual"
    notes: str = ""


class ClosePositionRequest(BaseModel):
    exit_price: float = Field(..., gt=0)


class NoteRequest(BaseModel):
    notes: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/positions")
async def list_positions():
    positions = await asyncio.to_thread(_store.list_positions)
    live_prices = await _fetch_live_prices({p.symbol.upper() for p in positions})
    return [_enrich_position(p, live_prices) for p in positions]


@router.post("/positions", status_code=201)
async def open_position(req: OpenPositionRequest):
    pos = await asyncio.to_thread(
        _store.open_position,
        symbol=req.symbol,
        side=req.side,
        entry_price=req.entry_price,
        size=req.size,
        strategy=req.strategy,
        notes=req.notes,
    )
    live_prices = await _fetch_live_prices({pos.symbol.upper()})
    return _enrich_position(pos, live_prices)


@router.delete("/positions/{position_id}")
def close_position(position_id: str, req: ClosePositionRequest):
    trade = _store.close_position(position_id, req.exit_price)
    if trade is None:
        raise HTTPException(status_code=404, detail="Position not found")
    return asdict(trade)


@router.post("/positions/{position_id}/note")
def update_note(position_id: str, req: NoteRequest):
    ok = _store.update_notes(position_id, req.notes)
    if not ok:
        raise HTTPException(status_code=404, detail="Position not found")
    return {"ok": True}


@router.get("/trades")
def list_trades(limit: int = 50):
    trades = _store.list_trades(limit=limit)
    return [asdict(t) for t in trades]


@router.get("/summary")
def get_summary():
    return _store.get_summary()


class ForwardRequest(BaseModel):
    offset_bps: int = Field(default=50, strict=True, ge=0, le=400)


def _check_can_start(state):
    if state and state['status'] in ('running', 'paused'):
        raise HTTPException(409, 'Stop the current paper run before starting a new one')


@router.get('/forward')
def forward_status():
    return _store.forward_state()


@router.post('/forward/start', status_code=201)
async def forward_start(req: ForwardRequest):
    _check_can_start(await asyncio.to_thread(_store.forward_state))
    try:
        snapshot = await market_snapshot()
    except (httpx.HTTPError, ValueError, KeyError, TypeError, OverflowError, OSError) as exc:
        log.warning('Paper forward feed unavailable: %s', exc)
        raise HTTPException(503, 'Fresh Binance hourly data is unavailable. No paper run was started.') from exc

    def start(state):
        _check_can_start(state)
        return new_run(req.offset_bps, snapshot)

    return await asyncio.to_thread(_store.update_forward, start)


@router.post('/forward/stop')
def forward_stop():
    def stop(state):
        if state is None:
            raise HTTPException(404, 'There is no paper run to stop')
        return {**state, 'status': 'stopped', 'feed_error': None}

    return _store.update_forward(stop)


class PaperBotRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    backtest_id: str = Field(min_length=1, max_length=80)


@router.get('/bots')
def list_paper_bots():
    return {'bots': _store.list_bots()}


@router.post('/bots', status_code=201)
def create_paper_bot(req: PaperBotRequest):
    saved = backtest_history.get(req.backtest_id)
    if not saved:
        raise HTTPException(404, 'Saved backtest not found.')
    try:
        evidence = BacktestRunEvidence.model_validate(saved.get('run_evidence'))
    except ValueError:
        raise HTTPException(422, 'This saved run has no compatible backtest evidence.') from None
    inputs = evidence.inputs
    origin = inputs.video_origin
    offset = inputs.strategy_params.get('entry_offset_bps')
    if (origin is None or not origin.draft.trader_name or not origin.draft.strategy_name
            or type(offset) is not int or not 0 <= offset <= 400 or saved.get('data_is_synthetic')):
        raise HTTPException(422, 'Use a saved, named video strategy backtest on the Binance archive.')
    if inputs.enable_market_impact or inputs.execution_latency_ms or not isfinite(inputs.initial_capital):
        raise HTTPException(422, 'Paper bots require a backtest without market impact or extra execution latency.')
    return _store.create_bot(dict(
        id=uuid4().hex, status='ready', cash=inputs.initial_capital, offset_bps=offset,
        name=f'{origin.draft.trader_name} · {origin.draft.strategy_name}',
        trader_name=origin.draft.trader_name, strategy_name=origin.draft.strategy_name,
        source=dict(backtest_id=req.backtest_id, video_origin=origin.model_dump(mode='json'),
                    candle_sha256=evidence.candle_sha256, first_candle_utc=evidence.first_candle_utc.isoformat(),
                    last_candle_utc=evidence.last_candle_utc.isoformat()),
        cost_model=dict(initial_capital=inputs.initial_capital, position_size_pct=inputs.position_size_pct,
                        commission_pct=inputs.commission_pct, slippage_pct=inputs.slippage_pct,
                        spread_bps=inputs.spread_bps),
        position=None, events=[], last_bar=None, observed_ms=None, feed_error=None,
    ))


def _require_bot(bot):
    if bot is None:
        raise HTTPException(404, 'Paper bot not found.')
    return bot


def _require_ready_bot(bot):
    bot = _require_bot(bot)
    if bot['status'] != 'ready':
        raise HTTPException(409, 'Only a ready bot can start. Create a new bot for a fresh paper test.')
    return bot


@router.post('/bots/{bot_id}/start')
async def start_paper_bot(bot_id: str):
    _require_ready_bot(await asyncio.to_thread(_store.get_bot, bot_id))
    try:
        bars, _, observed = await market_snapshot()
    except (httpx.HTTPError, ValueError, KeyError, TypeError, OverflowError, OSError):
        raise HTTPException(503, 'Fresh Binance hourly data is unavailable. The bot was not started.') from None

    def start(state):
        bot = _require_ready_bot(state)
        return {**bot, 'status': 'running', 'last_bar': bars[-1].ts, 'observed_ms': observed}

    return await asyncio.to_thread(_store.update_bot, bot_id, start)


@router.post('/bots/{bot_id}/stop')
def stop_paper_bot(bot_id: str):
    def stop(state):
        bot = _require_bot(state)
        if bot['status'] == 'ready':
            raise HTTPException(409, 'This bot has not started.')
        return {**bot, 'status': 'stopped', 'feed_error': None}

    return _store.update_bot(bot_id, stop)


async def tick_forward():
    run, bot_ids = await asyncio.gather(asyncio.to_thread(_store.forward_state), asyncio.to_thread(_store.running_bot_ids))
    run_id = run['id'] if run and run['status'] == 'running' else None
    if run_id is None and not bot_ids:
        return
    try:
        snapshot = await market_snapshot()
    except (httpx.HTTPError, ValueError, KeyError, TypeError, OverflowError, OSError) as exc:
        log.warning('Paper forward feed unavailable: %s', exc)
        snapshot = None

    def update(state, expected_id):
        if not state or state['id'] != expected_id or state['status'] != 'running':
            return state
        if snapshot is None:
            return {**state, 'feed_error': 'Fresh Binance hourly data is unavailable; no fills recorded.'}
        return advance(state, snapshot)

    if run_id is not None:
        await asyncio.to_thread(_store.update_forward, lambda state: update(state, run_id))
    for bot_id in bot_ids:
        await asyncio.to_thread(_store.update_bot, bot_id, lambda state, expected_id=bot_id: update(state, expected_id))


async def run_forward_loop(interval: float = 25):
    while True:
        try:
            await tick_forward()
        except Exception:
            log.exception('Paper forward tick failed')
        await asyncio.sleep(interval)
