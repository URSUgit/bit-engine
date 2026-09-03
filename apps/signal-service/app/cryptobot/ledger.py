"""Trade ledger for crypto trading bots — logs every fill (dry-run or real),
mirroring app/polymarket/ledger.py's JSON-flush pattern.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

LEDGER_PATH = Path(os.getenv("CRYPTOBOT_LEDGER_PATH", "data/cryptobot_trades.json"))


@dataclass
class BotTrade:
    id: str
    bot_id: str
    trader: str
    strategy: str
    symbol: str
    side: str            # BUY | SELL
    price: float
    qty: float
    quote_usd: float
    order_id: str
    dry_run: bool
    reason: str
    pnl_usd: float | None = None
    at: float = field(default_factory=time.time)


class Ledger:
    def __init__(self) -> None:
        self._trades: list[BotTrade] = []
        self._load()

    def add(self, trade: BotTrade) -> None:
        self._trades.append(trade)
        self._flush()

    def for_bot(self, bot_id: str, n: int = 50) -> list[dict]:
        matching = [t for t in self._trades if t.bot_id == bot_id]
        return [asdict(t) for t in reversed(matching[-n:])]

    def recent(self, n: int = 50) -> list[dict]:
        return [asdict(t) for t in reversed(self._trades[-n:])]

    def _flush(self) -> None:
        try:
            LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
            LEDGER_PATH.write_text(json.dumps([asdict(t) for t in self._trades], indent=2))
        except Exception:
            pass

    def _load(self) -> None:
        if not LEDGER_PATH.exists():
            return
        try:
            raw = json.loads(LEDGER_PATH.read_text())
            self._trades = [BotTrade(**r) for r in raw]
        except Exception:
            self._trades = []


_ledger = Ledger()


def get_ledger() -> Ledger:
    return _ledger
