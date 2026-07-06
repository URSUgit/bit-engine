"""In-memory session state for the agent — one conversation history per session."""
from __future__ import annotations

import time
from collections import defaultdict
from typing import TypedDict

SESSION_TTL_SECONDS = 3600  # prune idle sessions after 1h


class Message(TypedDict):
    role: str   # "user" | "assistant" | "tool"
    content: str


class SessionStore:
    def __init__(self) -> None:
        self._history: dict[str, list[Message]] = defaultdict(list)
        self._last_accessed: dict[str, float] = {}

    def add(self, session_id: str, role: str, content: str) -> None:
        self._history[session_id].append({"role": role, "content": content})
        self._last_accessed[session_id] = time.monotonic()
        self._evict()

    def get(self, session_id: str) -> list[Message]:
        self._last_accessed[session_id] = time.monotonic()
        return list(self._history[session_id])

    def clear(self, session_id: str) -> None:
        self._history.pop(session_id, None)
        self._last_accessed.pop(session_id, None)

    def _evict(self) -> None:
        now = time.monotonic()
        stale = [sid for sid, t in self._last_accessed.items() if now - t > SESSION_TTL_SECONDS]
        for sid in stale:
            self._history.pop(sid, None)
            self._last_accessed.pop(sid, None)


# module-level singleton
_store = SessionStore()


def get_store() -> SessionStore:
    return _store
