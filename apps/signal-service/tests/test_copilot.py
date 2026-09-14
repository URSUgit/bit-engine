"""Config copilot: agent-loop mechanics, proposal validation, and the
ledger-fills -> round-trip-positions adapter.

All offline — the Anthropic client is faked, so no API key or network needed.
"""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.copilot.agent import ask_copilot
from app.copilot.data_store import InMemoryBotDataStore
from app.copilot.tools import execute_tool
from app.copilot.types import BotSnapshot, ConfigParam, Mode, TradeRecord


# ── fixtures ──────────────────────────────────────────────────────────────────

def _param(key="oversold", value=-100, lo=-200, hi=-50):
    return ConfigParam(
        key=key, display_name=key.replace("_", " ").title(), category="strategy",
        control_type="slider", current_value=value, min_value=lo, max_value=hi, step=5,
    )


def _snapshot(params=None):
    return BotSnapshot(
        bot_id="bot-1", name="tester · cci", mode=Mode.DRY_RUN,
        config=params if params is not None else [_param()],
        symbol="BTC-USD", strategy_key="cci",
    )


def _closed(pnl, symbol="BTC-USD"):
    return TradeRecord(
        symbol=symbol, entry_price=100.0, exit_price=100.0 + pnl, size_usd=25.0,
        realized_pnl_usd=pnl, unrealized_pnl_usd=None, exit_trigger="signal=sell",
        opened_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        closed_at=datetime(2026, 1, 2, tzinfo=timezone.utc), is_open=False,
    )


def _text(t):
    return SimpleNamespace(type="text", text=t)


def _tool_use(id_, name, input_):
    return SimpleNamespace(type="tool_use", id=id_, name=name, input=input_)


class FakeClient:
    """Scripted rounds: each entry is the content list of one model response."""

    def __init__(self, rounds):
        self._rounds = list(rounds)
        self.calls = []

    @property
    def messages(self):
        return self

    def create(self, **kwargs):
        # The loop mutates one `messages` list in place, so snapshot it —
        # otherwise every recorded call aliases the same final state.
        self.calls.append({**kwargs, "messages": list(kwargs["messages"])})
        return SimpleNamespace(content=self._rounds.pop(0))


# ── agent loop ────────────────────────────────────────────────────────────────

def test_loop_runs_tools_then_returns_structured_turn():
    store = InMemoryBotDataStore(_snapshot(), [_closed(5.0), _closed(-2.0)])
    client = FakeClient([
        [
            _text("I'll check this bot's closed positions first."),
            _tool_use("t1", "get_recent_trades", {"bot_id": "bot-1", "limit": 100}),
        ],
        [
            _tool_use("t2", "respond", {
                "analysis": "Scope: tester (dry_run), closed positions only. 2 closed, below floor.",
                "proposal": None,
            }),
        ],
    ])

    turn = ask_copilot(bot_id="bot-1", user_message="make it better", store=store, client=client)

    assert turn.thought == "I'll check this bot's closed positions first."
    assert turn.tool_calls == [
        {"name": "get_recent_trades", "input": {"bot_id": "bot-1", "limit": 100}}
    ]
    assert "below floor" in turn.analysis
    assert turn.proposal is None
    # The tool result must have been fed back before the second round.
    assert len(client.calls) == 2


def test_proposal_is_rebuilt_from_the_real_param_definition():
    store = InMemoryBotDataStore(_snapshot(), [_closed(1.0)])
    client = FakeClient([[
        _tool_use("t1", "respond", {
            "analysis": "ok",
            "proposal": {
                "parameter_key": "oversold", "display_name": "WRONG", "icon": "x",
                "rationale": "loosen entries", "control_type": "toggle",
                "current_value": 999, "suggested_value": -120,
            },
        }),
    ]])

    turn = ask_copilot(bot_id="bot-1", user_message="loosen it", store=store, client=client)

    assert turn.proposal is not None
    # Shape and current value come from the panel's definition, not the model.
    assert turn.proposal.control_type == "slider"
    assert turn.proposal.current_value == -100
    assert turn.proposal.display_name == "Oversold"
    assert turn.proposal.suggested_value == -120


def test_unknown_parameter_key_is_dropped_not_rendered():
    """A hallucinated key must not reach the UI as a confirmable card."""
    store = InMemoryBotDataStore(_snapshot(), [_closed(1.0)])
    client = FakeClient([[
        _tool_use("t1", "respond", {
            "analysis": "ok",
            "proposal": {
                "parameter_key": "not_a_real_param", "display_name": "Nope", "icon": "x",
                "rationale": "because", "control_type": "slider",
                "current_value": 1, "suggested_value": 2,
            },
        }),
    ]])

    turn = ask_copilot(bot_id="bot-1", user_message="tune it", store=store, client=client)

    assert turn.proposal is None
    assert turn.analysis == "ok"


