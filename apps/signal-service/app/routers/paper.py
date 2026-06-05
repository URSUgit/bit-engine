"""Paper trading REST endpoints."""
from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.paper.store import PaperStore, PaperPosition, PaperTrade

log = logging.getLogger("signal_service.paper")
router = APIRouter()

# Module-level singleton — one SQLite file shared by all requests.
_store = PaperStore()


# ── Helpers ──────────────────────────────────────────────────────────────────

def _latest_price(symbol: str) -> Optional[float]:
    """Return the most recent close price from bar_storage, or None."""
    try:
        from app.backtest.storage import bar_storage
        import time

        sym_upper = symbol.upper()
        # Look for any interval's latest bar
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


def _enrich_position(pos: PaperPosition) -> dict:
    d = asdict(pos)
    cp = _latest_price(pos.symbol) or pos.entry_price
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
def list_positions():
    positions = _store.list_positions()
    return [_enrich_position(p) for p in positions]


@router.post("/positions", status_code=201)
def open_position(req: OpenPositionRequest):
    pos = _store.open_position(
        symbol=req.symbol,
        side=req.side,
        entry_price=req.entry_price,
        size=req.size,
        strategy=req.strategy,
        notes=req.notes,
    )
    return _enrich_position(pos)


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
