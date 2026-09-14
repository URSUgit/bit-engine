"""Tool schemas sent to the model, plus the executor that runs them against a
BotDataStore. Schema and execution live side by side so adding a read tool is
a one-place edit.
"""
from __future__ import annotations

from dataclasses import asdict
from typing import Any

from .data_store import BotDataStore

TOOL_SCHEMAS: list[dict] = [
    {
        "name": "get_recent_trades",
        "description": (
            "Fetch this bot's recent round-trip positions (closed and open), most recent first. "
            "Use this to ground any claim about win rate, realized USD P&L, or exit behavior."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "bot_id": {"type": "string"},
                "limit": {"type": "integer", "default": 100},
            },
            "required": ["bot_id"],
        },
    },
    {
        "name": "get_open_positions",
        "description": "Fetch this bot's currently open positions with unrealized USD P&L.",
        "input_schema": {
            "type": "object",
            "properties": {"bot_id": {"type": "string"}},
            "required": ["bot_id"],
        },
    },
    {
        "name": "respond",
        "description": (
            "Deliver your final answer for this turn. Call this exactly once, after gathering "
            "whatever evidence you need. This is the only way your analysis and optional proposal "
            "reach the trader's UI."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "analysis": {
                    "type": "string",
                    "description": (
                        "2-5 sentences. First sentence states scope (bot, mode, data subset). "
                        "Remaining sentences cite literal figures from tool results, check them "
                        "against the evidence floor, and state a conclusion — 'not enough "
                        "evidence' is a valid conclusion."
                    ),
                },
                "proposal": {
                    "type": ["object", "null"],
                    "description": "Omit (null) if no change is warranted yet.",
                    "properties": {
                        "parameter_key": {"type": "string"},
                        "display_name": {"type": "string"},
                        "icon": {"type": "string"},
                        "rationale": {
                            "type": "string",
                            "description": "One sentence, tied directly to the analysis.",
                        },
                        "control_type": {
                            "type": "string",
                            "enum": ["slider", "toggle", "stepper", "select"],
                        },
                        "current_value": {},
                        "suggested_value": {},
                        "min_value": {"type": ["number", "null"]},
                        "max_value": {"type": ["number", "null"]},
                        "min_label": {"type": ["string", "null"]},
                        "max_label": {"type": ["string", "null"]},
                        "step": {"type": ["number", "null"]},
                        "options": {"type": ["array", "null"], "items": {"type": "string"}},
                    },
                    "required": [
                        "parameter_key", "display_name", "icon", "rationale",
                        "control_type", "current_value", "suggested_value",
                    ],
                },
            },
            "required": ["analysis"],
        },
    },
]


def _trade_to_dict(t) -> dict:
    d = asdict(t)
    d["opened_at"] = t.opened_at.isoformat()
    d["closed_at"] = t.closed_at.isoformat() if t.closed_at else None
    return d


def execute_tool(name: str, tool_input: dict[str, Any], store: BotDataStore) -> Any:
    """Run a non-`respond` tool call, returning a JSON-serializable result."""
    if name == "get_recent_trades":
        trades = store.get_recent_trades(tool_input["bot_id"], tool_input.get("limit", 100))
        closed = [t for t in trades if not t.is_open]
        return {
            "trades": [_trade_to_dict(t) for t in trades],
            # Precomputed so the model cites consistent figures rather than
            # re-deriving them (and occasionally miscounting) from the list.
            "summary": {
                "total_positions": len(trades),
                "closed_positions": len(closed),
                "open_positions": len(trades) - len(closed),
                "wins": sum(1 for t in closed if (t.realized_pnl_usd or 0) > 0),
                "losses": sum(1 for t in closed if (t.realized_pnl_usd or 0) < 0),
                "realized_pnl_usd": round(sum(t.realized_pnl_usd or 0 for t in closed), 4),
            },
        }

    if name == "get_open_positions":
        positions = store.get_open_positions(tool_input["bot_id"])
        return {"positions": [_trade_to_dict(t) for t in positions]}

    raise ValueError(f"execute_tool called on non-executable tool: {name}")
