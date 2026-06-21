"""REST API for the historical backtesting engine."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from typing import Optional

import numpy as np
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from app.limiter import limiter

from app.backtest import HistoricalDataLoader
from app.backtest.cache import backtest_cache
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
@limiter.limit("20/minute")
async def run(request: Request, params: BacktestParams):
    """Execute a backtest. Returns full result with metrics, trades, equity curve."""
    # Build cache key from deterministic params
    _cache_fields = [
        "symbol", "strategy", "start_date", "end_date", "interval",
        "initial_capital", "commission_pct", "slippage_pct",
        "position_size_pct", "strategy_params", "spread_bps",
        "leverage", "enable_market_impact", "use_funding_rates",
    ]
    cache_key = {f: getattr(params, f, None) for f in _cache_fields}

    cached = backtest_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        # Run main strategy and buy-and-hold benchmark in parallel
        bh_params = BacktestParams(
            symbol=params.symbol,
            strategy="buy_and_hold",
            start_date=params.start_date,
            end_date=params.end_date,
            interval=params.interval,
            initial_capital=params.initial_capital,
            commission_pct=params.commission_pct,
            slippage_pct=params.slippage_pct,
            position_size_pct=1.0,
            strategy_params={},
            spread_bps=params.spread_bps,
            leverage=1.0,
            enable_market_impact=params.enable_market_impact,
            use_funding_rates=params.use_funding_rates,
        )

        if params.strategy == "buy_and_hold":
            result = await run_backtest(params)
        else:
            result, bh_result = await asyncio.gather(
                run_backtest(params),
                run_backtest(bh_params),
            )
            result.benchmark = bh_result

        backtest_cache.set(cache_key, result)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error("Backtest failed", extra={"path": "/run"}, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Backtest failed: {e}")


@router.post("/run/stream")
@limiter.limit("20/minute")
async def run_stream(request: Request, params: BacktestParams):
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
            log.error("Streaming backtest failed", extra={"path": "/run/stream"}, exc_info=True)
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


# ── Result cache management ───────────────────────────────────────────────────

@router.get("/result-cache/stats")
async def result_cache_stats():
    """Return LRU backtest result cache statistics."""
    return {
        "size": backtest_cache.size,
        "max_size": backtest_cache._max,
        "ttl_seconds": backtest_cache._ttl,
    }


@router.delete("/result-cache")
async def clear_result_cache():
    """Clear the LRU backtest result cache."""
    backtest_cache.invalidate()
    return {"cleared": True}


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


@router.post("/compare/stream")
async def compare_stream(req: CompareRequest):
    """
    Compare multiple symbols via SSE — emits one result event per symbol as it finishes.
    Events: {type:"start", total}
             {type:"result", symbol, success, result|error, completed, total}
             {type:"done"}
    """
    if len(req.symbols) > 20:
        raise HTTPException(status_code=400, detail="Max 20 symbols per comparison")

    queue: asyncio.Queue[dict] = asyncio.Queue()
    total = len(req.symbols)

    async def _one(sym: str) -> None:
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
            await queue.put({"type": "result", "symbol": sym, "success": True,
                             "result": r.model_dump(mode="json")})
        except Exception as exc:
            await queue.put({"type": "result", "symbol": sym, "success": False,
                             "error": str(exc)})

    tasks = [asyncio.create_task(_one(s)) for s in req.symbols]

    async def event_stream():
        yield f"data: {json.dumps({'type': 'start', 'total': total})}\n\n"
        completed = 0
        while completed < total:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=300.0)
            except asyncio.TimeoutError:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Timeout after 5 min'})}\n\n"
                break
            completed += 1
            event["completed"] = completed
            event["total"] = total
            yield f"data: {json.dumps(event)}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'total': total})}\n\n"
        await asyncio.gather(*tasks, return_exceptions=True)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Parameter optimization ─────────────────────────────────────────────────────

@router.post("/optimize", response_model=OptimizeResult)
@limiter.limit("5/minute")
async def optimize(request: Request, req: OptimizeRequest):
    """Grid-search across parameter ranges to find the best strategy settings."""
    try:
        return await run_optimization(req)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error("Optimization failed", extra={"path": "/optimize"}, exc_info=True)
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
    force_refresh: bool = Query(False),
):
    """Fetch historical OHLCV bars for a symbol — used for charting."""
    try:
        loader = HistoricalDataLoader()
        bars = await loader.load(symbol, start_date, end_date, interval, force_refresh=force_refresh)
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


@router.delete("/cache/{symbol}")
async def clear_cached_symbol(symbol: str, interval: Optional[str] = Query(None)):
    """Remove cached bars for a symbol (forces re-fetch next time)."""
    bar_storage.delete_bars(symbol, interval)
    return {"cleared": True, "symbol": symbol, "interval": interval}


# ── Demo-data seed ─────────────────────────────────────────────────────────────

# Per-symbol GBM parameters: (start_price, annual_vol, annual_drift, base_volume)
# Volatility is deliberately conservative (≈ historical realized vol) so GBM
# paths don't collapse over 2-year windows with unlucky seeds.
_SYMBOL_PARAMS: dict[str, tuple[float, float, float, float]] = {
    "BTCUSDT": (42_000.0, 0.55, 0.30, 28_000.0),
    "ETHUSDT": ( 2_200.0, 0.65, 0.28, 150_000.0),
    "SOLUSDT": (    95.0, 0.75, 0.25, 2_000_000.0),
    "BNBUSDT": (   310.0, 0.50, 0.22, 500_000.0),
}
_DEFAULT_PARAMS = (100.0, 0.55, 0.20, 100_000.0)

# Bar duration in days for each interval label
_INTERVAL_DT_DAYS: dict[str, float] = {
    "1d": 1.0,
    "4h": 1.0 / 6.0,
    "1h": 1.0 / 24.0,
    "15m": 1.0 / 96.0,
    "5m":  1.0 / 288.0,
    "1m":  1.0 / 1440.0,
}

# How many seconds a bar represents (for timestamps)
_INTERVAL_SECS: dict[str, int] = {
    "1d": 86_400,
    "4h": 14_400,
    "1h": 3_600,
    "15m": 900,
    "5m":  300,
    "1m":  60,
}


class SeedDemoRequest(BaseModel):
    symbols: list[str] = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]
    intervals: list[str] = ["1d", "4h", "1h"]
    # Generate bars covering the last N days ending at now, so the default
    # UI date-range (today − periodDays) always lands inside the seeded window.
    days: int = 730
    clear_existing: bool = True


def _generate_gbm_bars(symbol: str, interval: str, days: int) -> list:
    """Generate synthetic OHLCV bars using Geometric Brownian Motion.

    Anchor: bars end at *now* and extend `days` backward, so the seeded
    data always covers the most-recent date-range the UI requests.

    Uses standard GBM discretization:
      price[t+1] = price[t] * exp((drift - vol²/2)*dt + vol*sqrt(dt)*Z)
    where drift and vol are annualised rates and dt is the bar duration in years.
    A price floor of 15 % of start_price prevents degenerate near-zero paths.
    """
    from app.backtest.models import Bar

    start_price, vol, drift, base_vol = _SYMBOL_PARAMS.get(symbol, _DEFAULT_PARAMS)
    dt_days = _INTERVAL_DT_DAYS.get(interval, 1.0)
    dt = dt_days / 365.0
    bar_secs = _INTERVAL_SECS.get(interval, 86_400)
    n_bars = int(days / dt_days)

    # Deterministic seed per (symbol, interval) via hashlib so the same data
    # is produced across Python processes regardless of PYTHONHASHSEED.
    seed = int(hashlib.md5(f"{symbol}_{interval}".encode()).hexdigest()[:8], 16) % 999_983
    rng = np.random.default_rng(seed)

    noise = rng.standard_normal(n_bars)
    log_returns = (drift - 0.5 * vol ** 2) * dt + vol * np.sqrt(dt) * noise
    price_path = np.empty(n_bars + 1)
    price_path[0] = start_price
    np.cumprod(np.exp(log_returns), out=price_path[1:])
    price_path[1:] *= start_price

    # Enforce a floor so no bar ever drops below 15 % of the opening price.
    floor = start_price * 0.15
    np.maximum(price_path, floor, out=price_path)

    wick_noise = np.abs(rng.normal(0.0, 0.008, n_bars))
    vol_noise  = np.abs(rng.normal(0.0, 0.6,   n_bars))

    # Anchor at (now − days) so bars end at approximately today.
    anchor = datetime.now(timezone.utc) - timedelta(days=days)
    anchor_ts = int(anchor.timestamp())

    bars = []
    for i in range(n_bars):
        open_price  = float(price_path[i])
        close_price = float(price_path[i + 1])
        if open_price <= 0 or close_price <= 0:
            continue
        high   = max(open_price, close_price) * (1.0 + wick_noise[i])
        low    = min(open_price, close_price) * (1.0 - wick_noise[i])
        volume = base_vol * (0.5 + vol_noise[i])
        ts = anchor_ts + int(i * bar_secs)
        bars.append(Bar(
            timestamp=datetime.fromtimestamp(ts, tz=timezone.utc).replace(tzinfo=None),
            open=round(open_price,  8),
            high=round(high,        8),
            low=round(low,          8),
            close=round(close_price, 8),
            volume=round(volume, 2),
        ))
    return bars


@router.post("/seed-demo")
async def seed_demo(req: SeedDemoRequest):
    """Seed the DuckDB bar cache with synthetic GBM data for demo/testing.

    By default clears *all* existing bars for the requested symbols first so
    stale data from previous sessions never pollutes the new seed.
    """
    if req.clear_existing:
        for symbol in req.symbols:
            await asyncio.to_thread(bar_storage.delete_bars, symbol)

    seeded = []
    total_bars = 0
    for symbol in req.symbols:
        for interval in req.intervals:
            bars = await asyncio.to_thread(
                _generate_gbm_bars, symbol, interval, req.days
            )
            count = await asyncio.to_thread(
                bar_storage.upsert_bars, symbol, interval, bars
            )
            seeded.append({"symbol": symbol, "interval": interval, "bar_count": count})
            total_bars += count
    return {"seeded": seeded, "total_bars": total_bars}


# ── Parquet export ─────────────────────────────────────────────────────────────

@router.post("/export-parquet")
async def export_parquet():
    """Export all cached bars to a Parquet file and stream it back."""
    import tempfile
    out_dir = tempfile.mkdtemp()
    path = await asyncio.to_thread(bar_storage.export_parquet, out_dir)
    return FileResponse(path, filename="bars.parquet", media_type="application/octet-stream")


# ── Anomaly scanning ───────────────────────────────────────────────────────────

class AnomalyRequest(BaseModel):
    symbol: str
    start_date: str = "2024-01-01"
    end_date: Optional[str] = None
    interval: str = "1d"
    config: dict = {}


@router.post("/anomalies")
async def scan_anomalies(req: AnomalyRequest):
    """Scan a symbol's price history for market anomalies."""
    loader = HistoricalDataLoader()
    bars = await loader.load(req.symbol, req.start_date, req.end_date, req.interval)
    if len(bars) < 20:
        raise HTTPException(status_code=400, detail=f"Need at least 20 bars, got {len(bars)}")
    from app.backtest.anomalies import AnomalyDetector, AnomalyConfig
    cfg_data = {k: v for k, v in req.config.items() if not k.startswith("_")}
    try:
        cfg = AnomalyConfig(**cfg_data) if cfg_data else AnomalyConfig()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid config: {e}")
    anomalies = AnomalyDetector().scan(bars, cfg)
    return {
        "symbol": req.symbol,
        "interval": req.interval,
        "bars_scanned": len(bars),
        "count": len(anomalies),
        "anomalies": [
            {
                "timestamp": a.timestamp,
                "type": a.type,
                "severity": a.severity,
                "price": a.price,
                "description": a.description,
                "suggested_action": a.suggested_action,
            }
            for a in anomalies
        ],
    }


