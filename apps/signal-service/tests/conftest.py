"""Shared fixtures for the signal-service test suite.

The env overrides MUST run before any `app.*` import: storage.py resolves its
DuckDB path at import time, and the dev server usually holds the default file's
write lock. Every test therefore runs against a throwaway per-session DB.
"""
import os
import sys
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="sigsvc-tests-"))
os.environ["BACKTEST_DUCKDB_PATH"] = str(_TMP / "bars.duckdb")
os.environ["BACKTEST_DB_PATH"] = str(_TMP / "legacy.db")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import random
from datetime import datetime, timedelta, timezone

import pytest


def make_bars(
    n: int = 400,
    start_price: float = 100.0,
    drift: float = 0.001,
    interval_hours: int = 24,
    seed: int = 42,
) -> list:
    """Deterministic random-walk OHLCV bars starting 2022-01-01 UTC."""
    from app.backtest.models import Bar

    rng = random.Random(seed)
    bars = []
    t = datetime(2022, 1, 1, tzinfo=timezone.utc)
    price = start_price
    for _ in range(n):
        o = price
        c = max(0.01, o * (1 + drift + rng.gauss(0, 0.02)))
        bars.append(
            Bar(
                timestamp=t,
                open=o,
                high=max(o, c) * 1.01,
                low=min(o, c) * 0.99,
                close=c,
                volume=1_000 + rng.random() * 100,
            )
        )
        price = c
        t += timedelta(hours=interval_hours)
    return bars


@pytest.fixture(scope="session")
def bars_400() -> list:
    return make_bars(400)


@pytest.fixture(scope="session")
def seeded_storage(bars_400):
    """Temp-DB bar storage pre-loaded with 400 daily BTCUSDT bars."""
    from app.backtest.storage import bar_storage

    bar_storage.upsert_bars("BTCUSDT", "1d", bars_400, "test_fixture")
    return bar_storage


@pytest.fixture(scope="session")
def client(seeded_storage):
    """TestClient over the real app. Lifespan (ingester, auto-seed, refresh
    loop) deliberately does NOT run — plain TestClient without a context
    manager skips startup events, keeping tests offline and fast."""
    from fastapi.testclient import TestClient

    from main import app

    return TestClient(app)
