"""REST API for the historical backtesting engine."""
from __future__ import annotations

import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.backtest import HistoricalDataLoader
from app.backtest.data import SYMBOL_CATALOG, all_symbols
from app.backtest.engine import run_backtest
from app.backtest.history import backtest_history
from app.backtest.metadata import metadata_loader
from app.backtest.models import BacktestParams, BacktestResult, StrategyInfo
from app.backtest.optimizer import OptimizeRequest, OptimizeResult, run_optimization
from app.backtest.storage import bar_storage
from app.backtest.strategies import STRATEGIES

_stream_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="bt-stream")

log = logging.getLogger(__name__)
router = APIRouter()


# ── Discovery ──────────────────────────────────────────────────────────────────

@router.get("/symbols")
async def list_symbols(category: Optional[str] = Query(None)):
    """Return supported symbols, optionally filtered by category."""
    if category:
        syms = SYMBOL_CATALOG.get(category, [])
        return [{"symbol": s, "category": category} for s in syms]
    return all_symbols()


@router.get("/strategies", response_model=list[StrategyInfo])
async def list_strategies():
    """Return all registered strategies with their parameter schemas."""
    return [
        StrategyInfo(
            name=cls.name,
            description=cls.description,
            params_schema=cls.params_schema,
        )
        for cls in STRATEGIES.values()
    ]


@router.get("/intervals")
async def list_intervals():
    """Supported bar intervals + which data sources / asset classes support each."""
    return {
        "intervals": [
            {"value": "1s",  "label": "1 second",  "sources": ["binance"],          "asset_classes": ["crypto"]},
            {"value": "1m",  "label": "1 minute",  "sources": ["binance", "yahoo"], "asset_classes": ["crypto", "stocks"], "yahoo_max_days": 7},
            {"value": "5m",  "label": "5 minutes", "sources": ["binance", "yahoo"], "asset_classes": ["crypto", "stocks"], "yahoo_max_days": 60},
            {"value": "15m", "label": "15 minutes","sources": ["binance", "yahoo"], "asset_classes": ["crypto", "stocks"], "yahoo_max_days": 60},
            {"value": "30m", "label": "30 minutes","sources": ["binance", "yahoo"], "asset_classes": ["crypto", "stocks"], "yahoo_max_days": 60},
            {"value": "1h",  "label": "1 hour",    "sources": ["binance", "yahoo"], "asset_classes": ["crypto", "stocks"], "yahoo_max_days": 730},
            {"value": "4h",  "label": "4 hours",   "sources": ["binance"],          "asset_classes": ["crypto"]},
            {"value": "1d",  "label": "1 day",     "sources": ["yahoo", "binance"], "asset_classes": ["all"]},
            {"value": "1wk", "label": "1 week",    "sources": ["yahoo", "binance"], "asset_classes": ["all"]},
        ]
    }


# ── Single backtest ────────────────────────────────────────────────────────────

@router.post("/run", response_model=BacktestResult)
async def run(params: BacktestParams):
    """Execute a backtest. Returns full result with metrics, trades, equity curve."""
    try:
        return await run_backtest(params)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.exception("Backtest failed")
        raise HTTPException(status_code=500, detail=f"Backtest failed: {e}")


@router.post("/run/stream")
async def run_stream(params: BacktestParams):
    """
    Execute a backtest with real-time SSE progress streaming.
    Events: {type:"progress", phase, current, total, pct}
             {type:"result",  data: BacktestResult}
             {type:"error",   message}
    """
    queue: asyncio.Queue[dict] = asyncio.Queue()
    main_loop = asyncio.get_running_loop()

    def on_progress(phase: str, current: int, total: int) -> None:
        pct = round(current / max(total, 1) * 100.0, 1)
        main_loop.call_soon_threadsafe(queue.put_nowait, {
            "type": "progress", "phase": phase,
            "current": current, "total": total, "pct": pct,
        })

    def run_in_thread() -> None:
        thread_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(thread_loop)
        try:
            result = thread_loop.run_until_complete(
                run_backtest(params, progress_cb=on_progress)
            )
            main_loop.call_soon_threadsafe(queue.put_nowait, {
                "type": "result",
                "data": result.model_dump(mode="json"),
            })
        except ValueError as exc:
            main_loop.call_soon_threadsafe(queue.put_nowait, {
                "type": "error", "message": str(exc),
            })
        except Exception as exc:
            log.exception("Streaming backtest failed")
            main_loop.call_soon_threadsafe(queue.put_nowait, {
                "type": "error", "message": f"Backtest failed: {exc}",
            })
        finally:
            thread_loop.close()

    main_loop.run_in_executor(_stream_executor, run_in_thread)

    async def event_stream():
        yield f"data: {json.dumps({'type': 'progress', 'phase': 'started', 'pct': 0.0})}\n\n"
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=300.0)
            except asyncio.TimeoutError:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Timeout after 5 min'})}\n\n"
                break
            yield f"data: {json.dumps(event)}\n\n"
            if event.get("type") in ("result", "error"):
                break

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Multi-pair comparison ──────────────────────────────────────────────────────