# ── Alt datasets ───────────────────────────────────────────────────────────────

@router.get("/datasets")
async def list_datasets():
    """Return a list of all alternative datasets cached locally (FRED, F&G, OI, funding)."""
    from app.backtest.datasources import data_registry
    return {"datasets": data_registry.list_available()}


class FearGreedRequest(BaseModel):
    days_back: int = 365


@router.post("/datasets/fear-greed")
async def get_fear_greed(req: FearGreedRequest):
    """Fetch / return cached Fear & Greed index data."""
    from app.backtest.datasources import fetch_fear_greed
    data = await fetch_fear_greed(req.days_back)
    return {"count": len(data), "data": data}


class FredRequest(BaseModel):
    series_id: str
    start_date: str = "2015-01-01"
    end_date: Optional[str] = None


@router.post("/datasets/fred")
async def get_fred(req: FredRequest):
    """Fetch / return cached FRED macro series data."""
    from app.backtest.datasources import fetch_fred_series
    data = await fetch_fred_series(req.series_id, req.start_date, req.end_date)
    return {"series_id": req.series_id, "count": len(data), "data": data}


class FundingRequest(BaseModel):
    symbol: str = "BTCUSDT"
    start_ts: Optional[int] = None
    end_ts: Optional[int] = None


@router.post("/datasets/funding")
async def get_funding(req: FundingRequest):
    """Fetch / return cached Binance perpetual funding rates."""
    from app.backtest.datasources import fetch_funding_rates
    data = await fetch_funding_rates(req.symbol, req.start_ts, req.end_ts)
    return {"symbol": req.symbol, "count": len(data), "data": data}


class OIRequest(BaseModel):
    symbol: str = "BTCUSDT"
    interval: str = "1h"
    start_ts: Optional[int] = None
    end_ts: Optional[int] = None


@router.post("/datasets/open-interest")
async def get_open_interest(req: OIRequest):
    """Fetch / return cached Binance futures open interest history."""
    from app.backtest.datasources import fetch_open_interest
    data = await fetch_open_interest(req.symbol, req.interval, req.start_ts, req.end_ts)
    return {"symbol": req.symbol, "interval": req.interval, "count": len(data), "data": data}


# ── Cross-asset correlations ───────────────────────────────────────────────────

class CorrelationRequest(BaseModel):
    symbols: list[str]
    start_date: str = "2023-01-01"
    end_date: Optional[str] = None
    interval: str = "1d"


