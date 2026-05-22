import asyncio
from contextlib import asynccontextmanager

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
