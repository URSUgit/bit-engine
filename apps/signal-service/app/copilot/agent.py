"""The agent loop: system prompt + tool-calling round trips against the
Anthropic API, terminated by a mandatory `respond` tool call so the turn is
guaranteed-structured rather than free text we'd have to parse.

  1. a short planning sentence before any tool call  -> "thought"
  2. one or more tool calls, logged for the step trace
  3. a grounded analysis citing the tool results
  4. at most one change proposal, rendered as a confirmable card — never applied

Requires the `anthropic` package and ANTHROPIC_API_KEY. Both are optional for
the rest of the service, so import and key checks are deferred to call time and
surface as CopilotUnavailable rather than crashing the router at import.
"""
from __future__ import annotations

import json
import logging
import os

from .data_store import BotDataStore
from .system_prompt import DEFAULT_EVIDENCE_FLOOR, render_system_prompt
from .tools import TOOL_SCHEMAS, execute_tool
from .types import ChangeProposal, CopilotTurn

log = logging.getLogger(__name__)

MODEL = os.environ.get("COPILOT_MODEL", "claude-sonnet-5")
MAX_TOOL_ROUNDS = 6  # safety cap so a confused model can't loop forever


class CopilotUnavailable(RuntimeError):
    """The copilot can't run — missing dependency or API key. Surfaced to the
    UI as a clear 503 instead of a stack trace."""


def _config_summary(snapshot) -> str:
    rows = []
    for p in snapshot.config:
        bounds = ""
        if p.min_value is not None or p.max_value is not None:
            bounds = f" [{p.min_label or p.min_value} .. {p.max_label or p.max_value}]"
        rows.append(f"- {p.key} ({p.display_name}, {p.category}): {p.current_value}{bounds}")
    return "\n".join(rows) if rows else "- (no tunable parameters exposed)"


def _build_client():
    try:
        import anthropic
    except ImportError as exc:
        raise CopilotUnavailable(
            "The `anthropic` package isn't installed — run `pip install anthropic` "
            "in apps/signal-service to enable the config copilot."
        ) from exc
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise CopilotUnavailable(
            "ANTHROPIC_API_KEY is not set — the config copilot needs it to call the model."
        )
    return anthropic.Anthropic()


def _validate_proposal(payload: dict, snapshot) -> ChangeProposal | None:
    """Keep the model honest: a proposal must name a real parameter and stay
    inside its declared bounds. A hallucinated key or an out-of-range value
    would otherwise render as a confirmable card the human might just accept.
    """
    raw = payload.get("proposal")
    if not raw:
        return None

    known = {p.key: p for p in snapshot.config}
    param = known.get(raw.get("parameter_key"))
    if param is None:
        log.warning(
            "copilot proposed unknown parameter %r for bot %s — dropping proposal",
            raw.get("parameter_key"), snapshot.bot_id,
        )
        return None

    suggested = raw.get("suggested_value")
    if isinstance(suggested, (int, float)) and not isinstance(suggested, bool):
        if param.min_value is not None and suggested < param.min_value:
            log.warning("copilot proposed %s=%s below min %s — clamping",
                        param.key, suggested, param.min_value)
            suggested = param.min_value
        if param.max_value is not None and suggested > param.max_value:
            log.warning("copilot proposed %s=%s above max %s — clamping",
                        param.key, suggested, param.max_value)
            suggested = param.max_value

    # Trust the panel's own definition for the control's shape, not the model's.
    return ChangeProposal(
        parameter_key=param.key,
        display_name=param.display_name,
        icon=raw.get("icon") or param.icon,
        rationale=raw.get("rationale", ""),
        control_type=param.control_type,
        current_value=param.current_value,
        suggested_value=suggested,
        min_value=param.min_value,
        max_value=param.max_value,
        min_label=param.min_label,
        max_label=param.max_label,
        step=param.step,
        options=param.options,
    )


def ask_copilot(
    *,
    bot_id: str,
    user_message: str,
    store: BotDataStore,
    conversation_history: list[dict] | None = None,
    evidence_floor: int = DEFAULT_EVIDENCE_FLOOR,
    client=None,
) -> CopilotTurn:
    """Run one copilot turn for `user_message` against bot `bot_id`.

    `conversation_history` is prior turns in Anthropic message format; the
    caller owns persisting it. Pass None/[] for a fresh chat.
    """
    if client is None:
        client = _build_client()

    snapshot = store.get_bot_snapshot(bot_id)
    system_prompt = render_system_prompt(
        bot_name=snapshot.name,
        bot_mode=snapshot.mode.value,
        config_summary=_config_summary(snapshot),
        symbol=snapshot.symbol,
        strategy_key=snapshot.strategy_key,
        evidence_floor=evidence_floor,
    )

    messages = list(conversation_history or [])
    messages.append({"role": "user", "content": user_message})

    thought_parts: list[str] = []
    tool_calls_log: list[dict] = []

    for _ in range(MAX_TOOL_ROUNDS):
        response = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            system=system_prompt,
            tools=TOOL_SCHEMAS,
            messages=messages,
        )

        # Plain text written before/between tool calls is the "thought" trace.
        for block in response.content:
            if block.type == "text" and block.text.strip():
                thought_parts.append(block.text.strip())

        tool_use_blocks = [b for b in response.content if b.type == "tool_use"]
        messages.append({"role": "assistant", "content": response.content})

        respond_call = next((b for b in tool_use_blocks if b.name == "respond"), None)
        if respond_call is not None:
            payload = respond_call.input
            return CopilotTurn(
                thought=thought_parts[0] if thought_parts else "",
                analysis=payload["analysis"],
                proposal=_validate_proposal(payload, snapshot),
                tool_calls=tool_calls_log,
            )

        if not tool_use_blocks:
            # Stopped without calling `respond` — nudge once rather than
            # silently returning nothing.
            messages.append({
                "role": "user",
                "content": "Call the `respond` tool now with your analysis.",
            })
            continue

        tool_results = []
        for call in tool_use_blocks:
            result = execute_tool(call.name, call.input, store)
            tool_calls_log.append({"name": call.name, "input": call.input})
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": call.id,
                "content": json.dumps(result),
            })
        messages.append({"role": "user", "content": tool_results})

    raise RuntimeError(
        f"Copilot exceeded {MAX_TOOL_ROUNDS} tool-call rounds without calling `respond` "
        f"for bot {bot_id} — check the model isn't stuck in a retrieval loop."
    )
