"""Data contracts for the bot config copilot.

Framework-agnostic dataclasses (no ORM/DB imports) so the agent logic stays
independent of how bots and trades are actually stored. `bit_engine_store.py`
adapts these to this repo's CryptoBot + ledger.

Money is USD throughout, matching the cryptobot ledger (`quote_usd`,
`pnl_usd`). The system prompt asks the model to cite P&L "and its unit", so
these field names are what it reports back to the trader — they must match
the venue's real unit rather than carry over from another product.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Literal, Optional


class Mode(str, Enum):
    DRY_RUN = "dry_run"
    LIVE = "live"
    STOPPED = "stopped"


@dataclass
class TradeRecord:
    """One round-trip position: an opening BUY paired with its closing SELL.

    The ledger stores individual fills; `bit_engine_store` pairs them into
    positions, since the copilot reasons about win/loss outcomes rather than
    one side of a trade.
    """
    symbol: str
    entry_price: float
    exit_price: Optional[float]           # None while still open
    size_usd: float
    realized_pnl_usd: Optional[float]     # None while still open
    unrealized_pnl_usd: Optional[float]   # None once closed
    exit_trigger: Optional[str]           # the closing fill's `reason`, e.g. "signal=sell"
    opened_at: datetime
    closed_at: Optional[datetime]
    is_open: bool
    dry_run: bool = True


@dataclass
class ConfigParam:
    """One tunable parameter, built from a strategy's `params_schema` entry."""
    key: str                              # e.g. "oversold"
    display_name: str                     # schema "label", e.g. "Oversold"
    category: str                         # e.g. "strategy", "sizing"
    control_type: Literal["slider", "toggle", "stepper", "select"]
    current_value: Any
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    min_label: Optional[str] = None
    max_label: Optional[str] = None
    step: Optional[float] = None
    options: Optional[list[str]] = None
    icon: str = "sliders"


@dataclass
class BotSnapshot:
    """Everything the copilot needs about one bot to reason about a request."""
    bot_id: str
    name: str
    mode: Mode
    config: list[ConfigParam]
    symbol: str = ""
    strategy_key: str = ""


@dataclass
class ChangeProposal:
    """The structured card the UI renders: rationale, editable control, confirm/cancel."""
    parameter_key: str
    display_name: str
    icon: str
    rationale: str
    control_type: Literal["slider", "toggle", "stepper", "select"]
    current_value: Any
    suggested_value: Any
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    min_label: Optional[str] = None
    max_label: Optional[str] = None
    step: Optional[float] = None
    options: Optional[list[str]] = None


@dataclass
class CopilotTurn:
    """One full assistant turn: thought / analysis / optional proposal."""
    thought: str
    analysis: str
    proposal: Optional[ChangeProposal] = None
    tool_calls: list[dict] = field(default_factory=list)
