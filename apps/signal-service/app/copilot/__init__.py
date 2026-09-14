"""Config copilot: an evidence-grounded assistant for tuning a trading bot.

The model reads the bot's real trade history through `BotDataStore`, refuses to
diagnose below an evidence floor, and returns at most one parameter change as a
structured proposal. It never writes config — applying a change is a separate,
explicitly human-confirmed call.
"""
from .agent import CopilotUnavailable, ask_copilot
from .bit_engine_store import BitEngineBotStore
from .types import ChangeProposal, ConfigParam, CopilotTurn, TradeRecord

__all__ = [
    "ask_copilot",
    "CopilotUnavailable",
    "BitEngineBotStore",
    "CopilotTurn",
    "ChangeProposal",
    "ConfigParam",
    "TradeRecord",
]
