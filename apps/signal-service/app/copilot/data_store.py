"""The persistence seam the agent talks through.

Nothing else in this package touches a database, a bot registry, or the
ledger — the agent only ever calls these four methods, so storage can change
without touching agent.py or system_prompt.py. `bit_engine_store.py` is the
real implementation; `InMemoryBotDataStore` exists so the loop can be tested
without a running bot.
"""
from __future__ import annotations

from typing import Protocol

from .types import BotSnapshot, ConfigParam, TradeRecord


class BotDataStore(Protocol):
    def get_bot_snapshot(self, bot_id: str) -> BotSnapshot:
        """Bot name, mode, and its full current tunable-parameter list."""
        ...

    def get_recent_trades(self, bot_id: str, limit: int = 100) -> list[TradeRecord]:
        """Closed + open positions, most recent first."""
        ...

    def get_open_positions(self, bot_id: str) -> list[TradeRecord]:
        """Currently held positions only, with unrealized P&L."""
        ...

    def apply_config_change(self, bot_id: str, parameter_key: str, new_value) -> ConfigParam:
        """Called only after a human confirms a proposal — never by the agent.
        Returns the updated parameter for confirmation."""
        ...


class InMemoryBotDataStore:
    """Toy store for exercising the agent loop without a live bot."""

    def __init__(self, snapshot: BotSnapshot, trades: list[TradeRecord]):
        self._snapshot = snapshot
        self._trades = trades

    def get_bot_snapshot(self, bot_id: str) -> BotSnapshot:
        if bot_id != self._snapshot.bot_id:
            raise KeyError(f"Unknown bot: {bot_id}")
        return self._snapshot

    def get_recent_trades(self, bot_id: str, limit: int = 100) -> list[TradeRecord]:
        return self._trades[:limit]

    def get_open_positions(self, bot_id: str) -> list[TradeRecord]:
        return [t for t in self._trades if t.is_open]

    def apply_config_change(self, bot_id: str, parameter_key: str, new_value) -> ConfigParam:
        for p in self._snapshot.config:
            if p.key == parameter_key:
                p.current_value = new_value
                return p
        raise KeyError(f"Unknown parameter key: {parameter_key}")