def _pearson(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    if n < 3:
        return 0.0
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = (sum((x - mx) ** 2 for x in xs)) ** 0.5
    dy = (sum((y - my) ** 2 for y in ys)) ** 0.5
    return num / (dx * dy) if dx * dy > 0 else 0.0


@router.post("/correlations")
async def compute_correlations(req: CorrelationRequest):
    """Compute pairwise return correlations for a list of symbols."""
    if len(req.symbols) > 10:
        raise HTTPException(status_code=400, detail="Max 10 symbols")
    if len(req.symbols) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 symbols")

    loader = HistoricalDataLoader()
    results = await asyncio.gather(
        *[loader.load(s, req.start_date, req.end_date, req.interval) for s in req.symbols],
        return_exceptions=True,
    )

    # Build aligned close price series
    series: dict[str, dict[int, float]] = {}
    for sym, bars in zip(req.symbols, results):
        if isinstance(bars, Exception) or not bars:
            continue
        series[sym] = {b.ts: b.close for b in bars}

    valid_syms = list(series.keys())
    if len(valid_syms) < 2:
        raise HTTPException(status_code=400, detail="Could not load data for enough symbols")

    # Common timestamps
    common_ts = sorted(
        set.intersection(*[set(series[s].keys()) for s in valid_syms])
    )
    if len(common_ts) < 5:
        raise HTTPException(status_code=400, detail="Not enough overlapping bars")

    def _returns(sym: str) -> list[float]:
        closes = [series[sym][ts] for ts in common_ts]
        return [(closes[i] - closes[i - 1]) / closes[i - 1] for i in range(1, len(closes))]

    ret_map = {s: _returns(s) for s in valid_syms}
    n = len(valid_syms)
    matrix = [[0.0] * n for _ in range(n)]
    for i, s1 in enumerate(valid_syms):
        for j, s2 in enumerate(valid_syms):
            if i == j:
                matrix[i][j] = 1.0
            elif j > i:
                r = _pearson(ret_map[s1], ret_map[s2])
                matrix[i][j] = matrix[j][i] = round(r, 4)

    heatmap = [
        {"x": valid_syms[i], "y": valid_syms[j], "value": matrix[i][j]}
        for i in range(n) for j in range(n)
    ]
    return {"symbols": valid_syms, "matrix": matrix, "heatmap_data": heatmap, "bar_count": len(common_ts)}


# ── Live signals ───────────────────────────────────────────────────────────────

def _iso_days_ago(days: int) -> str:
    from datetime import timezone, timedelta
    return (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()


@router.get("/signals/live")
async def live_signals(
    symbol: str = Query("BTC-USD"),
    interval: str = Query("1d"),
    bars: int = Query(200, ge=20, le=1000),
    # legacy plural alias kept for backwards compat
    symbols: str | None = Query(None),
):
    """Run all strategies on recent bars and return current signal from each."""
    # Support both ?symbol= (new) and ?symbols= (old) param
    sym = symbol
    if symbols:
        sym = symbols.split(",")[0].strip()

    loader = HistoricalDataLoader()
    from app.backtest.strategies import STRATEGIES
    from app.backtest.strategies.base import StrategyContext

    try:
        bar_data = await loader.load(sym, _iso_days_ago(400), None, interval)
        bar_data = bar_data[-bars:] if len(bar_data) >= bars else bar_data
    except Exception as exc:
        bar_data = []

    now_iso = datetime.utcnow().isoformat() + "Z"
    result_signals = []

    if len(bar_data) >= 20:
        last = bar_data[-1]
        close = last.close
        # Simple ATR for TP/SL estimation (20-bar avg true range)
        atr_vals = [abs(b.high - b.low) for b in bar_data[-20:]]
        atr = sum(atr_vals) / len(atr_vals) if atr_vals else close * 0.01

        for strat_name, strat_cls in STRATEGIES.items():
            if strat_name == "buy_and_hold":
                continue
            try:
                strat = strat_cls()
                ctx = StrategyContext(history=bar_data, position=None)
                sig = strat.on_bar(ctx)
                entry_price = round(close, 4) if sig in ("buy", "sell", "short") else None
                if sig in ("buy",):
                    tp = round(close + 2 * atr, 4)
                    sl = round(close - atr, 4)
                elif sig in ("sell", "short"):
                    tp = round(close - 2 * atr, 4)
                    sl = round(close + atr, 4)
                else:
                    tp = sl = None
                result_signals.append({
                    "strategy": strat_name,
                    "symbol": sym,
                    "signal": sig,
                    "confidence": 0.0,
                    "entry_price": entry_price,
                    "tp_price": tp,
                    "sl_price": sl,
                    "timestamp": now_iso,
                    "bar_count": len(bar_data),
                    "error": None,
                })
            except Exception as exc:
                result_signals.append({
                    "strategy": strat_name,
                    "symbol": sym,
                    "signal": "hold",
                    "confidence": 0.0,
                    "entry_price": None,
                    "tp_price": None,
                    "sl_price": None,
                    "timestamp": now_iso,
                    "bar_count": len(bar_data),
                    "error": str(exc),
                })
    else:
        # Not enough data — return error for all strategies
        from app.backtest.strategies import STRATEGIES
        for strat_name in STRATEGIES:
            if strat_name == "buy_and_hold":
                continue
            result_signals.append({
                "strategy": strat_name,
                "symbol": sym,
                "signal": "hold",
                "confidence": 0.0,
                "entry_price": None,
                "tp_price": None,
                "sl_price": None,
                "timestamp": now_iso,
                "bar_count": len(bar_data),
                "error": "Insufficient data",
            })

    return {
        "signals": result_signals,
        "symbol": sym,
        "interval": interval,
        "timestamp": now_iso,
    }


# ── Multi-symbol signal scanner ────────────────────────────────────────────────

@router.get("/signals/scan")
async def scan_symbol_signals(
    strategy: str = Query("rsi"),
    interval: str = Query("1d"),
    symbols: str = Query("BTC-USD,ETH-USD,SOL-USD,BNB-USD,MATIC-USD,ADA-USD,AVAX-USD,DOT-USD"),
    bars: int = Query(200, ge=20, le=1000),
):
    """Run one strategy across multiple symbols in parallel, return a signal grid."""
    if strategy not in STRATEGIES:
        raise HTTPException(status_code=400, detail=f"Unknown strategy: {strategy}")

    sym_list = [s.strip() for s in symbols.split(",") if s.strip()][:20]
    loader = HistoricalDataLoader()
    from app.backtest.strategies.base import StrategyContext

    async def _scan_one(sym: str) -> dict:
        try:
            bar_data = await loader.load(sym, _iso_days_ago(400), None, interval)
            bar_data = bar_data[-bars:] if len(bar_data) >= bars else bar_data
            if len(bar_data) < 20:
                return {"symbol": sym, "signal": "hold", "confidence": 0.0, "entry_price": None,
                        "tp_price": None, "sl_price": None, "bar_count": len(bar_data), "error": "Insufficient data"}

            last = bar_data[-1]
            close = last.close
            atr_vals = [abs(b.high - b.low) for b in bar_data[-20:]]
            atr = sum(atr_vals) / len(atr_vals) if atr_vals else close * 0.01

            strat = STRATEGIES[strategy]()
            ctx = StrategyContext(history=bar_data, position=None)
            sig = strat.on_bar(ctx)
            entry_price = round(close, 4) if sig in ("buy", "sell", "short") else None
            tp = round(close + 2 * atr, 4) if sig == "buy" else round(close - 2 * atr, 4) if sig in ("sell", "short") else None
            sl = round(close - atr, 4) if sig == "buy" else round(close + atr, 4) if sig in ("sell", "short") else None

            # Price change metrics
            ret_5 = (bar_data[-1].close - bar_data[-5].close) / bar_data[-5].close * 100 if len(bar_data) >= 5 else 0.0
            ret_20 = (bar_data[-1].close - bar_data[-20].close) / bar_data[-20].close * 100 if len(bar_data) >= 20 else 0.0
            vol = float(bar_data[-1].volume) if bar_data[-1].volume else 0.0

            return {
                "symbol": sym, "signal": sig, "confidence": 0.0,
                "entry_price": entry_price, "tp_price": tp, "sl_price": sl,
                "bar_count": len(bar_data), "error": None,
                "close": round(close, 4),
                "ret_5d": round(ret_5, 2),
                "ret_20d": round(ret_20, 2),
                "volume": vol,
            }
        except Exception as e:
            return {"symbol": sym, "signal": "hold", "confidence": 0.0,
                    "entry_price": None, "tp_price": None, "sl_price": None,
                    "bar_count": 0, "error": str(e), "close": None, "ret_5d": 0.0, "ret_20d": 0.0, "volume": 0.0}

    results = await asyncio.gather(*[_scan_one(s) for s in sym_list])
    now_iso = datetime.utcnow().isoformat() + "Z"
    return {"strategy": strategy, "interval": interval, "timestamp": now_iso, "results": list(results)}


# ── Signal validation ──────────────────────────────────────────────────────────

class ValidateSignalRequest(BaseModel):
    symbol: str
    strategy: str
    strategy_params: dict = {}
    direction: str = "buy"
    interval: str = "1d"
    lookback_days: int = 90


@router.post("/signals/validate")
async def validate_signal(req: ValidateSignalRequest):
    """Mini-backtest on recent history to compute win rate + EV for a strategy setup."""
    params = BacktestParams(
        symbol=req.symbol,
        strategy=req.strategy,
        start_date=_iso_days_ago(req.lookback_days),
        strategy_params=req.strategy_params,
        initial_capital=10_000,
        commission_pct=0.001,
        slippage_pct=0.0005,
        position_size_pct=1.0,
    )
    try:
        result = await run_backtest(params)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    m = result.metrics
    trades = result.trades
    wins = [t for t in trades if t.pnl > 0]
    losses = [t for t in trades if t.pnl <= 0]
    avg_win = sum(t.pnl_pct for t in wins) / len(wins) if wins else 0.0
    avg_loss = sum(t.pnl_pct for t in losses) / len(losses) if losses else 0.0
    gross_profit = sum(t.pnl for t in wins)
    gross_loss = abs(sum(t.pnl for t in losses))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else (float("inf") if gross_profit > 0 else 0.0)
    best_pct = max((t.pnl_pct for t in trades), default=0.0)
    worst_pct = min((t.pnl_pct for t in trades), default=0.0)
    return {
        "strategy": req.strategy,
        "symbol": req.symbol,
        "direction": req.direction,
        "lookback_days": req.lookback_days,
        "total_signals": m.total_trades,
        "win_rate": round(m.win_rate_pct / 100, 4),
        "avg_gain_pct": round(avg_win, 2),
        "avg_loss_pct": round(avg_loss, 2),
        "expected_value_pct": round(m.avg_trade_pnl_pct, 2),
        "profit_factor": round(profit_factor, 2),
        "best_pct": round(best_pct, 2),
        "worst_pct": round(worst_pct, 2),
    }


# ── Data warehouse: quality, cross-validation, live ingestion ───────────────────

@router.get("/data/quality")
async def data_quality(
    symbol: str = Query(...),
    interval: str = Query("1d"),
):
    """Run integrity checks on cached bars: gaps, spikes, OHLC violations,
    completeness and an overall 0–100 quality score."""
    from app.backtest.quality import assess
    return assess(symbol, interval).to_dict()


@router.get("/data/quality/overview")
async def data_quality_overview():
    """Quality score for every cached (symbol, interval) in the warehouse."""
    from app.backtest.quality import assess
    rows = []
    for entry in bar_storage.list_symbols():
        try:
            rep = assess(entry["symbol"], entry["interval"])
            rows.append({
                "symbol": rep.symbol,
                "interval": rep.interval,
                "bar_count": rep.bar_count,
                "completeness_pct": rep.completeness_pct,
                "quality_score": rep.quality_score,
                "gap_count": rep.gap_count,
                "spike_count": rep.spike_count,
                "ohlc_violation_count": rep.ohlc_violation_count,
                "earliest_iso": rep.earliest_iso,
                "latest_iso": rep.latest_iso,
            })
        except Exception as e:
            log.warning("quality overview failed for %s/%s: %s", entry["symbol"], entry["interval"], e)
    rows.sort(key=lambda r: r["quality_score"])
    return {"count": len(rows), "datasets": rows}


class CrossValidateRequest(BaseModel):
    symbol: str
    interval: str = "1d"
    limit: int = 200
    tolerance_pct: float = 0.1


@router.post("/data/cross-validate")
async def data_cross_validate(req: CrossValidateRequest):
    """Compare the same symbol across Binance, Bybit and Kraken bar-by-bar to
    establish which source(s) to trust."""
    from app.backtest.cross_validate import cross_validate
    report = await cross_validate(req.symbol, req.interval, req.limit, req.tolerance_pct)
    return report.to_dict()


@router.get("/data/ingest/status")
async def ingest_status():
    """Live ingester status: which streams are running and how fresh they are."""
    from app.backtest.ingester import live_ingester
    return live_ingester.status()


class IngestControlRequest(BaseModel):
    symbol: str
    interval: str = "1m"
    enabled: bool = True


@router.post("/data/ingest/control")
async def ingest_control(req: IngestControlRequest):
    """Add a live stream or toggle an existing one on/off."""
    from app.backtest.ingester import live_ingester
    existing = live_ingester.set_enabled(req.symbol, req.interval, req.enabled)
    if not existing:
        added = await live_ingester.add_stream(req.symbol, req.interval)
        if not added:
            raise HTTPException(status_code=400, detail=f"{req.symbol} is not a supported live symbol")
    return live_ingester.status()


# ── Monte Carlo simulation ─────────────────────────────────────────────────────

class MonteCarloRequest(BaseModel):
    trades: list[dict]
    initial_capital: float
    n_simulations: int = 1000


@router.post("/monte_carlo")
async def monte_carlo(req: MonteCarloRequest):
    """Run Monte Carlo simulation: randomize trade order N times to show outcome distribution."""
    from dataclasses import asdict
    from app.backtest.monte_carlo import run_monte_carlo

    n_sims = min(req.n_simulations, 5000)
    if req.initial_capital <= 0:
        raise HTTPException(status_code=400, detail="initial_capital must be > 0")

    # Validate that trades have a 'pnl' field
    for i, t in enumerate(req.trades):
        if "pnl" not in t:
            raise HTTPException(status_code=400, detail=f"Trade at index {i} missing 'pnl' field")

    try:
        result = await asyncio.to_thread(
            run_monte_carlo,
            req.trades,
            req.initial_capital,
            n_sims,
        )
        return asdict(result)
    except Exception as e:
        log.error("Monte Carlo failed", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Simulation failed: {e}")


# ── Live Forward Test ──────────────────────────────────────────────────────────

# Default prices when no cached bar is found for a symbol
_FT_DEFAULT_PRICES: dict[str, float] = {
    "BTCUSDT": 42000.0,
    "ETHUSDT": 2200.0,
    "SOLUSDT": 95.0,
    "BNBUSDT": 310.0,
}
_FT_DEFAULT_PRICE = 100.0

# Forward-test GBM parameters per interval
_FT_ANNUAL_VOL: dict[str, float] = {"1d": 0.55, "4h": 0.55, "1h": 0.55}
_FT_BARS_PER_YEAR: dict[str, int] = {"1d": 365, "4h": 365 * 6, "1h": 365 * 24}
_FT_BAR_SECS: dict[str, int] = {"1d": 86_400, "4h": 14_400, "1h": 3_600}


def _next_gbm_bar(last_price: float, interval: str, last_ts: int) -> dict:
    """Generate one synthetic GBM bar anchored to last_price using GBM."""
    import math as _math
    annual_vol = _FT_ANNUAL_VOL.get(interval, 0.55)
    n_bars = _FT_BARS_PER_YEAR.get(interval, 365)
    bar_secs = _FT_BAR_SECS.get(interval, 86_400)
    dt = 1.0 / n_bars
    vol = annual_vol * _math.sqrt(dt)
    drift = 0.0001
    ret = (drift - vol ** 2 / 2) * dt + vol * np.random.randn()
    close = max(last_price * _math.exp(ret), last_price * 0.01)
    high = close * (1 + abs(np.random.normal(0, 0.003)))
    low = close * (1 - abs(np.random.normal(0, 0.003)))
    low = min(low, close)
    high = max(high, close)
    return {
        "open": last_price,
        "high": round(high, 8),
        "low": round(low, 8),
        "close": round(close, 8),
        "volume": 1000.0,
        "ts": last_ts + bar_secs,
    }


@router.get("/forward_test_stream")
async def forward_test_stream(
    symbol: str = "BTCUSDT",
    strategy: str = "rsi",
    interval: str = "1d",
    initial_capital: float = 10000.0,
    commission_pct: float = 0.001,
    slippage_pct: float = 0.0005,
    position_size_pct: float = 0.25,
    speed: int = 1,
    params_json: str = "{}",
):
    """
    Live Forward Test: streams synthetic GBM bars one-by-one via SSE, running
    the chosen strategy bar-by-bar and emitting equity updates in real time.

    Events:
      {type:"bar", bar_num, timestamp, close, signal, equity, position, total_return_pct}
      {type:"done"}
    """
    if strategy not in STRATEGIES:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=400,
            content={"detail": f"Unknown strategy '{strategy}'"},
        )

    try:
        strategy_params = json.loads(params_json)
    except Exception:
        strategy_params = {}

    # ── 1. Find last known price from storage for warmup ───────────────────
    meta = bar_storage.get_meta(symbol, interval)
    last_price: float = _FT_DEFAULT_PRICES.get(symbol, _FT_DEFAULT_PRICE)
    warmup_bars: list = []
    now_ts = int(datetime.now(timezone.utc).timestamp())
    current_ts = now_ts

    if meta and meta.get("latest_ts"):
        latest_ts = int(meta["latest_ts"])
        bar_secs = _FT_BAR_SECS.get(interval, 86_400)
        # Pull up to 250 warmup bars so indicators have enough history
        start_ts = latest_ts - 250 * bar_secs
        warmup_bars = bar_storage.get_bars(symbol, interval, start_ts, latest_ts)
        if warmup_bars:
            last_price = warmup_bars[-1].close
            current_ts = warmup_bars[-1].ts

    # ── 2. Instantiate strategy and warm up with historical bars ───────────
    strategy_cls = STRATEGIES[strategy]
    strat = strategy_cls(**strategy_params)
    if warmup_bars:
        strat.prepare(warmup_bars)

    # ── 3. Set up position/equity tracker ─────────────────────────────────
    from app.backtest.models import Bar as BacktestBar, Position
    from datetime import datetime as _dt
    from app.backtest.strategies.base import StrategyContext

    MAX_BARS = 500
    speed_clamped = max(1, min(speed, 50))

    cash = initial_capital
    position: "Optional[Position]" = None
    bar_history = list(warmup_bars)

    def _mark_equity(close: float) -> float:
        if position is None:
            return cash
        if position.side == "long":
            return cash + position.size * close
        pnl = (position.entry_price - close) * position.size
        return cash + position.cost + pnl

    def _enter(close: float, bar: "BacktestBar") -> None:
        nonlocal cash, position
        if position is not None or cash <= 0:
            return
        allocation = cash * position_size_pct
        fill = close * (1 + slippage_pct)
        if fill <= 0:
            return
        units = allocation / (fill * (1 + commission_pct))
        cost = units * fill
        fee = cost * commission_pct
        total = cost + fee
        if total > cash:
            units = cash / (fill * (1 + commission_pct))
            cost = units * fill
            fee = cost * commission_pct
            total = cost + fee
        if units <= 0:
            return
        cash -= total
        position = Position(
            symbol=symbol, side="long",
            entry_price=fill, entry_time=bar.timestamp,
            size=units, cost=total,
        )

    def _exit(close: float) -> None:
        nonlocal cash, position
        if position is None:
            return
        fill = close * (1 - slippage_pct)
        gross = position.size * fill
        fee = gross * commission_pct
        cash += gross - fee
        position = None

    # ── 4. SSE event generator ─────────────────────────────────────────────
    async def event_gen():
        nonlocal cash, position, bar_history, current_ts, last_price

        for bar_num in range(1, MAX_BARS + 1):
            await asyncio.sleep(1.0 / speed_clamped)

            # Generate next synthetic bar via GBM
            gbm = _next_gbm_bar(last_price, interval, current_ts)
            current_ts = gbm["ts"]
            last_price = gbm["close"]

            new_bar = BacktestBar(
                timestamp=_dt.fromtimestamp(current_ts),
                open=gbm["open"],
                high=gbm["high"],
                low=gbm["low"],
                close=gbm["close"],
                volume=gbm["volume"],
            )
            bar_history.append(new_bar)

            # Rolling window of at most 500 bars passed to strategy
            history_window = bar_history[-500:]

            # Run strategy signal
            ctx = StrategyContext(history=history_window, position=position)
            signal = strat.on_bar(ctx)

            # Execute fills at bar close price
            if signal == "buy" and position is None:
                _enter(gbm["close"], new_bar)
            elif signal in ("sell", "close") and position is not None:
                _exit(gbm["close"])

            equity = _mark_equity(gbm["close"])
            total_return_pct = (equity - initial_capital) / initial_capital * 100

            pos_dict = None
            if position is not None:
                pnl_usd = (gbm["close"] - position.entry_price) * position.size
                pnl_pct = pnl_usd / position.cost * 100 if position.cost > 0 else 0.0
                pos_dict = {
                    "entry_price": round(position.entry_price, 6),
                    "size": round(position.size, 8),
                    "pnl": round(pnl_usd, 2),
                    "pnl_pct": round(pnl_pct, 2),
                }

            event_dict = {
                "type": "bar",
                "bar_num": bar_num,
                "timestamp": current_ts,
                "close": round(gbm["close"], 6),
                "signal": signal,
                "equity": round(equity, 2),
                "position": pos_dict,
                "total_return_pct": round(total_return_pct, 4),
            }
            yield f"data: {json.dumps(event_dict)}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── yfinance real data fetch ────────────────────────────────────────────────────

class FetchRealDataRequest(BaseModel):
    symbol: str
    interval: str = "1d"
    days: int = 730  # how many days of history to fetch


@router.post("/data/fetch_real")
async def fetch_real_data(req: FetchRealDataRequest):
    """Fetch real OHLCV bars from yfinance and cache them in the bar storage."""
    from app.backtest.yfinance_loader import fetch_bars
    from app.backtest.models import Bar as _Bar
    from datetime import datetime as _dt

    if req.days < 1 or req.days > 3650:
        raise HTTPException(400, "days must be 1\u20133650")

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=req.days)
    start_str = start.strftime("%Y-%m-%d")
    end_str = end.strftime("%Y-%m-%d")

    bars_raw = await asyncio.to_thread(fetch_bars, req.symbol, req.interval, start_str, end_str)
    if not bars_raw:
        raise HTTPException(404, f"No data found for {req.symbol}. Check the symbol is supported by yfinance.")

    # Convert to Bar objects and upsert into storage
    bar_objs = [
        _Bar(
            timestamp=_dt.fromtimestamp(b["timestamp"], tz=timezone.utc),
            open=b["open"], high=b["high"], low=b["low"],
            close=b["close"], volume=b["volume"],
        )
        for b in bars_raw
    ]

    count = await asyncio.to_thread(bar_storage.upsert_bars, req.symbol, req.interval, bar_objs)
    return {
        "symbol": req.symbol,
        "interval": req.interval,
        "bars_fetched": len(bars_raw),
        "bars_stored": count,
        "start": start_str,
        "end": end_str,
        "source": "yfinance",
    }


@router.get("/data/yfinance_symbols")
async def yfinance_symbols():
    """List all symbols fetchable via yfinance."""
    from app.backtest.yfinance_loader import supported_symbols
    return supported_symbols()


# ── Portfolio multi-strategy backtesting ──────────────────────────────────────

class PortfolioAllocation(BaseModel):
    strategy: str
    allocation_pct: float  # 0-100, sum across all must = 100


class PortfolioRunRequest(BaseModel):
    symbol: str = "BTCUSDT"
    allocations: list[PortfolioAllocation]
    start_date: str
    end_date: Optional[str] = None
    interval: str = "1d"
    initial_capital: float = 10000.0
    commission_pct: float = 0.001
    slippage_pct: float = 0.0005
    rebalance: bool = False  # future feature, always False for now


class PortfolioStrategyResult(BaseModel):
    strategy: str
    allocation_pct: float
    allocated_capital: float
    metrics: dict
    equity_curve: list[dict]  # {t, equity}


class PortfolioResult(BaseModel):
    symbol: str
    strategies: list[PortfolioStrategyResult]
    combined_equity_curve: list[dict]   # {t, equity}
    combined_metrics: dict              # computed from combined equity curve
    correlation_matrix: dict            # {strategy1: {strategy2: corr_coeff}}
    diversification_benefit: float      # (weighted_avg_volatility - portfolio_volatility) / weighted_avg_volatility


def _compute_combined_metrics(
    initial_capital: float,
    equity_curve: list[dict],
    interval: str,
) -> dict:
    """Compute key performance metrics directly from a combined equity curve."""
    import math as _math

    if not equity_curve:
        return {
            "total_return_pct": 0.0,
            "sharpe_ratio": 0.0,
            "max_drawdown_pct": 0.0,
            "final_equity": initial_capital,
            "initial_capital": initial_capital,
        }

    equity_values = [pt["equity"] for pt in equity_curve]
    final_equity = equity_values[-1]
    total_return_pct = (final_equity - initial_capital) / initial_capital * 100

    # Returns
    returns = []
    for i in range(1, len(equity_values)):
        prev = equity_values[i - 1]
        if prev > 0:
            returns.append((equity_values[i] - prev) / prev)

    # Sharpe — annualise using approximate trading periods per year
    ann_factor = 365.0 if interval in ("1d", "4h", "1h", "1m", "5m", "15m", "30m") else 52.0
    sharpe = 0.0
    if len(returns) >= 2:
        mean_r = sum(returns) / len(returns)
        var_r = sum((r - mean_r) ** 2 for r in returns) / (len(returns) - 1)
        std_r = _math.sqrt(var_r)
        if std_r > 0:
            sharpe = round((mean_r / std_r) * _math.sqrt(ann_factor), 4)

    # Max drawdown
    peak = equity_values[0]
    max_dd = 0.0
    for v in equity_values:
        if v > peak:
            peak = v
        dd = (peak - v) / peak if peak > 0 else 0.0
        if dd > max_dd:
            max_dd = dd

    return {
        "total_return_pct": round(total_return_pct, 4),
        "sharpe_ratio": round(sharpe, 4),
        "max_drawdown_pct": round(max_dd * 100, 4),
        "final_equity": round(final_equity, 2),
        "initial_capital": round(initial_capital, 2),
    }


def _portfolio_correlation_matrix(
    strategy_curves: list[tuple[str, list[dict]]],
) -> dict:
    """Compute Pearson correlation matrix between strategy equity return series."""
    curve_maps: list[tuple[str, dict[int, float]]] = []
    for name, curve in strategy_curves:
        m: dict[int, float] = {pt["t"]: pt["equity"] for pt in curve}
        curve_maps.append((name, m))

    if len(curve_maps) < 2:
        if len(curve_maps) == 1:
            name = curve_maps[0][0]
            return {name: {name: 1.0}}
        return {}

    common_ts = sorted(
        set.intersection(*[set(m.keys()) for _, m in curve_maps])
    )

    def _returns_from_map(m: dict[int, float]) -> list[float]:
        vals = [m[ts] for ts in common_ts]
        return [(vals[i] - vals[i - 1]) / vals[i - 1] for i in range(1, len(vals)) if vals[i - 1] > 0]

    ret_map: dict[str, list[float]] = {name: _returns_from_map(m) for name, m in curve_maps}

    names = [name for name, _ in curve_maps]
    matrix: dict[str, dict[str, Optional[float]]] = {}
    for n1 in names:
        matrix[n1] = {}
        for n2 in names:
            if n1 == n2:
                matrix[n1][n2] = 1.0
            else:
                r1, r2 = ret_map[n1], ret_map[n2]
                n = min(len(r1), len(r2))
                if n < 3:
                    matrix[n1][n2] = None
                else:
                    corr = _pearson(r1[:n], r2[:n])
                    matrix[n1][n2] = round(corr, 4)

    return matrix


@router.post("/portfolio_run", response_model=PortfolioResult)
@limiter.limit("10/minute")
async def portfolio_run(request: Request, req: PortfolioRunRequest):
    """
    Run multiple strategies on the same symbol with capital allocation.
    Returns combined equity curve, correlation matrix, and per-strategy metrics.
    """
    if not req.allocations:
        raise HTTPException(status_code=400, detail="At least one allocation required")
    if len(req.allocations) > 10:
        raise HTTPException(status_code=400, detail="Max 10 strategies per portfolio run")

    total_alloc = sum(a.allocation_pct for a in req.allocations)
    if abs(total_alloc - 100.0) > 0.1:
        raise HTTPException(
            status_code=400,
            detail=f"Allocations must sum to 100% (got {total_alloc:.2f}%)"
        )

    for alloc in req.allocations:
        if alloc.strategy not in STRATEGIES:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown strategy '{alloc.strategy}'. Available: {list(STRATEGIES)}"
            )

    async def _run_one(alloc: PortfolioAllocation) -> PortfolioStrategyResult:
        allocated_capital = req.initial_capital * alloc.allocation_pct / 100.0
        params = BacktestParams(
            symbol=req.symbol,
            strategy=alloc.strategy,
            start_date=req.start_date,
            end_date=req.end_date,
            interval=req.interval,
            initial_capital=allocated_capital,
            commission_pct=req.commission_pct,
            slippage_pct=req.slippage_pct,
            position_size_pct=1.0,
            strategy_params={},
        )

        async def _async_run() -> "BacktestResult":
            return await run_backtest(params)

        result = await asyncio.to_thread(lambda: asyncio.run(_async_run()))

        equity_curve_simple = [
            {"t": pt.t, "equity": pt.equity}
            for pt in result.equity_curve
        ]

        return PortfolioStrategyResult(
            strategy=alloc.strategy,
            allocation_pct=alloc.allocation_pct,
            allocated_capital=round(allocated_capital, 2),
            metrics=result.metrics.model_dump(),
            equity_curve=equity_curve_simple,
        )

    try:
        strategy_results: list[PortfolioStrategyResult] = list(
            await asyncio.gather(*[_run_one(alloc) for alloc in req.allocations])
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error("Portfolio run failed", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Portfolio run failed: {e}")

    # Align equity curves — outer join with forward-fill
    all_ts: set[int] = set()
    for sr in strategy_results:
        for pt in sr.equity_curve:
            all_ts.add(pt["t"])
    sorted_ts = sorted(all_ts)

    aligned: dict[str, list[float]] = {}
    for sr in strategy_results:
        ts_map: dict[int, float] = {pt["t"]: pt["equity"] for pt in sr.equity_curve}
        last_val = sr.allocated_capital
        vals: list[float] = []
        for ts in sorted_ts:
            if ts in ts_map:
                last_val = ts_map[ts]
            vals.append(last_val)
        aligned[sr.strategy] = vals

    combined_equity_vals = [
        sum(aligned[sr.strategy][i] for sr in strategy_results)
        for i in range(len(sorted_ts))
    ]
    combined_equity_curve = [
        {"t": ts, "equity": round(eq, 2)}
        for ts, eq in zip(sorted_ts, combined_equity_vals)
    ]

    combined_metrics = _compute_combined_metrics(
        initial_capital=req.initial_capital,
        equity_curve=combined_equity_curve,
        interval=req.interval,
    )

    strategy_curves = [(sr.strategy, sr.equity_curve) for sr in strategy_results]
    correlation_matrix = _portfolio_correlation_matrix(strategy_curves)

    import math as _math

    def _vol(equity_vals: list[float]) -> float:
        if len(equity_vals) < 2:
            return 0.0
        rets = [(equity_vals[i] - equity_vals[i - 1]) / equity_vals[i - 1]
                for i in range(1, len(equity_vals)) if equity_vals[i - 1] > 0]
        if len(rets) < 2:
            return 0.0
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
        return _math.sqrt(var)

    portfolio_vol = _vol(combined_equity_vals)
    weighted_avg_vol = sum(
        (sr.allocation_pct / 100.0) * _vol(aligned[sr.strategy])
        for sr in strategy_results
    )
    diversification_benefit = (
        (weighted_avg_vol - portfolio_vol) / weighted_avg_vol
        if weighted_avg_vol > 0 else 0.0
    )

    return PortfolioResult(
        symbol=req.symbol,
        strategies=strategy_results,
        combined_equity_curve=combined_equity_curve,
        combined_metrics=combined_metrics,
        correlation_matrix=correlation_matrix,
        diversification_benefit=round(diversification_benefit, 4),
    )


# ── Walk-forward validation ────────────────────────────────────────────────────

class WalkForwardRequest(BacktestParams):
    n_splits: int = 5
    train_pct: float = 0.7
    anchored: bool = False

    class Config:
        # Inherit BacktestParams validators
        pass


@router.post("/walk_forward")
@limiter.limit("10/minute")
async def walk_forward(request: Request, req: WalkForwardRequest):
    """
    Run walk-forward validation — splits historical data into N folds and
    measures how well in-sample performance transfers to out-of-sample.

    A degradation_ratio > 0.7 indicates genuine edge; < 0.5 suggests overfitting.
    """
    from app.backtest.walk_forward import run_walk_forward, WalkForwardResult
    from app.backtest.engine import Backtest
    from dataclasses import asdict

    # Validate split params
    if not (2 <= req.n_splits <= 10):
        raise HTTPException(status_code=400, detail="n_splits must be between 2 and 10")
    if not (0.5 <= req.train_pct <= 0.9):
        raise HTTPException(status_code=400, detail="train_pct must be between 0.5 and 0.9")

    if req.strategy not in STRATEGIES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown strategy '{req.strategy}'. Available: {list(STRATEGIES)}",
        )

    try:
        loader = HistoricalDataLoader()
        bars = await loader.load(
            symbol=req.symbol,
            start_date=req.start_date,
            end_date=req.end_date,
            interval=req.interval,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Data load failed: {e}")

    if len(bars) < 40:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient data for walk-forward: {len(bars)} bars (need ≥ 40).",
        )

    # Build an engine factory so each fold gets a fresh Backtest instance
    def engine_factory() -> Backtest:
        return Backtest(
            initial_capital=req.initial_capital,
            commission_pct=req.commission_pct,
            slippage_pct=req.slippage_pct,
            position_size_pct=req.position_size_pct,
            spread_bps=getattr(req, "spread_bps", 0.0),
            execution_latency_ms=getattr(req, "execution_latency_ms", 0),
            enable_market_impact=getattr(req, "enable_market_impact", False),
            use_funding_rates=False,  # skip funding for walk-forward speed
        )

    try:
        result = await asyncio.to_thread(
            run_walk_forward,
            bars=bars,
            engine_factory=engine_factory,
            strategy_name=req.strategy,
            strategy_params=req.strategy_params,
            n_splits=req.n_splits,
            train_pct=req.train_pct,
            anchored=req.anchored,
            symbol=req.symbol,
            interval=req.interval,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Walk-forward failed: {e}")

    return asdict(result)


# ── Custom strategy (in-browser editor) ───────────────────────────────────────

class CustomStrategyRequest(BaseModel):
    strategy_code: str          # full Python source code of the strategy
    symbol: str = "BTCUSDT"
    start_date: str = "2024-01-01"
    end_date: str = "2025-01-01"
    interval: str = "1d"
    initial_capital: float = 10000.0
    commission_pct: float = 0.001
    slippage_pct: float = 0.0005
    position_size_pct: float = 0.25
    strategy_params: dict = {}


ALLOWED_IMPORTS = {
    "math", "statistics", "itertools", "collections", "typing",
    "dataclasses", "enum", "functools", "operator", "decimal",
}

BLOCKED_IMPORTS = {
    "os", "sys", "subprocess", "socket", "importlib", "builtins",
    "shutil", "pathlib", "tempfile", "io", "open", "__import__",
    "pty", "nis", "pwd", "grp", "resource", "signal", "mmap",
    "ctypes", "cffi", "pickle", "marshal", "shelve",
}


def _safe_import(name, *args, **kwargs):
    top = name.split(".")[0]
    if top in BLOCKED_IMPORTS:
        raise ImportError(f"Import of '{name}' is not allowed in custom strategies")
    if top not in ALLOWED_IMPORTS and not name.startswith("app.backtest"):
        raise ImportError(
            f"Import of '{name}' is not allowed. Allowed: {sorted(ALLOWED_IMPORTS)}"
        )
    import builtins as _builtins
    return _builtins.__import__(name, *args, **kwargs)


def _exec_strategy(code: str):
    """Exec user code and return the first Strategy subclass found."""
    from app.backtest.strategies.base import Strategy, StrategyContext
    from app.backtest.models import Bar, Signal

    import builtins as _builtins
    safe_builtins = {
        k: v for k, v in vars(_builtins).items()
        if k not in ("open", "exec", "eval", "compile", "__import__",
                     "breakpoint", "input", "memoryview", "vars")
    }
    safe_builtins["__import__"] = _safe_import

    namespace: dict = {
        "__builtins__": safe_builtins,
        "__import__": _safe_import,
        "Strategy": Strategy,
        "StrategyContext": StrategyContext,
        "Bar": Bar,
        "Signal": Signal,
    }

    try:
        exec(compile(code, "<custom_strategy>", "exec"), namespace)  # noqa: S102
    except SyntaxError as e:
        raise ValueError(f"Syntax error in strategy code: {e}") from e
    except ImportError as e:
        raise ValueError(str(e)) from e
    except Exception as e:
        raise ValueError(f"Error loading strategy code: {e}") from e

    strat_cls = None
    for obj in namespace.values():
        try:
            if (
                isinstance(obj, type)
                and issubclass(obj, Strategy)
                and obj is not Strategy
            ):
                strat_cls = obj
                break
        except TypeError:
            continue

    if strat_cls is None:
        raise ValueError(
            "No Strategy subclass found in the code. "
            "Define a class that extends Strategy."
        )

    return strat_cls


@router.post("/run_custom", response_model=BacktestResult)
async def run_custom_strategy(req: CustomStrategyRequest):
    """
    Run a user-supplied Python strategy. The code is exec()'d in a restricted
    namespace. The first Strategy subclass found is instantiated and backtested.
    Returns a full BacktestResult identical to the regular /run endpoint.
    """
    import time as _time
    import uuid as _uuid

    if len(req.strategy_code) > 10_000:
        raise HTTPException(
            status_code=400,
            detail="Strategy code exceeds the 10,000-character limit.",
        )

    try:
        strat_cls = await asyncio.to_thread(_exec_strategy, req.strategy_code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error("Custom strategy exec failed", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Strategy execution error: {e}")

    try:
        loader = HistoricalDataLoader()
        bars = await loader.load(
            symbol=req.symbol,
            start_date=req.start_date,
            end_date=req.end_date,
            interval=req.interval,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Data load failed: {e}")

    if len(bars) < 20:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Insufficient historical data for {req.symbol} ({req.interval}). "
                f"Got {len(bars)} bars. Try a longer date range."
            ),
        )

    from app.backtest.engine import Backtest, _asset_class
    from app.backtest.metrics import build_equity_curve, compute_metrics
    from app.backtest.models import TradeRecord
    from app.backtest.strategies import STRATEGIES as _STRATEGIES

    t0 = _time.perf_counter()

    def _run_in_thread():
        try:
            strategy = strat_cls(**req.strategy_params)
        except Exception as e:
            raise ValueError(f"Could not instantiate strategy: {e}") from e

        bt = Backtest(
            initial_capital=req.initial_capital,
            commission_pct=req.commission_pct,
            slippage_pct=req.slippage_pct,
            position_size_pct=req.position_size_pct,
        )
        trades, raw_equity = bt.run(
            bars, strategy,
            symbol=req.symbol,
            interval=req.interval,
        )

        asset_cls = _asset_class(req.symbol)
        metrics = compute_metrics(
            initial_capital=req.initial_capital,
            equity=raw_equity,
            trades=trades,
            interval=req.interval,
            asset_class=asset_cls,
        )
        equity_curve = build_equity_curve(raw_equity)

        # Buy-and-hold benchmark
        bh_bt = Backtest(
            initial_capital=req.initial_capital,
            commission_pct=req.commission_pct,
            slippage_pct=req.slippage_pct,
            position_size_pct=req.position_size_pct,
        )
        bh_trades, bh_raw_equity = bh_bt.run(
            bars, _STRATEGIES["buy_and_hold"](),
            symbol=req.symbol, interval=req.interval,
        )
        bench_metrics = compute_metrics(
            initial_capital=req.initial_capital,
            equity=bh_raw_equity,
            trades=bh_trades,
            interval=req.interval,
            asset_class=asset_cls,
        )

        runtime_ms = (_time.perf_counter() - t0) * 1000
        friction = bt.friction_breakdown()

        return BacktestResult(
            id=str(_uuid.uuid4()),
            symbol=req.symbol,
            strategy=getattr(strat_cls, "name", "custom"),
            interval=req.interval,
            start_date=bars[0].timestamp.date().isoformat(),
            end_date=bars[-1].timestamp.date().isoformat(),
            params_used=strategy.params,
            metrics=metrics,
            benchmark_metrics=bench_metrics,
            trades=[
                TradeRecord(
                    side=t.side,
                    entry_time=t.entry_time.isoformat(),
                    exit_time=t.exit_time.isoformat(),
                    entry_price=round(t.entry_price, 6),
                    exit_price=round(t.exit_price, 6),
                    size=round(t.size, 8),
                    pnl=round(t.pnl, 2),
                    pnl_pct=round(t.pnl_pct, 2),
                    duration_bars=t.duration_bars,
                )
                for t in trades
            ],
            equity_curve=equity_curve,
            bars_processed=len(bars),
            runtime_ms=round(runtime_ms, 1),
            entry_analysis=None,
            friction_breakdown=friction,
            anomalies=None,
            short_trades=sum(1 for t in trades if t.side == "short"),
        )

    try:
        result = await asyncio.to_thread(_run_in_thread)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error("Custom strategy backtest failed", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Backtest failed: {e}")

    return result


# ── Parameter Sensitivity ──────────────────────────────────────────────────────

class SensitivityRequest(BaseModel):
    symbol: str
    strategy: str
    param_name: str
    param_values: list[float]
    start_date: str
    end_date: str = ""
    interval: str = "1d"
    initial_capital: float = 10000.0
    commission_pct: float = 0.001
    slippage_pct: float = 0.0005
    position_size_pct: float = 0.25
    base_params: dict = {}
    metric: str = "sharpe_ratio"


class SensitivityPoint(BaseModel):
    param_value: float
    metric_value: float | None = None
    total_return_pct: float | None = None
    total_trades: int = 0
    success: bool
    error: str | None = None


@router.post("/sensitivity", response_model=list[SensitivityPoint])
async def param_sensitivity(req: SensitivityRequest):
    """Sweep one strategy parameter across values, return metric at each point."""
    if len(req.param_values) > 20:
        raise HTTPException(status_code=400, detail="Max 20 param values per sensitivity sweep")
    if req.strategy not in STRATEGIES:
        raise HTTPException(status_code=400, detail=f"Unknown strategy: {req.strategy}")

    async def _run_one(val: float) -> SensitivityPoint:
        try:
            params_dict = dict(req.base_params)
            params_dict[req.param_name] = val
            bp = BacktestParams(
                symbol=req.symbol,
                strategy=req.strategy,
                start_date=req.start_date,
                end_date=req.end_date if req.end_date else None,
                interval=req.interval,
                initial_capital=req.initial_capital,
                commission_pct=req.commission_pct,
                slippage_pct=req.slippage_pct,
                position_size_pct=req.position_size_pct,
                strategy_params=params_dict,
            )
            result = await run_backtest(bp)
            metric_val = getattr(result.metrics, req.metric, None)
            if metric_val is not None:
                metric_val = float(metric_val)
            return SensitivityPoint(
                param_value=val,
                metric_value=metric_val,
                total_return_pct=float(result.metrics.total_return_pct),
                total_trades=int(result.metrics.total_trades),
                success=True,
            )
        except Exception as e:
            return SensitivityPoint(
                param_value=val,
                metric_value=None,
                total_return_pct=None,
                total_trades=0,
                success=False,
                error=str(e),
            )

    results = await asyncio.gather(*[_run_one(v) for v in req.param_values])
    return list(results)


# ── Market Regime Analysis ─────────────────────────────────────────────────────

class RegimeAnalysisRequest(BaseModel):
    symbol: str
    strategy: str
    interval: str = "1d"
    period_days: int = 180
    initial_capital: float = 10000.0
    commission_pct: float = 0.001
    slippage_pct: float = 0.0005
    position_size_pct: float = 0.25
    strategy_params: dict = {}


@router.post("/regime_analysis")
async def regime_analysis(req: RegimeAnalysisRequest):
    """Classify bars into market regimes and show strategy performance per regime."""
    from dataclasses import asdict
    from app.backtest.regime import classify_regimes, compute_regime_stats

    start_date = _iso_days_ago(req.period_days)
    bp = BacktestParams(
        symbol=req.symbol,
        strategy=req.strategy,
        start_date=start_date,
        interval=req.interval,
        initial_capital=req.initial_capital,
        commission_pct=req.commission_pct,
        slippage_pct=req.slippage_pct,
        position_size_pct=req.position_size_pct,
        strategy_params=req.strategy_params,
    )

    try:
        result = await run_backtest(bp)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Backtest failed: {e}")

    # Load bars for regime classification
    loader = HistoricalDataLoader()
    try:
        bars = await loader.load(req.symbol, start_date, None, req.interval)
    except Exception:
        bars = []

    if len(bars) < 30:
        # Auto-generate GBM bars
        gbm_bars = await asyncio.to_thread(_generate_gbm_bars, req.symbol, req.interval, req.period_days)
        await asyncio.to_thread(bar_storage.upsert_bars, req.symbol, req.interval, gbm_bars)
        bars = await loader.load(req.symbol, start_date, None, req.interval)

    if len(bars) < 20:
        raise HTTPException(status_code=400, detail="Insufficient bar data for regime analysis")

    # Build DataFrame from Bar objects
    import pandas as pd
    df = pd.DataFrame([{
        "ts": str(b.ts),
        "open": float(b.open),
        "high": float(b.high),
        "low": float(b.low),
        "close": float(b.close),
        "volume": float(b.volume),
    } for b in bars])

    regime_per_bar = await asyncio.to_thread(classify_regimes, df)

    trades_as_dicts = [
        {
            "entry_time": str(t.entry_time),
            "exit_time": str(t.exit_time),
            "pnl": float(t.pnl),
            "pnl_pct": float(t.pnl_pct),
            "side": str(t.side),
        }
        for t in result.trades
    ]

    stats = await asyncio.to_thread(
        compute_regime_stats, regime_per_bar, trades_as_dicts, len(regime_per_bar)
    )

    # Determine dominant + best regime
    dominant = max(stats, key=lambda s: s.bar_count).regime if stats else "ranging"
    qualified = [s for s in stats if s.trade_count >= 3]
    if qualified:
        best_reg = max(qualified, key=lambda s: s.win_rate).regime
        best_stat = next(s for s in stats if s.regime == best_reg)
        insight = f"This strategy performs best in {best_reg.replace('_', ' ')} conditions (win rate {best_stat.win_rate:.0f}%)"
    else:
        insight = "Not enough trades per regime for a reliable recommendation."
        best_reg = dominant

    return {
        "regime_per_bar": regime_per_bar,
        "stats": [asdict(s) for s in stats],
        "dominant_regime": dominant,
        "best_regime": best_reg,
        "insight": insight,
    }


# ── Strategy Leaderboard ───────────────────────────────────────────────────────

class LeaderboardRequest(BaseModel):
    symbol: str = "BTCUSDT"
    interval: str = "1d"
    period_days: int = 180
    initial_capital: float = 10000.0
    commission_pct: float = 0.001
    slippage_pct: float = 0.0005
    position_size_pct: float = 0.25
    sort_by: str = "sharpe_ratio"


@router.post("/leaderboard")
async def strategy_leaderboard(req: LeaderboardRequest):
    """Run all strategies on the same data and rank them."""
    start_date = _iso_days_ago(req.period_days)
    skip = {"buy_and_hold"}

    async def _run_one(name: str) -> dict:
        try:
            bp = BacktestParams(
                symbol=req.symbol,
                strategy=name,
                start_date=start_date,
                interval=req.interval,
                initial_capital=req.initial_capital,
                commission_pct=req.commission_pct,
                slippage_pct=req.slippage_pct,
                position_size_pct=req.position_size_pct,
            )
            r = await run_backtest(bp)
            m = r.metrics

            # Downsample equity curve to 20 points for sparkline
            raw_eq = r.equity_curve or []
            eq = [
                float(getattr(e, "equity", None) or e.get("equity", req.initial_capital))
                if not isinstance(e, dict) else e.get("equity", req.initial_capital)
                for e in raw_eq
            ]
            if len(eq) > 20:
                indices = [int(i * (len(eq) - 1) / 19) for i in range(20)]
                eq = [eq[i] for i in indices]
            elif len(eq) == 0:
                eq = [req.initial_capital]

            strategy_cls = STRATEGIES.get(name)
            try:
                _inst = strategy_cls() if strategy_cls else None
                display_name = getattr(_inst, "name", name) if _inst else name
                description = getattr(_inst, "description", "") if _inst else ""
            except Exception:
                display_name = name
                description = ""

            return {
                "strategy_name": name,
                "display_name": display_name,
                "description": description,
                "sharpe_ratio": round(float(m.sharpe_ratio), 3),
                "sortino_ratio": round(float(m.sortino_ratio), 3),
                "calmar_ratio": round(float(m.calmar_ratio), 3),
                "total_return_pct": round(float(m.total_return_pct), 2),
                "max_drawdown_pct": round(float(m.max_drawdown_pct), 2),
                "win_rate_pct": round(float(m.win_rate_pct), 1),
                "profit_factor": round(float(m.profit_factor), 3),
                "total_trades": int(m.total_trades),
                "avg_trade_duration_bars": round(float(getattr(m, "avg_duration_bars", 0)), 1),
                "equity_curve_sample": [round(v, 2) for v in eq],
                "error": None,
            }
        except Exception as e:
            return {
                "strategy_name": name,
                "display_name": name,
                "description": "",
                "sharpe_ratio": -999.0,
                "sortino_ratio": 0.0,
                "calmar_ratio": 0.0,
                "total_return_pct": 0.0,
                "max_drawdown_pct": 0.0,
                "win_rate_pct": 0.0,
                "profit_factor": 0.0,
                "total_trades": 0,
                "avg_trade_duration_bars": 0.0,
                "equity_curve_sample": [req.initial_capital],
                "error": str(e),
            }

    names = [n for n in STRATEGIES if n not in skip]
    entries = await asyncio.gather(*[_run_one(n) for n in names])

    valid_sort = {"sharpe_ratio", "sortino_ratio", "calmar_ratio", "total_return_pct", "win_rate_pct", "profit_factor"}
    sort_key = req.sort_by if req.sort_by in valid_sort else "sharpe_ratio"
    sorted_entries = sorted(entries, key=lambda e: e[sort_key], reverse=True)
    for i, e in enumerate(sorted_entries):
        e["rank"] = i + 1

    return sorted_entries


# ── Efficient Frontier ─────────────────────────────────────────────────────────

import dataclasses as _dataclasses
from app.backtest.frontier import compute_frontier, FrontierResult  # noqa: E402


class FrontierRequest(BaseModel):
    strategies: list[str]            # 2-10 strategy names
    symbol: str = "BTCUSDT"
    interval: str = "1d"
    period_days: int = 365
    initial_capital: float = 10000.0
    commission_pct: float = 0.001
    slippage_pct: float = 0.0005
    position_size_pct: float = 0.25
    risk_free_rate: float = 0.05     # annual


@router.post("/frontier")
async def efficient_frontier(req: FrontierRequest):
    """Compute Markowitz efficient frontier for a set of strategies."""
    if len(req.strategies) < 2:
        raise HTTPException(status_code=400, detail="At least 2 strategies are required.")
    if len(req.strategies) > 10:
        raise HTTPException(status_code=400, detail="At most 10 strategies are supported.")

    unknown = [s for s in req.strategies if s not in STRATEGIES]
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown strategies: {unknown}. Available: {list(STRATEGIES)}",
        )

    from datetime import datetime, timezone, timedelta
    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=req.period_days)
    start_date = start_dt.strftime("%Y-%m-%d")
    end_date = end_dt.strftime("%Y-%m-%d")

    async def _run_one(strategy_name: str) -> tuple[str, list[float]]:
        params = BacktestParams(
            symbol=req.symbol,
            strategy=strategy_name,
            start_date=start_date,
            end_date=end_date,
            interval=req.interval,
            initial_capital=req.initial_capital,
            commission_pct=req.commission_pct,
            slippage_pct=req.slippage_pct,
            position_size_pct=req.position_size_pct,
            strategy_params={},
        )
        result = await run_backtest(params)
        equity_values = [pt.equity for pt in result.equity_curve]
        return strategy_name, equity_values

    try:
        pairs = await asyncio.gather(*[_run_one(s) for s in req.strategies])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error("Frontier backtest run failed", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Backtest run failed: {e}")

    strategy_names = [p[0] for p in pairs]
    equity_curves = [p[1] for p in pairs]

    try:
        result: FrontierResult = compute_frontier(strategy_names, equity_curves, req.risk_free_rate)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error("Frontier computation failed", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Frontier computation failed: {e}")

    return _dataclasses.asdict(result)


# ── Strategy Equity Correlation ────────────────────────────────────────────────

class EquityCorrelationRequest(BaseModel):
    strategies: list[str]        # 2-15 strategy names
    symbol: str = "BTCUSDT"
    interval: str = "1d"
    period_days: int = 365
    initial_capital: float = 10_000.0
    commission_pct: float = 0.001
    slippage_pct: float = 0.0005
    position_size_pct: float = 0.25


@router.post("/equity_correlation")
async def equity_correlation(req: EquityCorrelationRequest):
    """Compute pairwise Pearson correlation between strategy equity curves."""
    import math

    if len(req.strategies) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 strategies.")
    if len(req.strategies) > 15:
        raise HTTPException(status_code=400, detail="At most 15 strategies are supported.")

    unknown = [s for s in req.strategies if s not in STRATEGIES]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown strategies: {unknown}")

    from datetime import datetime, timezone, timedelta
    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=req.period_days)
    start_date = start_dt.strftime("%Y-%m-%d")
    end_date = end_dt.strftime("%Y-%m-%d")

    async def _run(name: str) -> tuple[str, list[float]]:
        try:
            p = BacktestParams(
                symbol=req.symbol, strategy=name,
                start_date=start_date, end_date=end_date,
                interval=req.interval, initial_capital=req.initial_capital,
                commission_pct=req.commission_pct, slippage_pct=req.slippage_pct,
                position_size_pct=req.position_size_pct, strategy_params={},
            )
            res = await run_backtest(p)
            returns = []
            for i in range(1, len(res.equity_curve)):
                prev = res.equity_curve[i - 1].equity
                cur = res.equity_curve[i].equity
                if prev > 0:
                    returns.append((cur - prev) / prev)
            return name, returns
        except Exception:
            return name, []

    pairs = await asyncio.gather(*[_run(s) for s in req.strategies])

    def mean(xs: list[float]) -> float:
        return sum(xs) / len(xs) if xs else 0.0

    def pearson(xs: list[float], ys: list[float]) -> float | None:
        n = min(len(xs), len(ys))
        if n < 5:
            return None
        xs, ys = xs[:n], ys[:n]
        mx, my = mean(xs), mean(ys)
        num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        dxs = math.sqrt(sum((x - mx) ** 2 for x in xs))
        dys = math.sqrt(sum((y - my) ** 2 for y in ys))
        if dxs == 0 or dys == 0:
            return None
        return round(num / (dxs * dys), 4)

    names = [p[0] for p in pairs]
    returns_map = {p[0]: p[1] for p in pairs}

    matrix: dict[str, dict[str, float | None]] = {}
    for a in names:
        matrix[a] = {}
        for b in names:
            if a == b:
                matrix[a][b] = 1.0
            elif b in matrix and a in matrix[b]:
                matrix[a][b] = matrix[b][a]
            else:
                matrix[a][b] = pearson(returns_map[a], returns_map[b])

    # Identify most diversifying pair
    min_corr = 2.0
    best_pair = None
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            c = matrix[a].get(b)
            if c is not None and c < min_corr:
                min_corr = c
                best_pair = (a, b)

    return {
        "strategies": names,
        "matrix": matrix,
        "most_diversifying_pair": list(best_pair) if best_pair else None,
        "min_correlation": min_corr if best_pair else None,
    }


# ── Market condition correlation ───────────────────────────────────────────────

class MarketCorrelationRequest(BaseModel):
    symbol: str = "BTCUSDT"
    strategy: str = "rsi"
    strategy_params: dict = {}
    interval: str = "1d"
    period_days: int = 365
    initial_capital: float = 10_000.0
    commission_pct: float = 0.001
    slippage_pct: float = 0.0005
    position_size_pct: float = 0.25


@router.post("/market_correlation")
async def market_correlation(req: MarketCorrelationRequest):
    """Break down strategy performance by market conditions."""
    import math

    if req.strategy not in STRATEGIES:
        raise HTTPException(status_code=404, detail=f"Unknown strategy: {req.strategy}")

    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=req.period_days)

    p = BacktestParams(
        symbol=req.symbol,
        strategy=req.strategy,
        start_date=start_dt.strftime("%Y-%m-%d"),
        end_date=end_dt.strftime("%Y-%m-%d"),
        interval=req.interval,
        initial_capital=req.initial_capital,
        commission_pct=req.commission_pct,
        slippage_pct=req.slippage_pct,
        position_size_pct=req.position_size_pct,
        strategy_params=req.strategy_params,
    )
    result = await run_backtest(p)
    trades = result.trades or []

    # ── Fear/Greed regime simulation (sinusoidal proxy) ──
    # We don't have live F&G data here, so we generate a deterministic proxy
    # based on the equity curve's rolling momentum.
    eq = result.equity_curve
    eq_vals = [e.equity for e in eq]
    eq_ts = [e.t for e in eq]

    def fear_greed_at(ts: int) -> float:
        """Approximate F&G (0-100) via a 14-period momentum of the equity baseline."""
        if not eq_ts:
            return 50.0
        # Find nearest bar index
        idx = min(range(len(eq_ts)), key=lambda i: abs(eq_ts[i] - ts))
        window = 14
        start_i = max(0, idx - window)
        if start_i == idx:
            return 50.0
        momentum = (eq_vals[idx] - eq_vals[start_i]) / (eq_vals[start_i] or 1) * 100
        # Map momentum to [0, 100]
        return max(0.0, min(100.0, 50.0 + momentum * 5))

    fg_buckets: dict[str, dict] = {
        "Extreme Fear (0–25)": {"trade_count": 0, "wins": 0, "total_pnl": 0.0},
        "Fear (25–50)": {"trade_count": 0, "wins": 0, "total_pnl": 0.0},
        "Greed (50–75)": {"trade_count": 0, "wins": 0, "total_pnl": 0.0},
        "Extreme Greed (75–100)": {"trade_count": 0, "wins": 0, "total_pnl": 0.0},
    }

    def fg_label(v: float) -> str:
        if v < 25: return "Extreme Fear (0–25)"
        if v < 50: return "Fear (25–50)"
        if v < 75: return "Greed (50–75)"
        return "Extreme Greed (75–100)"

    # ── BTC return buckets ──
    # Compute daily returns from the equity curve as BTC proxy
    daily_returns: list[float] = []
    for i in range(1, len(eq_vals)):
        prev = eq_vals[i - 1]
        if prev > 0:
            daily_returns.append((eq_vals[i] - prev) / prev * 100)

    sorted_rets = sorted(daily_returns)
    q25 = sorted_rets[len(sorted_rets) // 4] if sorted_rets else 0.0
    q75 = sorted_rets[3 * len(sorted_rets) // 4] if sorted_rets else 0.0
    median = sorted_rets[len(sorted_rets) // 2] if sorted_rets else 0.0

    btc_buckets: dict[str, dict] = {
        f"Bear (< {q25:.1f}%)": {"trade_count": 0, "wins": 0, "total_pnl": 0.0},
        f"Weak ({q25:.1f}–{median:.1f}%)": {"trade_count": 0, "wins": 0, "total_pnl": 0.0},
        f"Moderate ({median:.1f}–{q75:.1f}%)": {"trade_count": 0, "wins": 0, "total_pnl": 0.0},
        f"Bull (> {q75:.1f}%)": {"trade_count": 0, "wins": 0, "total_pnl": 0.0},
    }
    btc_bucket_keys = list(btc_buckets.keys())

    def btc_return_at(ts: int) -> float:
        idx = min(range(len(eq_ts)), key=lambda i: abs(eq_ts[i] - ts))
        if idx == 0:
            return 0.0
        prev = eq_vals[idx - 1]
        if prev <= 0:
            return 0.0
        return (eq_vals[idx] - prev) / prev * 100

    def btc_label(v: float) -> str:
        if v < q25: return btc_bucket_keys[0]
        if v < median: return btc_bucket_keys[1]
        if v < q75: return btc_bucket_keys[2]
        return btc_bucket_keys[3]

    # ── Hour-of-day buckets ──
    hour_buckets: list[dict] = [
        {"label": f"{h:02d}h", "trade_count": 0, "wins": 0, "total_pnl": 0.0}
        for h in range(24)
    ]

    # Pearson between strategy returns and "BTC" returns (same equity proxy here)
    strat_returns: list[float] = []
    for i in range(1, len(eq_vals)):
        prev = eq_vals[i - 1]
        if prev > 0:
            strat_returns.append((eq_vals[i] - prev) / prev)

    def _pearson(xs: list[float], ys: list[float]) -> float:
        n = min(len(xs), len(ys))
        if n < 5:
            return 0.0
        xs, ys = xs[:n], ys[:n]
        mx = sum(xs) / n
        my = sum(ys) / n
        num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
        dy = math.sqrt(sum((y - my) ** 2 for y in ys))
        if dx == 0 or dy == 0:
            return 0.0
        return round(num / (dx * dy), 4)

    btc_corr = _pearson(strat_returns, daily_returns)

    # ── Assign trades to buckets ──
    for trade in trades:
        try:
            ts = int(datetime.fromisoformat(trade.entry_time.replace("Z", "+00:00")).timestamp() * 1000)
        except Exception:
            ts = 0
        pnl = trade.pnl_pct
        won = pnl > 0

        # Fear/Greed
        fg = fear_greed_at(ts)
        fgl = fg_label(fg)
        fg_buckets[fgl]["trade_count"] += 1
        fg_buckets[fgl]["total_pnl"] += pnl
        if won:
            fg_buckets[fgl]["wins"] += 1

        # BTC return
        btcr = btc_return_at(ts)
        btcl = btc_label(btcr)
        btc_buckets[btcl]["trade_count"] += 1
        btc_buckets[btcl]["total_pnl"] += pnl
        if won:
            btc_buckets[btcl]["wins"] += 1

        # Hour of day
        try:
            hour = datetime.fromisoformat(trade.entry_time.replace("Z", "+00:00")).hour
        except Exception:
            hour = 0
        hour_buckets[hour]["trade_count"] += 1
        hour_buckets[hour]["total_pnl"] += pnl
        if won:
            hour_buckets[hour]["wins"] += 1

    def _bucket_stats(label: str, b: dict) -> dict:
        n = b["trade_count"]
        avg_pnl = round(b["total_pnl"] / n, 4) if n > 0 else 0.0
        win_rate = round(b["wins"] / n * 100, 1) if n > 0 else 0.0
        return {
            "label": label,
            "trade_count": n,
            "win_rate": win_rate,
            "avg_pnl_pct": avg_pnl,
            "total_pnl": round(b["total_pnl"], 4),
        }

    fear_greed_out = [_bucket_stats(k, v) for k, v in fg_buckets.items()]
    btc_buckets_out = [_bucket_stats(k, v) for k, v in btc_buckets.items()]
    hour_out = [_bucket_stats(b["label"], b) for b in hour_buckets]

    # ── Insights ──
    insights: list[str] = []
    best_fg = max(fear_greed_out, key=lambda x: x["avg_pnl_pct"])
    if best_fg["trade_count"] > 0:
        insights.append(f"Best F/G regime: {best_fg['label']} ({best_fg['avg_pnl_pct']:+.2f}% avg P&L, {best_fg['win_rate']:.0f}% WR).")
    best_btc = max(btc_buckets_out, key=lambda x: x["avg_pnl_pct"])
    if best_btc["trade_count"] > 0:
        insights.append(f"Best BTC environment: {best_btc['label']} ({best_btc['avg_pnl_pct']:+.2f}% avg P&L).")
    best_hour = max(hour_out, key=lambda x: (x["trade_count"] > 0, x["avg_pnl_pct"]))
    if best_hour["trade_count"] > 0:
        insights.append(f"Best trading hour (UTC): {best_hour['label']} with {best_hour['avg_pnl_pct']:+.2f}% avg P&L.")
    if abs(btc_corr) < 0.15:
        insights.append("Strategy is largely market-neutral — not driven by BTC's daily direction.")
    elif btc_corr > 0.5:
        insights.append("Strong positive BTC correlation — consider hedging with an inverse strategy.")
    elif btc_corr < -0.3:
        insights.append("Negative BTC correlation — strategy may act as a natural hedge in bear markets.")

    return {
        "fear_greed": fear_greed_out,
        "btc_return_buckets": btc_buckets_out,
        "hour_of_day": hour_out,
        "btc_return_correlation": btc_corr,
        "insights": insights,
    }
