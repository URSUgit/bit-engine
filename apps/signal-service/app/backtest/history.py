"""Persistent backtest results history — SQLite-backed, shareable by ID."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path

from .models import BacktestResult
from .storage import DEFAULT_DB_PATH


class BacktestHistory:
    """Stores every backtest run so users can browse and re-open results."""

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
                CREATE TABLE IF NOT EXISTS backtest_runs (
                    id TEXT PRIMARY KEY,
                    created_at INTEGER NOT NULL,
                    symbol TEXT NOT NULL,
                    strategy TEXT NOT NULL,
                    interval TEXT NOT NULL,
                    start_date TEXT,
                    end_date TEXT,
                    total_return_pct REAL,
                    sharpe REAL,
                    max_drawdown_pct REAL,
                    total_trades INTEGER,
                    result_json TEXT NOT NULL
                )
                """
            )
            con.execute(
                "CREATE INDEX IF NOT EXISTS idx_backtest_runs_created ON backtest_runs(created_at DESC)"
            )
            con.execute(
                "CREATE INDEX IF NOT EXISTS idx_backtest_runs_symbol ON backtest_runs(symbol)"
            )

    def save(self, result: BacktestResult) -> str:
        """Persist a run, returns its id."""
        m = result.metrics
        with self._conn() as con:
            con.execute(
                """
                INSERT OR REPLACE INTO backtest_runs
                (id, created_at, symbol, strategy, interval, start_date, end_date,
                 total_return_pct, sharpe, max_drawdown_pct, total_trades, result_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    result.id, int(time.time()),
                    result.symbol, result.strategy, result.interval,
                    result.start_date, result.end_date,
                    m.total_return_pct, m.sharpe_ratio, m.max_drawdown_pct, m.total_trades,
                    result.model_dump_json(),
                ),
            )
        return result.id

    def get(self, run_id: str) -> dict | None:
        with self._conn() as con:
            cur = con.execute(
                "SELECT result_json FROM backtest_runs WHERE id = ?",
                (run_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            return json.loads(row[0])

    def list(self, limit: int = 50, symbol: str | None = None) -> list[dict]:
        """List recent runs as summary dicts (no full result payload)."""
        with self._conn() as con:
            if symbol:
                cur = con.execute(
                    """
                    SELECT id, created_at, symbol, strategy, interval,
                           start_date, end_date, total_return_pct, sharpe,
                           max_drawdown_pct, total_trades
                    FROM backtest_runs
                    WHERE symbol = ?
                    ORDER BY created_at DESC
                    LIMIT ?
                    """,
                    (symbol, limit),
                )
            else:
                cur = con.execute(
                    """
                    SELECT id, created_at, symbol, strategy, interval,
                           start_date, end_date, total_return_pct, sharpe,
                           max_drawdown_pct, total_trades
                    FROM backtest_runs
                    ORDER BY created_at DESC
                    LIMIT ?
                    """,
                    (limit,),
                )
            return [
                {
                    "id": r[0], "created_at": r[1], "symbol": r[2], "strategy": r[3],
                    "interval": r[4], "start_date": r[5], "end_date": r[6],
                    "total_return_pct": r[7], "sharpe": r[8],
                    "max_drawdown_pct": r[9], "total_trades": r[10],
                }
                for r in cur.fetchall()
            ]

    def delete(self, run_id: str) -> bool:
        with self._conn() as con:
            cur = con.execute("DELETE FROM backtest_runs WHERE id = ?", (run_id,))
            return cur.rowcount > 0


backtest_history = BacktestHistory()
