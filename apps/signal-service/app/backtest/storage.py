"""SQLite cache for historical bars — keeps backtests fast after first fetch."""
from __future__ import annotations

import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from .models import Bar

# Cache lives in user data dir so it persists across restarts
DEFAULT_DB_PATH = os.getenv(
    "BACKTEST_DB_PATH",
    str(Path.home() / ".bitprivat" / "backtest_cache.db"),
)


class BarStorage:
    """Thread-safe SQLite store for OHLCV bars keyed by (symbol, interval, timestamp)."""

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
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS bars (
                    symbol   TEXT NOT NULL,
                    interval TEXT NOT NULL,
                    ts       INTEGER NOT NULL,
                    open     REAL,
                    high     REAL,
                    low      REAL,
                    close    REAL,
                    volume   REAL,
                    PRIMARY KEY (symbol, interval, ts)
                )
                """
            )
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS meta (
                    symbol   TEXT NOT NULL,
                    interval TEXT NOT NULL,
                    last_fetched_at INTEGER NOT NULL,
                    earliest_ts INTEGER,
                    latest_ts   INTEGER,
                    PRIMARY KEY (symbol, interval)
                )
                """
            )

    # ── reads ────────────────────────────────────────────────────────────────

    def get_bars(
        self,
        symbol: str,
        interval: str,
        start_ts: int,
        end_ts: int,
    ) -> list[Bar]:
        with self._conn() as con:
            cur = con.execute(
                """
                SELECT ts, open, high, low, close, volume
                FROM bars
                WHERE symbol = ? AND interval = ? AND ts BETWEEN ? AND ?
                ORDER BY ts ASC
                """,
                (symbol, interval, start_ts, end_ts),
            )
            return [
                Bar(
                    timestamp=datetime.fromtimestamp(row[0]),
                    open=row[1], high=row[2], low=row[3],
                    close=row[4], volume=row[5] or 0,
                )
                for row in cur.fetchall()
            ]

    def get_meta(self, symbol: str, interval: str) -> dict | None:
        with self._conn() as con:
            cur = con.execute(
                "SELECT last_fetched_at, earliest_ts, latest_ts FROM meta WHERE symbol=? AND interval=?",
                (symbol, interval),
            )
            row = cur.fetchone()
            if not row:
                return None
            return {
                "last_fetched_at": row[0],
                "earliest_ts": row[1],
                "latest_ts": row[2],
            }

    def list_symbols(self) -> list[dict]:
        with self._conn() as con:
            cur = con.execute(
                """
                SELECT symbol, interval, earliest_ts, latest_ts,
                       (SELECT COUNT(*) FROM bars b WHERE b.symbol=m.symbol AND b.interval=m.interval) AS bar_count
                FROM meta m
                ORDER BY symbol, interval
                """
            )
            return [
                {
                    "symbol": r[0],
                    "interval": r[1],
                    "earliest": datetime.fromtimestamp(r[2]).date().isoformat() if r[2] else None,
                    "latest": datetime.fromtimestamp(r[3]).date().isoformat() if r[3] else None,
                    "bar_count": r[4],
                }
                for r in cur.fetchall()
            ]

    # ── writes ───────────────────────────────────────────────────────────────

    def upsert_bars(self, symbol: str, interval: str, bars: list[Bar]) -> int:
        if not bars:
            return 0
        rows = [
            (symbol, interval, b.ts, b.open, b.high, b.low, b.close, b.volume)
            for b in bars
        ]
        with self._conn() as con:
            con.executemany(
                """
                INSERT OR REPLACE INTO bars (symbol, interval, ts, open, high, low, close, volume)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            tss = [b.ts for b in bars]
            con.execute(
                """
                INSERT INTO meta (symbol, interval, last_fetched_at, earliest_ts, latest_ts)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(symbol, interval) DO UPDATE SET
                    last_fetched_at = excluded.last_fetched_at,
                    earliest_ts = MIN(meta.earliest_ts, excluded.earliest_ts),
                    latest_ts   = MAX(meta.latest_ts,   excluded.latest_ts)
                """,
                (symbol, interval, int(datetime.utcnow().timestamp()), min(tss), max(tss)),
            )
        return len(rows)


# Module-level singleton
bar_storage = BarStorage()
