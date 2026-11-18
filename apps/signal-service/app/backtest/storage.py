"""DuckDB cache for historical bars — columnar OLAP store, fast range scans.

DuckDB is an in-process analytical database. For OHLCV backtests it is a much
better fit than row-oriented SQLite: range queries over millions of bars scan
only the columns they touch, aggregations are vectorized, and the on-disk
format exports directly to Parquet for moving data between local and cloud.

The public API (``BarStorage`` + the module-level ``bar_storage`` singleton)
is unchanged, so every caller keeps working without edits. On first run we
best-effort migrate any existing SQLite cache into the new DuckDB file.
"""
from __future__ import annotations

import os
import sqlite3
import threading
from contextlib import contextmanager, nullcontext
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import numpy as np

from .models import Bar

# DuckDB lives alongside the old SQLite cache in the user data dir.
DEFAULT_DB_PATH = os.getenv(
    "BACKTEST_DUCKDB_PATH",
    str(Path.home() / ".bitprivat" / "backtest_cache.duckdb"),
)
# Legacy SQLite cache — migrated once into DuckDB if present.
LEGACY_SQLITE_PATH = os.getenv(
    "BACKTEST_DB_PATH",
    str(Path.home() / ".bitprivat" / "backtest_cache.db"),
)

# The backtest *history* store stays on SQLite (small, transactional, row-keyed
# by run id). It keeps its own file so the bar cache can be a DuckDB file. This
# preserves any history rows already written to the legacy cache file.
HISTORY_DB_PATH = LEGACY_SQLITE_PATH


