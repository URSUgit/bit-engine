"""
Trade ledger — logs every decision, order, and result.
Tracks real P&L, win rate, and per-trade stats.
In-memory with optional JSON flush to disk.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

LEDGER_PATH = Path(os.getenv("POLYMARKET_LEDGER_PATH", "/tmp/polymarket_ledger.json"))

Status = Literal["open", "filled", "resolved_win", "resolved_loss", "cancelled", "dry_run"]


@dataclass
class TradeRecord:
    id: str
    market_id: str
    question: str
    side: str                   # YES | NO
    entry_price: float
    size_usdc: float
    breakeven_wr: float
    estimated_wr: float
    expected_value: float
    reason: str
    order_id: str
    dry_run: bool
    status: Status = "open"
    pnl_usdc: float = 0.0
    opened_at: float = field(default_factory=time.time)
    closed_at: float | None = None

    def close(self, won: bool) -> None:
        self.closed_at = time.time()
        if won:
            self.status = "resolved_win"
            self.pnl_usdc = round(self.size_usdc * (1 - self.entry_price) / self.entry_price, 4)
        else:
            self.status = "resolved_loss"
            self.pnl_usdc = -self.size_usdc


class Ledger:
    def __init__(self) -> None:
        self._trades: list[TradeRecord] = []
        self._load()

    # ─── Write ────────────────────────────────────────────────────────────────

    def add(self, trade: TradeRecord) -> None:
        self._trades.append(trade)
        self._flush()

    def resolve(self, trade_id: str, won: bool) -> TradeRecord | None:
        for t in self._trades:
            if t.id == trade_id:
                t.close(won)
                self._flush()
                return t
        return None

    # ─── Read ─────────────────────────────────────────────────────────────────

    def open_trades(self) -> list[TradeRecord]:
        return [t for t in self._trades if t.status in ("open", "filled")]

    def closed_trades(self) -> list[TradeRecord]:
        return [t for t in self._trades if t.status in ("resolved_win", "resolved_loss")]

    def summary(self) -> dict:
        closed = self.closed_trades()
        wins = [t for t in closed if t.status == "resolved_win"]
        losses = [t for t in closed if t.status == "resolved_loss"]
        total_pnl = sum(t.pnl_usdc for t in closed)
        avg_ev = sum(t.expected_value for t in self._trades) / max(len(self._trades), 1)
        return {
            "total_trades": len(self._trades),
            "open": len(self.open_trades()),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(len(wins) / max(len(closed), 1), 4),
            "total_pnl_usdc": round(total_pnl, 4),
            "avg_expected_value": round(avg_ev, 4),
            "dry_run_trades": sum(1 for t in self._trades if t.dry_run),
        }

    def recent(self, n: int = 20) -> list[dict]:
        return [asdict(t) for t in reversed(self._trades[-n:])]

    # ─── Persistence ──────────────────────────────────────────────────────────

    def _flush(self) -> None:
        try:
            LEDGER_PATH.write_text(json.dumps([asdict(t) for t in self._trades], indent=2))
        except Exception:
            pass

    def _load(self) -> None:
        if not LEDGER_PATH.exists():
            return
        try:
            raw = json.loads(LEDGER_PATH.read_text())
            self._trades = [TradeRecord(**r) for r in raw]
        except Exception:
            self._trades = []


_ledger = Ledger()


def get_ledger() -> Ledger:
    return _ledger