class CompareRequest(BaseModel):
    symbols: list[str]
    strategy: str
    start_date: str = "2019-01-01"
    end_date: Optional[str] = None
    interval: str = "1d"
    initial_capital: float = 10000
    commission_pct: float = 0.001
    slippage_pct: float = 0.0005
    position_size_pct: float = 1.0
    strategy_params: dict = {}


class CompareResult(BaseModel):
    symbol: str
    success: bool
    result: BacktestResult | None = None
    error: str | None = None


@router.post("/compare", response_model=list[CompareResult])
async def compare(req: CompareRequest):
    """Run the same strategy on multiple symbols in parallel. Returns one row per symbol."""
    if len(req.symbols) > 20:
        raise HTTPException(status_code=400, detail="Max 20 symbols per comparison")

    async def _one(sym: str) -> CompareResult:
        try:
            params = BacktestParams(
                symbol=sym, strategy=req.strategy,
                start_date=req.start_date, end_date=req.end_date,
                interval=req.interval, initial_capital=req.initial_capital,
                commission_pct=req.commission_pct, slippage_pct=req.slippage_pct,
                position_size_pct=req.position_size_pct,
                strategy_params=req.strategy_params,
            )
            r = await run_backtest(params)
            return CompareResult(symbol=sym, success=True, result=r)
        except Exception as e:
            return CompareResult(symbol=sym, success=False, error=str(e))

    return await asyncio.gather(*[_one(s) for s in req.symbols])


# ── Parameter optimization ─────────────────────────────────────────────────────

@router.post("/optimize", response_model=OptimizeResult)
async def optimize(req: OptimizeRequest):
    """Grid-search across parameter ranges to find the best strategy settings."""
    try:
        return await run_optimization(req)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.exception("Optimization failed")
        raise HTTPException(status_code=500, detail=str(e))


# ── Asset metadata ─────────────────────────────────────────────────────────────

@router.get("/metadata/{symbol}")
async def get_metadata(symbol: str):
    """Comprehensive metadata: market cap, ATH, P/E, fundamentals, sentiment indices."""
    try:
        return await metadata_loader.get(symbol)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Historical OHLCV (for charting) ────────────────────────────────────────────

@router.get("/data/{symbol}")
async def get_historical(
    symbol: str,
    start_date: str = Query("2014-01-01"),
    end_date: Optional[str] = Query(None),
    interval: str = Query("1d"),
):
    """Fetch historical OHLCV bars for a symbol — used for charting."""
    try:
        loader = HistoricalDataLoader()
        bars = await loader.load(symbol, start_date, end_date, interval)
        return {
            "symbol": symbol,
            "interval": interval,
            "count": len(bars),
            "bars": [
                {
                    "t": int(b.timestamp.timestamp()),
                    "o": round(b.open, 6),
                    "h": round(b.high, 6),
                    "l": round(b.low, 6),
                    "c": round(b.close, 6),
                    "v": b.volume,
                }
                for b in bars
            ],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Data fetch failed: {e}")


@router.post("/prefetch")
async def prefetch(
    categories: list[str] = Query(default=["crypto", "stocks", "etfs", "forex", "commodities"]),
    years_back: int = Query(10, ge=1, le=30),
):
    """Warm the local cache with N years of daily data for all symbols in the categories."""
    loader = HistoricalDataLoader()
    results = await loader.prefetch_universe(categories=categories, years_back=years_back)
    return {
        "fetched_at": datetime.utcnow().isoformat() + "Z",
        "total_symbols": len(results),
        "successful": sum(1 for n in results.values() if n > 50),
        "by_symbol": results,
    }


# ── History / sharing ──────────────────────────────────────────────────────────

@router.get("/history")
async def list_history(
    limit: int = Query(50, ge=1, le=500),
    symbol: Optional[str] = Query(None),
):
    """Recent backtest runs with summary metrics."""
    return {"runs": backtest_history.list(limit=limit, symbol=symbol)}


@router.get("/history/{run_id}", response_model=BacktestResult)
async def get_history_run(run_id: str):
    """Re-open a saved backtest result by id."""
    data = backtest_history.get(run_id)
    if not data:
        raise HTTPException(status_code=404, detail="Run not found")
    return data


@router.delete("/history/{run_id}")
async def delete_history_run(run_id: str):
    deleted = backtest_history.delete(run_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Run not found")
    return {"deleted": True, "id": run_id}


@router.get("/cache")
async def cache_status():
    """Show what historical OHLCV is cached locally."""
    rows = bar_storage.list_symbols()
    return {
        "total_series": len(rows),
        "total_bars": sum(r["bar_count"] for r in rows),
        "series": rows,
    }