class BarStorage:
    """Thread-safe DuckDB store for OHLCV bars keyed by (symbol, interval, ts)."""

    def __init__(self, db_path: str = DEFAULT_DB_PATH) -> None:
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        # One persistent connection guarded by the lock. DuckDB only allows a
        # single read-write process, and a connection is not safe to share
        # across threads concurrently — the lock serializes all access.
        self._con = duckdb.connect(self.db_path)
        self._init_schema()
        self._maybe_migrate_sqlite()

    @contextmanager
    def _conn(self):
        """Yield the shared connection under the lock (commits are implicit)."""
        with self._lock:
            yield self._con

    def _init_schema(self) -> None:
        with self._lock:
            self._con.execute(
                """
                CREATE TABLE IF NOT EXISTS bars (
                    symbol   VARCHAR NOT NULL,
                    interval VARCHAR NOT NULL,
                    ts       BIGINT  NOT NULL,
                    open     DOUBLE,
                    high     DOUBLE,
                    low      DOUBLE,
                    close    DOUBLE,
                    volume   DOUBLE,
                    PRIMARY KEY (symbol, interval, ts)
                )
                """
            )
            self._con.execute(
                """
                CREATE TABLE IF NOT EXISTS meta (
                    symbol   VARCHAR NOT NULL,
                    interval VARCHAR NOT NULL,
                    last_fetched_at BIGINT NOT NULL,
                    earliest_ts BIGINT,
                    latest_ts   BIGINT,
                    source   VARCHAR,
                    PRIMARY KEY (symbol, interval)
                )
                """
            )
            # Migration: add `source` to pre-existing meta tables that lack it.
            try:
                self._con.execute("ALTER TABLE meta ADD COLUMN source VARCHAR")
            except Exception:
                pass  # column already exists

    def _maybe_migrate_sqlite(self) -> None:
        """One-time import of an existing SQLite cache into DuckDB.

        Runs only if the DuckDB ``bars`` table is empty and a legacy SQLite
        file exists. Failures are swallowed — a missing/corrupt legacy cache
        just means we start fresh and re-fetch on demand.
        """
        try:
            with self._lock:
                count = self._con.execute("SELECT COUNT(*) FROM bars").fetchone()[0]
            if count and count > 0:
                return
            if not Path(LEGACY_SQLITE_PATH).exists():
                return

            src = sqlite3.connect(LEGACY_SQLITE_PATH)
            try:
                bar_rows = src.execute(
                    "SELECT symbol, interval, ts, open, high, low, close, volume FROM bars"
                ).fetchall()
                meta_rows = src.execute(
                    "SELECT symbol, interval, last_fetched_at, earliest_ts, latest_ts FROM meta"
                ).fetchall()
            finally:
                src.close()

            if not bar_rows:
                return
            with self._lock:
                self._con.executemany(
                    "INSERT OR REPLACE INTO bars VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    bar_rows,
                )
                if meta_rows:
                    self._con.executemany(
                        "INSERT OR REPLACE INTO meta VALUES (?, ?, ?, ?, ?)",
                        meta_rows,
                    )
        except Exception:
            # Best-effort only; never block startup on migration issues.
            pass

    # ── reads ────────────────────────────────────────────────────────────────

    def get_bars(
        self,
        symbol: str,
        interval: str,
        start_ts: int,
        end_ts: int,
    ) -> list[Bar]:
        with self._lock:
            rows = self._con.execute(
                """
                SELECT ts, open, high, low, close, volume
                FROM bars
                WHERE symbol = ? AND interval = ? AND ts BETWEEN ? AND ?
                ORDER BY ts ASC
                """,
                (symbol, interval, start_ts, end_ts),
            ).fetchall()
        return [
            Bar(
                timestamp=datetime.fromtimestamp(row[0]),
                open=row[1], high=row[2], low=row[3],
                close=row[4], volume=row[5] or 0,
            )
            for row in rows
        ]

    def get_meta(self, symbol: str, interval: str) -> dict | None:
        with self._lock:
            row = self._con.execute(
                "SELECT last_fetched_at, earliest_ts, latest_ts, source FROM meta WHERE symbol=? AND interval=?",
                (symbol, interval),
            ).fetchone()
        if not row:
            return None
        return {
            "last_fetched_at": row[0],
            "earliest_ts": row[1],
            "latest_ts": row[2],
            "source": row[3],
        }

    def list_symbols(self) -> list[dict]:
        with self._lock:
            rows = self._con.execute(
                """
                SELECT m.symbol, m.interval, m.earliest_ts, m.latest_ts,
                       (SELECT COUNT(*) FROM bars b
                        WHERE b.symbol=m.symbol AND b.interval=m.interval) AS bar_count,
                       m.last_fetched_at, m.source
                FROM meta m
                ORDER BY m.symbol, m.interval
                """
            ).fetchall()
        return [
            {
                "symbol": r[0],
                "interval": r[1],
                "earliest": datetime.fromtimestamp(r[2]).date().isoformat() if r[2] else None,
                "latest": datetime.fromtimestamp(r[3]).date().isoformat() if r[3] else None,
                "bar_count": r[4],
                "last_fetched_at": int(r[5]) if r[5] is not None else None,
                "source": r[6],
            }
            for r in rows
        ]

    def delete_bars(self, symbol: str, interval: str | None = None) -> None:
        """Remove cached bars (and meta) for a symbol, optionally by interval."""
        with self._lock:
            if interval is not None:
                self._con.execute(
                    "DELETE FROM bars WHERE symbol = ? AND interval = ?",
                    (symbol, interval),
                )
                self._con.execute(
                    "DELETE FROM meta WHERE symbol = ? AND interval = ?",
                    (symbol, interval),
                )
            else:
                self._con.execute("DELETE FROM bars WHERE symbol = ?", (symbol,))
                self._con.execute("DELETE FROM meta WHERE symbol = ?", (symbol,))

    def trim_bars_outside(
        self, symbol: str, interval: str, start_ts: int, end_ts: int, source: str,
    ) -> int:
        """Drop cached bars for this series that fall outside [start_ts, end_ts].

        For a loader that imports a source's *complete* history in one go,
        anything left beyond that range is a leftover from an earlier import
        rather than data the source still stands behind — `upsert_bars` only
        ever writes, so a shrunken or corrected range would otherwise leave
        orphans behind forever.

        Guarded by `source`: only trims a series this source already owns, so
        it can never delete bars another provider supplied. Returns the number
        of rows removed.
        """
        with self._lock:
            owner = self._con.execute(
                "SELECT source FROM meta WHERE symbol=? AND interval=?",
                (symbol, interval),
            ).fetchone()
            if owner is None or owner[0] != source:
                return 0
            removed = self._con.execute(
                "SELECT COUNT(*) FROM bars WHERE symbol=? AND interval=? "
                "AND (ts < ? OR ts > ?)",
                (symbol, interval, start_ts, end_ts),
            ).fetchone()[0]
            if removed:
                self._con.execute(
                    "DELETE FROM bars WHERE symbol=? AND interval=? AND (ts < ? OR ts > ?)",
                    (symbol, interval, start_ts, end_ts),
                )
                self._con.execute(
                    "UPDATE meta SET earliest_ts=?, latest_ts=? WHERE symbol=? AND interval=?",
                    (start_ts, end_ts, symbol, interval),
                )
            return int(removed)

    # ── writes ───────────────────────────────────────────────────────────────

    @contextmanager
    def _transaction(self):
        self._con.execute("BEGIN TRANSACTION")
        try:
            yield
            self._con.execute("COMMIT")
        except BaseException:
            self._con.execute("ROLLBACK")
            raise

    def upsert_bars(
        self, symbol: str, interval: str, bars: list[Bar], source: str | None = None,
        *, full_history: bool = False, replace_other_source: bool = False,
    ) -> int:
        """Write bars, optionally replacing a validated complete series atomically."""
        if full_history and not source:
            raise ValueError("A full-history import requires a data source")
        if not bars:
            return 0
        # Dedupe within the batch (last occurrence wins) — even INSERT OR
        # REPLACE raises if the inserted rows themselves repeat a key.
        by_ts = {b.ts: b for b in bars}
        if len(by_ts) != len(bars):
            bars = list(by_ts.values())
        tss = np.array([b.ts for b in bars], dtype=np.int64)
        new_min, new_max = int(tss.min()), int(tss.max())
        now = int(datetime.now(timezone.utc).timestamp())
        data = {
            "symbol":   np.array([symbol] * len(bars)),
            "interval": np.array([interval] * len(bars)),
            "ts":       tss,
            "open":     np.array([b.open for b in bars], dtype=np.float64),
            "high":     np.array([b.high for b in bars], dtype=np.float64),
            "low":      np.array([b.low  for b in bars], dtype=np.float64),
            "close":    np.array([b.close for b in bars], dtype=np.float64),
            "volume":   np.array([b.volume for b in bars], dtype=np.float64),
        }
        with self._lock, (self._transaction() if full_history else nullcontext()):
            # If real data is arriving where only synthetic demo bars were
            # cached, wipe the whole synthetic series first. Synthetic bars
            # aren't guaranteed to share exact timestamps with real ones (old
            # cache entries predate timestamp-grid alignment, or a provider's
            # bar boundaries don't line up), so a plain ts-collision DELETE
            # below isn't enough — leftover synthetic rows would otherwise
            # sit alongside real ones forever and corrupt every backtest that
            # reads this (symbol, interval).
            source_rows = self._con.execute(
                "SELECT source FROM meta WHERE symbol=? AND interval=?",
                (symbol, interval),
            ).fetchall()
            # Drain the result before registering the bulk input on DuckDB 2.
            existing_source = source_rows[0] if source_rows else None
            wiped_synthetic = (
                source is not None
                and source != "synthetic_gbm"
                and existing_source is not None
                and existing_source[0] == "synthetic_gbm"
            )
            if full_history and not replace_other_source:
                if existing_source is None:
                    owner = None
                    populated = bool(self._con.execute(
                        "SELECT 1 FROM bars WHERE symbol=? AND interval=? LIMIT 1", (symbol, interval),
                    ).fetchall())
                else:
                    owner = existing_source[0]
                    populated = True
                if populated and owner not in (source, "synthetic_gbm"):
                    raise ValueError(f"{symbol} {interval} already has {owner or 'unknown-source'} prices; kept existing data")
            if wiped_synthetic and not full_history:
                self._con.execute(
                    "DELETE FROM bars WHERE symbol=? AND interval=?", (symbol, interval)
                )
            self._con.register("_tmp_bars", data)
            try:
                if full_history and existing_source == (source,):
                    missing = self._con.execute(
                        "SELECT ts, close, volume FROM bars WHERE symbol=? AND interval=? "
                        "AND ts NOT IN (SELECT ts FROM _tmp_bars) LIMIT 2",
                        (symbol, interval),
                    ).fetchall()
                    # Coin Metrics' old parser could fabricate one trailing bar
                    # by repeating the final aligned close on the following day.
                    known_lagged_close = (
                        source == "coinmetrics" and interval == "1d"
                        and missing == [(new_max + 86_400, by_ts[new_max].close, 0.0)]
                    )
                    if missing and not known_lagged_close:
                        raise ValueError(f"{symbol} {interval} snapshot is incomplete; kept existing data")
                if not full_history:
                    self._con.execute(
                        "DELETE FROM bars WHERE symbol=? AND interval=? AND ts IN (SELECT ts FROM _tmp_bars)",
                        (symbol, interval),
                    )
                self._con.execute("INSERT OR REPLACE INTO bars SELECT * FROM _tmp_bars")
                if full_history:
                    # Retain incoming keys; deleting and reinserting the same key
                    # inside one DuckDB transaction can lose the replacement row.
                    self._con.execute(
                        "DELETE FROM bars WHERE symbol=? AND interval=? AND ts NOT IN (SELECT ts FROM _tmp_bars)",
                        (symbol, interval),
                    )
            finally:
                self._con.unregister("_tmp_bars")
            # Update meta range (and provenance). Preserve an existing source
            # when this call doesn't specify one (e.g. an incremental top-up).
            existing = self._con.execute(
                "SELECT earliest_ts, latest_ts, source FROM meta WHERE symbol=? AND interval=?",
                (symbol, interval),
            ).fetchone()
            if existing and existing[0] is not None and not (full_history or wiped_synthetic):
                earliest = min(existing[0], new_min)
                latest = max(existing[1], new_max)
                resolved_source = source if source is not None else existing[2]
            else:
                earliest, latest = new_min, new_max
                resolved_source = source
            self._con.execute(
                """
                INSERT OR REPLACE INTO meta
                    (symbol, interval, last_fetched_at, earliest_ts, latest_ts, source)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (symbol, interval, now, earliest, latest, resolved_source),
            )
        return len(bars)

    # ── export ─────────────────────────────────────────────────────────────

    def export_parquet(self, out_dir: str) -> str:
        """Dump the bars table to a Parquet file for cloud/local transfer.

        Returns the path written. Parquet keeps DuckDB's columnar layout and is
        readable by pandas, Spark, BigQuery, and DuckDB itself.
        """
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        out_path = str(Path(out_dir) / "bars.parquet")
        with self._lock:
            self._con.execute(
                f"COPY (SELECT * FROM bars ORDER BY symbol, interval, ts) "
                f"TO '{out_path}' (FORMAT PARQUET)"
            )
        return out_path


# Module-level singleton
bar_storage = BarStorage()
