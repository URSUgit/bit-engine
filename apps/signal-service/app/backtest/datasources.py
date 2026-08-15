"""
Alternative data registry — FRED macro, Fear & Greed, Binance funding / OI,
and tick-level aggTrades. All backed by the same SQLite cache as BarStorage.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger(__name__)

DEFAULT_DB_PATH = os.getenv(
    "BACKTEST_DB_PATH",
    str(Path.home() / ".bitprivat" / "backtest_cache.db"),
)

FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
BINANCE_FUTURES = "https://fapi.binance.com"
FEAR_GREED_URL = "https://api.alternative.me/fng/"

# FRED series used for macro context
FRED_SERIES = {
    "DFF":   "Fed Funds Rate (daily)",
    "T10YIE": "10Y Breakeven Inflation",
    "VIXCLS": "CBOE VIX (daily)",
    "M2SL":  "M2 Money Supply (monthly)",
    "CPIAUCSL": "CPI All Items (monthly)",
    "UNRATE": "Unemployment Rate (monthly)",
}


# ── SQLite store ──────────────────────────────────────────────────────────────

class AltDataStorage:
    """Extend the existing backtest SQLite DB with alt_data and alt_meta tables."""

    def __init__(self, db_path: str = DEFAULT_DB_PATH) -> None:
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_schema()

    @contextmanager
    def _conn(self):
        with self._lock:
            con = sqlite3.connect(self.db_path)
            con.execute("PRAGMA journal_mode=WAL")
            try:
                yield con
                con.commit()
            finally:
                con.close()

    def _init_schema(self) -> None:
        with self._conn() as con:
            con.execute("""
                CREATE TABLE IF NOT EXISTS alt_data (
                    datasource TEXT NOT NULL,
                    key        TEXT NOT NULL,
                    ts         INTEGER NOT NULL,
                    value      REAL,
                    meta       TEXT,
                    PRIMARY KEY (datasource, key, ts)
                )
            """)
            con.execute("""
                CREATE TABLE IF NOT EXISTS alt_meta (
                    datasource  TEXT NOT NULL,
                    key         TEXT NOT NULL,
                    earliest_ts INTEGER,
                    latest_ts   INTEGER,
                    updated_at  INTEGER,
                    PRIMARY KEY (datasource, key)
                )
            """)
            con.execute("CREATE INDEX IF NOT EXISTS idx_alt_ts ON alt_data(datasource, key, ts)")

    def get(
        self,
        datasource: str,
        key: str,
        start_ts: int | None = None,
        end_ts: int | None = None,
    ) -> list[dict]:
        q = "SELECT ts, value, meta FROM alt_data WHERE datasource=? AND key=?"
        args: list[Any] = [datasource, key]
        if start_ts is not None:
            q += " AND ts >= ?"
            args.append(start_ts)
        if end_ts is not None:
            q += " AND ts <= ?"
            args.append(end_ts)
        q += " ORDER BY ts"
        with self._conn() as con:
            cur = con.execute(q, args)
            return [{"ts": r[0], "value": r[1], "meta": r[2]} for r in cur.fetchall()]

    def upsert(self, datasource: str, key: str, rows: list[dict]) -> int:
        if not rows:
            return 0
        with self._conn() as con:
            con.executemany(
                "INSERT OR REPLACE INTO alt_data (datasource, key, ts, value, meta) VALUES (?,?,?,?,?)",
                [(datasource, key, r["ts"], r.get("value"), r.get("meta")) for r in rows],
            )
            tss = [r["ts"] for r in rows]
            con.execute("""
                INSERT INTO alt_meta (datasource, key, earliest_ts, latest_ts, updated_at)
                VALUES (?,?,?,?,?)
                ON CONFLICT(datasource, key) DO UPDATE SET
                    earliest_ts = MIN(alt_meta.earliest_ts, excluded.earliest_ts),
                    latest_ts   = MAX(alt_meta.latest_ts,   excluded.latest_ts),
                    updated_at  = excluded.updated_at
            """, (datasource, key, min(tss), max(tss), int(time.time())))
        return len(rows)

    def get_meta(self, datasource: str, key: str) -> dict | None:
        with self._conn() as con:
            cur = con.execute(
                "SELECT earliest_ts, latest_ts, updated_at FROM alt_meta WHERE datasource=? AND key=?",
                (datasource, key),
            )
            row = cur.fetchone()
            if row is None:
                return None
            return {"earliest_ts": row[0], "latest_ts": row[1], "updated_at": row[2]}

    def list_all(self) -> list[dict]:
        with self._conn() as con:
            cur = con.execute("""
                SELECT m.datasource, m.key,
                       m.earliest_ts, m.latest_ts, m.updated_at,
                       COUNT(d.ts) AS record_count
                FROM alt_meta m
                LEFT JOIN alt_data d ON d.datasource=m.datasource AND d.key=m.key
                GROUP BY m.datasource, m.key
                ORDER BY m.datasource, m.key
            """)
            return [
                {
                    "datasource": r[0],
                    "key": r[1],
                    "earliest": datetime.fromtimestamp(r[2], tz=timezone.utc).date().isoformat() if r[2] else None,
                    "latest": datetime.fromtimestamp(r[3], tz=timezone.utc).date().isoformat() if r[3] else None,
                    "updated_at": r[4],
                    "record_count": r[5],
                }
                for r in cur.fetchall()
            ]


_alt_storage = AltDataStorage()


# ── Fear & Greed ──────────────────────────────────────────────────────────────

async def fetch_fear_greed(days_back: int = 365) -> list[dict]:
    """Fetch crypto Fear & Greed index (0-100). Cached in SQLite."""
    key = "crypto"
    ds = "fear_greed"
    meta = await asyncio.to_thread(_alt_storage.get_meta, ds, key)
    cutoff = int(time.time()) - 3600 * 6  # refresh every 6h

    if meta and meta["updated_at"] and meta["updated_at"] > cutoff:
        start_ts = int(time.time()) - days_back * 86400
        return await asyncio.to_thread(_alt_storage.get, ds, key, start_ts=start_ts)

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(FEAR_GREED_URL, params={"limit": max(days_back, 365), "format": "json"})
            r.raise_for_status()
            data = r.json().get("data", [])
    except Exception as e:
        log.warning("Fear & Greed fetch failed: %s", e)
        return await asyncio.to_thread(_alt_storage.get, ds, key)

    rows = [
        {
            "ts": int(item["timestamp"]),
            "value": float(item["value"]),
            "meta": item.get("value_classification", ""),
        }
        for item in data
        if "timestamp" in item and "value" in item
    ]
    if rows:
        await asyncio.to_thread(_alt_storage.upsert, ds, key, rows)

    start_ts = int(time.time()) - days_back * 86400
    return await asyncio.to_thread(_alt_storage.get, ds, key, start_ts=start_ts)


# ── FRED macro ────────────────────────────────────────────────────────────────

async def fetch_fred_series(
    series_id: str,
    start_date: str = "2015-01-01",
    end_date: str | None = None,
    api_key: str | None = None,
) -> list[dict]:
    """Fetch a FRED data series and cache it."""
    api_key = api_key or os.getenv("FRED_API_KEY", "")
    if not api_key:
        log.warning("FRED_API_KEY not set; skipping macro fetch for %s", series_id)
        return []

    ds = "fred"
    key = series_id
    meta = await asyncio.to_thread(_alt_storage.get_meta, ds, key)
    cutoff = int(time.time()) - 3600 * 24  # refresh daily

    if meta and meta["updated_at"] and meta["updated_at"] > cutoff:
        start_ts = int(datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc).timestamp())
        return await asyncio.to_thread(_alt_storage.get, ds, key, start_ts=start_ts)

    end_str = end_date or datetime.utcnow().date().isoformat()
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(FRED_BASE, params={
                "series_id": series_id,
                "api_key": api_key,
                "file_type": "json",
                "observation_start": start_date,
                "observation_end": end_str,
            })
            r.raise_for_status()
            obs = r.json().get("observations", [])
    except Exception as e:
        log.warning("FRED fetch failed for %s: %s", series_id, e)
        start_ts = int(datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc).timestamp())
        return await asyncio.to_thread(_alt_storage.get, ds, key, start_ts=start_ts)

    rows = []
    for o in obs:
        try:
            ts = int(datetime.fromisoformat(o["date"]).replace(tzinfo=timezone.utc).timestamp())
            val = float(o["value"]) if o["value"] not in (".", "") else None
            if val is not None:
                rows.append({"ts": ts, "value": val})
        except (ValueError, KeyError):
            continue

    if rows:
        await asyncio.to_thread(_alt_storage.upsert, ds, key, rows)

    start_ts = int(datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc).timestamp())
    return await asyncio.to_thread(_alt_storage.get, ds, key, start_ts=start_ts)


# ── Binance Futures funding rates ─────────────────────────────────────────────

async def fetch_funding_rates(
    symbol: str = "BTCUSDT",
    start_ts: int | None = None,
    end_ts: int | None = None,
    limit: int = 1000,
) -> list[dict]:
    """Fetch Binance perpetual funding rates. Cached in SQLite."""
    ds = "funding_rate"
    key = symbol.upper()
    end_ts = end_ts or int(time.time() * 1000)
    start_ts = start_ts or (end_ts - 90 * 24 * 3600 * 1000)

    meta = await asyncio.to_thread(_alt_storage.get_meta, ds, key)
    cutoff = int(time.time()) - 3600 * 8  # funding updates every 8h

    cached = await asyncio.to_thread(_alt_storage.get, ds, key, start_ts=start_ts // 1000, end_ts=end_ts // 1000)
    if meta and meta["updated_at"] and meta["updated_at"] > cutoff and cached:
        return cached

    all_rows: list[dict] = []
    fetch_start = start_ts
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            while True:
                r = await client.get(
                    f"{BINANCE_FUTURES}/fapi/v1/fundingRate",
                    params={"symbol": key, "startTime": fetch_start, "endTime": end_ts, "limit": limit},
                )
                if r.status_code != 200:
                    break
                data = r.json()
                if not data:
                    break
                for item in data:
                    all_rows.append({
                        "ts": item["fundingTime"] // 1000,
                        "value": float(item["fundingRate"]),
                    })
                if len(data) < limit:
                    break
                fetch_start = data[-1]["fundingTime"] + 1
    except Exception as e:
        log.warning("Binance funding rate fetch failed for %s: %s", symbol, e)

    if all_rows:
        await asyncio.to_thread(_alt_storage.upsert, ds, key, all_rows)

    return await asyncio.to_thread(_alt_storage.get, ds, key, start_ts=start_ts // 1000, end_ts=end_ts // 1000)


# ── Binance Open Interest ─────────────────────────────────────────────────────

async def fetch_open_interest(
    symbol: str = "BTCUSDT",
    interval: str = "1h",
    start_ts: int | None = None,
    end_ts: int | None = None,
) -> list[dict]:
    """Fetch Binance futures open interest history."""
    ds = "open_interest"
    key = f"{symbol.upper()}_{interval}"
    end_ts = end_ts or int(time.time() * 1000)
    start_ts = start_ts or (end_ts - 30 * 24 * 3600 * 1000)

    meta = await asyncio.to_thread(_alt_storage.get_meta, ds, key)
    cutoff = int(time.time()) - 3600  # refresh hourly

    cached = await asyncio.to_thread(_alt_storage.get, ds, key, start_ts=start_ts // 1000, end_ts=end_ts // 1000)
    if meta and meta["updated_at"] and meta["updated_at"] > cutoff and cached:
        return cached

    all_rows: list[dict] = []
    fetch_start = start_ts
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            while True:
                r = await client.get(
                    f"{BINANCE_FUTURES}/futures/data/openInterestHist",
                    params={
                        "symbol": symbol.upper(),
                        "period": interval,
                        "startTime": fetch_start,
                        "endTime": end_ts,
                        "limit": 500,
                    },
                )
                if r.status_code != 200:
                    break
                data = r.json()
                if not data or isinstance(data, dict):
                    break
                for item in data:
                    all_rows.append({
                        "ts": item["timestamp"] // 1000,
                        "value": float(item.get("sumOpenInterestValue", item.get("sumOpenInterest", 0))),
                    })
                if len(data) < 500:
                    break
                fetch_start = data[-1]["timestamp"] + 1
    except Exception as e:
        log.warning("Binance OI fetch failed for %s: %s", symbol, e)

    if all_rows:
        await asyncio.to_thread(_alt_storage.upsert, ds, key, all_rows)

    return await asyncio.to_thread(_alt_storage.get, ds, key, start_ts=start_ts // 1000, end_ts=end_ts // 1000)


# ── Binance aggTrades (tick data) ─────────────────────────────────────────────

async def fetch_agg_trades(
    symbol: str = "BTCUSDT",
    start_ts_ms: int | None = None,
    end_ts_ms: int | None = None,
    max_records: int = 50_000,
) -> list[dict]:
    """
    Fetch Binance aggregate trades (best free tick data).
    Returns list of {ts_ms, price, qty, is_buyer_maker}.
    NOTE: Not cached in SQLite (volume makes caching impractical);
          use only for short intraday windows.
    """
    SPOT_BASE = "https://api.binance.com"
    end_ts_ms = end_ts_ms or int(time.time() * 1000)
    start_ts_ms = start_ts_ms or (end_ts_ms - 3600_000)  # 1h default

    all_trades: list[dict] = []
    fetch_from = start_ts_ms

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            while len(all_trades) < max_records:
                r = await client.get(
                    f"{SPOT_BASE}/api/v3/aggTrades",
                    params={
                        "symbol": symbol.upper(),
                        "startTime": fetch_from,
                        "endTime": min(fetch_from + 3_600_000, end_ts_ms),
                        "limit": 1000,
                    },
                )
                if r.status_code != 200:
                    break
                data = r.json()
                if not data:
                    break
                for t in data:
                    all_trades.append({
                        "ts_ms": t["T"],
                        "price": float(t["p"]),
                        "qty": float(t["q"]),
                        "is_buyer_maker": t["m"],
                    })
                if len(data) < 1000:
                    break
                fetch_from = data[-1]["T"] + 1
                if fetch_from >= end_ts_ms:
                    break
    except Exception as e:
        log.warning("aggTrades fetch failed for %s: %s", symbol, e)

    return all_trades[:max_records]


# ── Unified DataRegistry ──────────────────────────────────────────────────────

class DataRegistry:
    """
    Unified access to all alternative data sources with caching.
    Import and use the module-level singleton `data_registry`.
    """

    def fear_greed(self, days_back: int = 365) -> list[dict]:
        import asyncio
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(fetch_fear_greed(days_back))
        finally:
            loop.close()

    def fred(
        self,
        series_id: str,
        start_date: str = "2015-01-01",
        end_date: str | None = None,
        api_key: str | None = None,
    ) -> list[dict]:
        import asyncio
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(
                fetch_fred_series(series_id, start_date, end_date, api_key)
            )
        finally:
            loop.close()

    def funding_rates(
        self,
        symbol: str = "BTCUSDT",
        start_ts: int | None = None,
        end_ts: int | None = None,
    ) -> list[dict]:
        import asyncio
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(fetch_funding_rates(symbol, start_ts, end_ts))
        finally:
            loop.close()

    def open_interest(
        self,
        symbol: str = "BTCUSDT",
        interval: str = "1h",
        start_ts: int | None = None,
        end_ts: int | None = None,
    ) -> list[dict]:
        import asyncio
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(fetch_open_interest(symbol, interval, start_ts, end_ts))
        finally:
            loop.close()

    def agg_trades(
        self,
        symbol: str = "BTCUSDT",
        start_ts_ms: int | None = None,
        end_ts_ms: int | None = None,
        max_records: int = 50_000,
    ) -> list[dict]:
        import asyncio
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(
                fetch_agg_trades(symbol, start_ts_ms, end_ts_ms, max_records)
            )
        finally:
            loop.close()

    def list_available(self) -> list[dict]:
        return _alt_storage.list_all()

    @property
    def fred_series(self) -> dict[str, str]:
        return FRED_SERIES


data_registry = DataRegistry()
