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
