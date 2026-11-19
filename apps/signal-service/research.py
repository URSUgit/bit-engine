"""Loopback research deployment: reuse Backtester and Paper Forward, no venue clients.

This entry point does not load the full application's .env or lifespan. It is
not a remote-access boundary: both it and the web app must bind to loopback.
"""
import asyncio
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.routing import APIRoute

from app.backtest.models import BacktestParams
from app.backtest.storage import bar_storage
from app.limiter import limiter
from app.routers import backtest, paper


@asynccontextmanager
async def lifespan(_app):
    task = asyncio.create_task(paper.run_forward_loop())
    try:
        yield
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


app = FastAPI(title='Bit Engine Research', lifespan=lifespan)
app.state.limiter = limiter


def include_research_routes(source, prefix, paths):
    selected = APIRouter()
    selected.routes.extend(route for route in source.routes
                           if isinstance(route, APIRoute) and route.path in paths)
    app.include_router(selected, prefix=prefix)


include_research_routes(backtest.router, '/api/v1/backtest', {
    '/symbols', '/strategies', '/intervals', '/metadata/{symbol}',
    '/history', '/history/{run_id}', '/cache', '/forward_test_stream',
})
include_research_routes(paper.router, '/api/v1/paper', {'/forward', '/forward/start', '/forward/stop'})


@app.get('/health')
async def health():
    return {'status': 'ok', 'service': 'signal-service', 'mode': 'research'}


@app.get('/api/v1/backtest/archive-coverage')
def archive_coverage():
    path = os.environ.get('BITENGINE_ARCHIVE_COVERAGE')
    if not path:
        raise HTTPException(404, detail='No verified archive is installed.')
    manifest = json.loads(Path(path).read_text(encoding='utf-8'))
    return {key: value for key, value in manifest.items() if key != 'archives'}


@app.post('/api/v1/backtest/run/stream')
async def archive_run(request: Request, params: BacktestParams):
    if params.strategy != 'studio_breakout' or not params.end_date:
        raise HTTPException(422, detail='This local release runs the previous-day breakout on explicit archive dates only.')
    return await backtest.run_stream(request, params)


def utc_seconds(value: str) -> int:
    dt = datetime.fromisoformat(value)
    return int((dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).timestamp())


@app.get('/api/v1/backtest/data/{symbol}')
async def chart_data(symbol: str, start_date: str, end_date: str, interval: str = '1d'):
    """A chart must never refresh providers or replace the replayed data."""
    try:
        start, end = utc_seconds(start_date), utc_seconds(end_date)
    except (ValueError, OverflowError) as exc:
        raise HTTPException(422, detail='Use valid dates or timestamps.') from exc
    if end < start:
        raise HTTPException(422, detail='End must be on or after start.')
    symbol = symbol.upper()

    def read():
        return (bar_storage.get_meta(symbol, interval),
                bar_storage.get_bars(symbol, interval, start, end))

    meta, bars = await asyncio.to_thread(read)
    source = meta['source'] if meta else None
    return {'symbol': symbol, 'interval': interval, 'count': len(bars),
            'source': source, 'is_synthetic': source == 'synthetic_gbm',
            'bars': [{'t': b.ts, 'o': b.open, 'h': b.high, 'l': b.low,
                      'c': b.close, 'v': b.volume} for b in bars]}