@pytest.mark.parametrize("suggested,expected", [(-500, -200), (0, -50)])
def test_out_of_range_suggestion_is_clamped_to_bounds(suggested, expected):
    store = InMemoryBotDataStore(_snapshot(), [_closed(1.0)])
    client = FakeClient([[
        _tool_use("t1", "respond", {
            "analysis": "ok",
            "proposal": {
                "parameter_key": "oversold", "display_name": "Oversold", "icon": "x",
                "rationale": "r", "control_type": "slider",
                "current_value": -100, "suggested_value": suggested,
            },
        }),
    ]])

    turn = ask_copilot(bot_id="bot-1", user_message="tune it", store=store, client=client)

    assert turn.proposal.suggested_value == expected


def test_model_stopping_without_respond_is_nudged():
    store = InMemoryBotDataStore(_snapshot(), [])
    client = FakeClient([
        [_text("Thinking out loud with no tool call.")],
        [_tool_use("t1", "respond", {"analysis": "done", "proposal": None})],
    ])

    turn = ask_copilot(bot_id="bot-1", user_message="hi", store=store, client=client)

    assert turn.analysis == "done"
    nudge = client.calls[1]["messages"][-1]
    assert nudge["role"] == "user" and "respond" in nudge["content"]


# ── tool executor ─────────────────────────────────────────────────────────────

def test_recent_trades_summary_counts_only_closed_positions():
    open_pos = TradeRecord(
        symbol="BTC-USD", entry_price=100.0, exit_price=None, size_usd=25.0,
        realized_pnl_usd=None, unrealized_pnl_usd=3.0, exit_trigger=None,
        opened_at=datetime(2026, 1, 3, tzinfo=timezone.utc), closed_at=None, is_open=True,
    )
    store = InMemoryBotDataStore(_snapshot(), [open_pos, _closed(5.0), _closed(-2.0)])

    result = execute_tool("get_recent_trades", {"bot_id": "bot-1"}, store)

    assert result["summary"] == {
        "total_positions": 3, "closed_positions": 2, "open_positions": 1,
        "wins": 1, "losses": 1, "realized_pnl_usd": 3.0,
    }


# ── bit-engine adapter: fills -> positions ────────────────────────────────────

def _fill(side, price, at, pnl=None, quote=25.0, reason="signal", dry=True):
    return {
        "side": side, "price": price, "at": at, "pnl_usd": pnl, "quote_usd": quote,
        "reason": reason, "dry_run": dry, "symbol": "BTC-USD", "qty": 1.0,
    }


def _store_with_fills(monkeypatch, fills, position=None, last_price=None):
    """Point the adapter at a fake ledger + bot without a running service."""
    import app.copilot.bit_engine_store as mod

    # for_bot returns newest-first, like the real ledger.
    fake_ledger = SimpleNamespace(for_bot=lambda bot_id, n=50: list(reversed(fills)))
    fake_bot = SimpleNamespace(
        status=lambda: SimpleNamespace(position=position, last_price=last_price)
    )
    monkeypatch.setattr(mod, "get_ledger", lambda: fake_ledger)
    monkeypatch.setattr(mod, "get_bot", lambda bot_id: fake_bot)
    return mod.BitEngineBotStore()


def test_fills_are_paired_into_round_trip_positions(monkeypatch):
    store = _store_with_fills(monkeypatch, [
        _fill("BUY", 100.0, 1000),
        _fill("SELL", 110.0, 2000, pnl=2.5, reason="signal=sell"),
        _fill("BUY", 120.0, 3000),
        _fill("SELL", 115.0, 4000, pnl=-1.25, reason="signal=close"),
    ])

    trades = store.get_recent_trades("bot-1")

    assert len(trades) == 2
    # Newest first.
    assert trades[0].entry_price == 120.0 and trades[0].exit_price == 115.0
    assert trades[0].realized_pnl_usd == -1.25
    assert trades[0].exit_trigger == "signal=close"
    assert all(not t.is_open for t in trades)


def test_trailing_buy_is_reported_as_the_open_position(monkeypatch):
    store = _store_with_fills(
        monkeypatch,
        [
            _fill("BUY", 100.0, 1000),
            _fill("SELL", 110.0, 2000, pnl=2.5),
            _fill("BUY", 120.0, 3000),
        ],
        position={"entry_price": 120.0, "size": 2.0},
        last_price=125.0,
    )

    open_positions = store.get_open_positions("bot-1")

    assert len(open_positions) == 1
    pos = open_positions[0]
    assert pos.is_open and pos.exit_price is None and pos.realized_pnl_usd is None
    assert pos.unrealized_pnl_usd == 10.0  # (125 - 120) * 2

    # It must also appear in the combined list, marked open.
    assert sum(1 for t in store.get_recent_trades("bot-1") if t.is_open) == 1


def test_sell_without_a_matching_buy_is_ignored(monkeypatch):
    """A ledger that starts mid-position must not fabricate a position."""
    store = _store_with_fills(monkeypatch, [
        _fill("SELL", 110.0, 2000, pnl=2.5),
        _fill("BUY", 120.0, 3000),
        _fill("SELL", 130.0, 4000, pnl=1.0),
    ])

    trades = store.get_recent_trades("bot-1")

    assert len(trades) == 1
    assert trades[0].entry_price == 120.0 and trades[0].exit_price == 130.0
