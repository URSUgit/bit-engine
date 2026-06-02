import asyncio
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

# Optional deps — the service must still start (and serve /symbols) if these
# aren't installed. Both degrade gracefully to stdlib equivalents so a missing
# `pip install` never leaves the backtester without tickers.
try:
    from pythonjsonlogger import jsonlogger
    _JSON_LOGS = True
except ImportError:
    _JSON_LOGS = False

try:
    from slowapi.errors import RateLimitExceeded
    _SLOWAPI = True
except ImportError:
    RateLimitExceeded = None  # type: ignore[assignment,misc]
    _SLOWAPI = False


def _load_env_file() -> None:
    """Load KEY=VALUE pairs from the local .env into os.environ.

    Dependency-free so it works no matter how uvicorn is launched (the
    `--env-file` flag needs python-dotenv installed; this does not). Runs
    before the routers import so module-level os.getenv() calls see the
    values. Real environment variables always win over the file, which
    keeps cloud deployments (where vars are injected) unaffected.
    """
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_file()

# ── Structured logging ─────────────────────────────────────────────────────────
# Configure before router imports so all modules share the same handler. JSON
# formatting when python-json-logger is present, plain text otherwise.
_handler = logging.StreamHandler()
if _JSON_LOGS:
    _handler.setFormatter(
        jsonlogger.JsonFormatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
else:
    _handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
log = logging.getLogger("signal_service")
log.setLevel(logging.INFO)
log.addHandler(_handler)
# Suppress noisy third-party logs (uvicorn access, httpx, etc.)
logging.getLogger().setLevel(logging.WARNING)

# ── Router + feed imports (after env + logging setup) ─────────────────────────
from app.limiter import limiter  # noqa: E402
from app.routers import signals, traders, analytics, agent, polymarket, backtest  # noqa: E402
from app.feeds import signal_engine, price_cache  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("startup: launching market data refresh loop")
    refresh_task = asyncio.create_task(
        signal_engine.start_background_refresh(interval_seconds=60)
    )
    yield
    log.info("shutdown: stopping signal engine")
    signal_engine.stop()
    refresh_task.cancel()
    try:
        await refresh_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="BitPrivat Signal Service",
    description="AI-powered trading signal generation and trader analytics",
    version="0.2.0",
    lifespan=lifespan,
)

# Attach limiter immediately after app creation so it's available to decorators.
app.state.limiter = limiter


# ── Exception handlers ────────────────────────────────────────────────────────

if _SLOWAPI:
    @app.exception_handler(RateLimitExceeded)
    async def _rate_limit_handler(request: Request, exc) -> JSONResponse:
        retry = getattr(exc, "retry_after", 60)
        return JSONResponse(
            {"error": "rate_limit_exceeded", "retry_after": retry},
            status_code=429,
            headers={"Retry-After": str(retry)},
        )


@app.exception_handler(StarletteHTTPException)
async def _http_exc_handler(request: Request, exc: StarletteHTTPException):
    return await http_exception_handler(request, exc)


@app.exception_handler(ValueError)
@app.exception_handler(TypeError)
async def _validation_error_handler(request: Request, exc: Exception) -> JSONResponse:
    rid = getattr(request.state, "request_id", "unknown")
    log.warning(
        "Validation error",
        extra={"request_id": rid, "path": request.url.path, "detail": str(exc)},
    )
    return JSONResponse(
        {"error": "validation_error", "detail": str(exc), "request_id": rid},
        status_code=422,
    )


@app.exception_handler(Exception)
async def _unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    rid = getattr(request.state, "request_id", "unknown")
    log.error(
        "Unhandled exception",
        extra={
            "request_id": rid,
            "path": request.url.path,
            "method": request.method,
        },
        exc_info=True,
    )
    return JSONResponse(
        {"error": "internal_error", "request_id": rid},
        status_code=500,
    )


# ── Request-ID + timing middleware ────────────────────────────────────────────

@app.middleware("http")
async def _request_middleware(request: Request, call_next):
    rid = str(uuid.uuid4())[:8]
    request.state.request_id = rid
    t0 = time.monotonic()
    response = await call_next(request)
    ms = round((time.monotonic() - t0) * 1000)
    response.headers["X-Request-ID"] = rid
    log.info(
        "request",
        extra={
            "request_id": rid,
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "ms": ms,
        },
    )
    return response


# ── CORS ──────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:8080", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "signal-service",
        "version": "0.2.0",
        "data": price_cache.summary(),
    }


app.include_router(signals.router, prefix="/api/v1/signals", tags=["signals"])
app.include_router(traders.router, prefix="/api/v1/traders", tags=["traders"])
app.include_router(analytics.router, prefix="/api/v1/analytics", tags=["analytics"])
app.include_router(agent.router, prefix="/api/v1/agent", tags=["agent"])
app.include_router(polymarket.router, prefix="/api/v1/polymarket", tags=["polymarket"])
app.include_router(backtest.router, prefix="/api/v1/backtest", tags=["backtest"])
