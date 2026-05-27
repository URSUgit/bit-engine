"""ReAct agent loop: Thought → Action → Observation → repeat until Answer."""
from __future__ import annotations

import json
import re
from typing import AsyncIterator

from app.agent.memory import get_store
from app.agent.providers import complete
from app.agent.tools import TOOL_SCHEMAS_TEXT, dispatch

MAX_ITERATIONS = 6

SYSTEM_PROMPT = f"""You are BitAgent, an expert AI trading analyst for the BitPrivat crypto platform.
You help traders research markets, analyze sentiment, evaluate strategies, and understand on-chain data.

You operate in a ReAct loop:
1. Think about what information you need (Thought:)
2. Call a tool if needed (Action:)
3. Read the result (Observation:)
4. Repeat until you can give a final answer (Answer:)

## Available tools
{TOOL_SCHEMAS_TEXT}

## Format rules
- Start reasoning with "Thought: <your reasoning>"
- To call a tool: "Action: <tool_name> <json_args>"  (args as compact JSON, {{}} if none)
- After a tool result arrives you will see "Observation: <result>"
- When ready to respond: "Answer: <your final response>"
- Keep thoughts concise. The Answer is shown to the user — make it clear, data-driven, and actionable.
- Use markdown formatting in your Answer for readability.
- Never fabricate prices or data — always call the appropriate tool first.
- You can also navigate users to platform pages with the navigate_to tool.
"""


def _parse_action(text: str) -> tuple[str, dict] | None:
    m = re.search(r"Action:\s*(\w+)\s+(\{.*?\})", text, re.DOTALL)
    if m:
        try:
            return m.group(1), json.loads(m.group(2))
        except json.JSONDecodeError:
            pass
    m = re.search(r"Action:\s*(\w+)\s*$", text, re.MULTILINE)
    if m:
        return m.group(1), {}
    return None


async def run(session_id: str, user_message: str) -> AsyncIterator[dict]:
    """
    Async generator yielding SSE-style event dicts:
      {"type": "thought", "content": "..."}
      {"type": "action",  "tool": "...", "args": {...}}
      {"type": "observation", "content": "..."}
      {"type": "answer", "content": "..."}
      {"type": "error", "content": "..."}
    """
    store = get_store()
    store.add(session_id, "user", user_message)

    history = store.get(session_id)
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    # Rebuild message list from history, merging tool results as assistant turns
    for msg in history:
        if msg["role"] in ("user", "assistant"):
            messages.append({"role": msg["role"], "content": msg["content"]})

    for iteration in range(MAX_ITERATIONS):
        try:
            response_text: str = await complete(messages, stream=False)  # type: ignore[assignment]
        except Exception as exc:
            yield {"type": "error", "content": f"LLM error: {exc}"}
            return

        messages.append({"role": "assistant", "content": response_text})

        # Check for final answer
        answer_match = re.search(r"Answer:\s*(.*)", response_text, re.DOTALL)
        if answer_match:
            answer = answer_match.group(1).strip()
            store.add(session_id, "assistant", answer)
            yield {"type": "answer", "content": answer}
            return

        # Emit thought if present
        thought_match = re.search(r"Thought:\s*(.*?)(?=Action:|Answer:|$)", response_text, re.DOTALL)
        if thought_match:
            yield {"type": "thought", "content": thought_match.group(1).strip()}

        # Parse and dispatch tool action
        parsed = _parse_action(response_text)
        if parsed is None:
            # No action and no answer — treat whole response as answer
            store.add(session_id, "assistant", response_text)
            yield {"type": "answer", "content": response_text}
            return

        tool_name, tool_args = parsed
        yield {"type": "action", "tool": tool_name, "args": tool_args}

        observation = await dispatch(tool_name, tool_args)
        # Emit navigate event if the tool requested navigation
        if isinstance(observation, dict) and observation.get("__navigate__"):
            yield {"type": "navigate", "path": observation["path"]}
        obs_text = json.dumps(observation, indent=2)
        yield {"type": "observation", "content": obs_text}

        # Append observation to messages so the LLM can see it
        messages.append({"role": "user", "content": f"Observation: {obs_text}"})

    # Exceeded max iterations — summarise what we found
    final = "I've gathered the available data but reached the analysis limit. Here's what I found:\n\n"
    obs_list = [e for e in messages if "Observation:" in e.get("content", "")]
    if obs_list:
        final += obs_list[-1]["content"].replace("Observation: ", "")
    store.add(session_id, "assistant", final)
    yield {"type": "answer", "content": final}
