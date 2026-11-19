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

import httpx
from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field

from app.backtest.models import BacktestParams
from app.backtest.storage import bar_storage
from app.backtest.video_strategy import PROMPT, VideoImport, VideoOrigin, VideoRequest, analyze_video, configured_model, parse_draft
from app.limiter import limiter
from app.routers import backtest, paper
from app.youtube import client as youtube


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
_video_analysis_lock = asyncio.Lock()
_video_search_lock = asyncio.Lock()


def include_research_routes(source, prefix, routes):
    selected = APIRouter()
    selected.routes.extend(route for route in source.routes
                           if isinstance(route, APIRoute)
                           and all((method, route.path) in routes for method in route.methods))
    app.include_router(selected, prefix=prefix)


include_research_routes(backtest.router, '/api/v1/backtest', {
    ('GET', '/symbols'), ('GET', '/strategies'), ('GET', '/intervals'), ('GET', '/metadata/{symbol}'),
    ('GET', '/history'), ('GET', '/history/{run_id}'), ('GET', '/cache'), ('GET', '/forward_test_stream'),
})
include_research_routes(paper.router, '/api/v1/paper', {
    ('GET', '/forward'), ('POST', '/forward/start'), ('POST', '/forward/stop'),
    ('GET', '/bots'), ('POST', '/bots'), ('POST', '/bots/{bot_id}/start'), ('POST', '/bots/{bot_id}/stop'),
})


@app.get('/health')
async def health():
    return {'status': 'ok', 'service': 'signal-service', 'mode': 'research'}


@app.get('/api/v1/backtest/video-strategy')
def video_strategy_settings():
    return {'api_enabled': bool(os.environ.get('GEMINI_API_KEY', '').strip()),
            'search_enabled': bool(os.environ.get('YOUTUBE_API_KEY', '').strip()),
            'model': configured_model(), 'prompt': PROMPT}


@app.post('/api/v1/backtest/video-strategy/import', response_model=VideoOrigin)
def import_video_strategy(request: VideoImport):
    try:
        draft = parse_draft(request.output)
    except ValueError:
        raise HTTPException(422, 'Gemini output is not a valid strategy draft. Copy the full JSON and check it against the example.') from None
    return VideoOrigin(url=request.url, provider='pasted_gemini', model=None, draft=draft)


def require_local_video_request(http_request: Request) -> None:
    origin = http_request.headers.get('origin')
    if (http_request.headers.get('sec-fetch-site') not in (None, 'none', 'same-origin')
            or (origin is not None and origin != str(http_request.base_url).rstrip('/'))):
        raise HTTPException(403, 'This video service is only available from the local Backtester.')


@app.middleware('http')
async def protect_paper_bot_writes(request: Request, call_next):
    path = request.url.path.rstrip('/')
    prefix = '/api/v1/paper/bots'
    if request.method == 'POST' and (path == prefix or path.startswith(prefix + '/')):
        try:
            require_local_video_request(request)
        except HTTPException:
            return JSONResponse({'detail': 'Paper bot changes are only available from the local Backtester.'}, status_code=403)
    return await call_next(request)


class PublicVideoSearch(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    query: str = Field(min_length=2, max_length=120)
    page_token: str | None = Field(default=None, min_length=1, max_length=512)


@app.post('/api/v1/backtest/video-strategy/search')
async def search_video_strategy(request: PublicVideoSearch, http_request: Request):
    require_local_video_request(http_request)
    key = os.environ.get('YOUTUBE_API_KEY', '').strip()
    if not key:
        raise HTTPException(503, 'Set YOUTUBE_API_KEY on the local server or open YouTube search in a new tab.')
    if _video_search_lock.locked():
        raise HTTPException(409, 'A YouTube search is already running.')
    async with _video_search_lock:
        try:
            async with asyncio.timeout(15):
                return await youtube.search_public_videos(request.query, request.page_token, key)
        except youtube.QuotaExceeded as exc:
            raise HTTPException(429, str(exc)) from None
        except (TimeoutError, httpx.TimeoutException):
            raise HTTPException(504, 'YouTube search timed out. Try again or open YouTube search.') from None
        except (httpx.HTTPError, ValueError, AttributeError, TypeError):
            raise HTTPException(502, 'YouTube search is unavailable. Check the local YouTube Data API setup or open YouTube search.') from None


@app.post('/api/v1/backtest/video-strategy/analyze', response_model=VideoOrigin)
async def analyze_video_strategy(request: VideoRequest, http_request: Request):
    require_local_video_request(http_request)
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    if not key:
        raise HTTPException(503, 'Set GEMINI_API_KEY on the local server or use Paste Gemini JSON.')
    if _video_analysis_lock.locked():
        raise HTTPException(409, 'A video analysis is already running.')
    async with _video_analysis_lock:
        try:
            async with asyncio.timeout(100), httpx.AsyncClient(timeout=95, follow_redirects=False) as client:
                return await analyze_video(client, request.url, key)
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            if code == 429:
                raise HTTPException(429, 'Gemini quota was reached. Try again later or paste Gemini JSON.') from None
            if code in (401, 403):
                raise HTTPException(503, 'Gemini rejected this project or key. Check local configuration and model access.') from None
            raise HTTPException(502, 'Gemini could not analyze this link. Use one public YouTube video or paste Gemini JSON.') from None
        except (TimeoutError, httpx.TimeoutException):
            raise HTTPException(504, 'Gemini analysis timed out. Try a shorter public video.') from None
        except (httpx.HTTPError, ValueError):
            raise HTTPException(502, 'Gemini did not return a usable strategy draft. Review it manually or paste Gemini JSON.') from None


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
    if params.video_origin and not (params.video_origin.draft.trader_name and params.video_origin.draft.strategy_name):
        raise HTTPException(422, detail='Confirm the trader and strategy names before backtesting a video draft.')
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
