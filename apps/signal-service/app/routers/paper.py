"""Paper trading REST endpoints."""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import asdict
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.paper.store import PaperStore, PaperPosition, PaperTrade

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
