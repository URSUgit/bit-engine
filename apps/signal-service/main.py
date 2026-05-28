import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path


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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import signals, traders, analytics, agent, polymarket, backtest
from app.feeds import signal_engine, price_cache


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[signal-service] starting up — launching market data refresh loop")
    refresh_task = asyncio.create_task(
        signal_engine.start_background_refresh(interval_seconds=60)
    )
    yield
    print("[signal-service] shutting down")
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:8080", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
