"""SQLite-backed paper trading wallet."""
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Optional, List

PAPER_DB = str(Path.home() / ".bitprivat" / "paper_trading.db")


@dataclass
class PaperPosition:
    id: str
    symbol: str
    side: str          # "long" | "short"
    entry_price: float
    size: float        # units of asset
    notional: float    # entry_price * size
    opened_at: str     # ISO timestamp
    strategy: str      # which strategy opened it (or "manual")
    notes: str


@dataclass
class PaperTrade:
    id: str
    symbol: str
    side: str
    entry_price: float
    exit_price: float
    size: float
    pnl: float
    pnl_pct: float
    opened_at: str
    closed_at: str
    strategy: str
    notes: str


class PaperStore:
    def __init__(self, db_path: str = PAPER_DB):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db_path = db_path
        self._lock = threading.Lock()
        self._init()

    @contextmanager
    def _conn(self):
        con = sqlite3.connect(self.db_path)
        con.row_factory = sqlite3.Row
        try:
            yield con
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()

    def _init(self):
        with self._conn() as con:
            con.execute("""
                CREATE TABLE IF NOT EXISTS positions (
                    id          TEXT PRIMARY KEY,
                    symbol      TEXT NOT NULL,
                    side        TEXT NOT NULL,
                    entry_price REAL NOT NULL,
                    size        REAL NOT NULL,
                    notional    REAL NOT NULL,
                    opened_at   TEXT NOT NULL,
                    strategy    TEXT NOT NULL DEFAULT 'manual',
                    notes       TEXT NOT NULL DEFAULT ''
                )
            """)
            con.execute("""
                CREATE TABLE IF NOT EXISTS trades (
                    id          TEXT PRIMARY KEY,
                    symbol      TEXT NOT NULL,
                    side        TEXT NOT NULL,
                    entry_price REAL NOT NULL,
                    exit_price  REAL NOT NULL,
                    size        REAL NOT NULL,
                    pnl         REAL NOT NULL,
                    pnl_pct     REAL NOT NULL,
                    opened_at   TEXT NOT NULL,
                    closed_at   TEXT NOT NULL,
                    strategy    TEXT NOT NULL DEFAULT 'manual',
                    notes       TEXT NOT NULL DEFAULT ''
                )
            """)

    def open_position(
        self,
        symbol: str,
        side: str,
        entry_price: float,
        size: float,
        strategy: str = "manual",
        notes: str = "",
    ) -> PaperPosition:
        pos = PaperPosition(
            id=str(uuid.uuid4()),
            symbol=symbol.upper(),
            side=side,
            entry_price=entry_price,
            size=size,
            notional=round(entry_price * size, 6),
            opened_at=_iso_now(),
            strategy=strategy,
            notes=notes,
        )
        with self._conn() as con:
            con.execute(
                "INSERT INTO positions VALUES (?,?,?,?,?,?,?,?,?)",
                (pos.id, pos.symbol, pos.side, pos.entry_price, pos.size,
                 pos.notional, pos.opened_at, pos.strategy, pos.notes),
            )
        return pos

    def close_position(self, position_id: str, exit_price: float) -> Optional[PaperTrade]:
        with self._conn() as con:
            row = con.execute(
                "SELECT * FROM positions WHERE id=?", (position_id,)
            ).fetchone()
            if not row:
                return None

            pos = PaperPosition(**dict(row))
            # P&L calculation
            if pos.side == "long":
                pnl = (exit_price - pos.entry_price) * pos.size
            else:
                pnl = (pos.entry_price - exit_price) * pos.size

            pnl_pct = (pnl / pos.notional) * 100 if pos.notional else 0.0

            trade = PaperTrade(
                id=str(uuid.uuid4()),
                symbol=pos.symbol,
                side=pos.side,
                entry_price=pos.entry_price,
                exit_price=exit_price,
                size=pos.size,
                pnl=round(pnl, 6),
                pnl_pct=round(pnl_pct, 4),
                opened_at=pos.opened_at,
                closed_at=_iso_now(),
                strategy=pos.strategy,
                notes=pos.notes,
            )

            con.execute("DELETE FROM positions WHERE id=?", (position_id,))
            con.execute(
                "INSERT INTO trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (trade.id, trade.symbol, trade.side, trade.entry_price,
                 trade.exit_price, trade.size, trade.pnl, trade.pnl_pct,
                 trade.opened_at, trade.closed_at, trade.strategy, trade.notes),
            )
        return trade

    def list_positions(self) -> List[PaperPosition]:
        with self._conn() as con:
            rows = con.execute(
                "SELECT * FROM positions ORDER BY opened_at DESC"
            ).fetchall()
        return [PaperPosition(**dict(r)) for r in rows]

    def list_trades(self, limit: int = 50) -> List[PaperTrade]:
        with self._conn() as con:
            rows = con.execute(
                "SELECT * FROM trades ORDER BY closed_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [PaperTrade(**dict(r)) for r in rows]

    def update_notes(self, position_id: str, notes: str) -> bool:
        with self._conn() as con:
            cur = con.execute(
                "UPDATE positions SET notes=? WHERE id=?", (notes, position_id)
            )
        return cur.rowcount > 0

    def get_summary(self) -> dict:
        with self._conn() as con:
            trades_rows = con.execute("SELECT pnl FROM trades").fetchall()
            open_count = con.execute("SELECT COUNT(*) FROM positions").fetchone()[0]

        total_pnl = sum(r[0] for r in trades_rows)
        total_trades = len(trades_rows)
        wins = sum(1 for r in trades_rows if r[0] > 0)
        win_rate = (wins / total_trades * 100) if total_trades else 0.0
        balance_start = 10_000.0
        balance_current = balance_start + total_pnl

        return {
            "total_pnl": round(total_pnl, 4),
            "total_trades": total_trades,
            "win_rate": round(win_rate, 2),
            "open_positions": open_count,
            "balance_start": balance_start,
            "balance_current": round(balance_current, 4),
        }


def _iso_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
