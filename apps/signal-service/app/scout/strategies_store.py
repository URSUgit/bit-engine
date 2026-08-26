"""Durable list of every named strategy model Scout extracts from a video
(background poll + manual "Analyze live" alike), surfaced on the Backtester
page as a persistent, editable queue. Unlike `ScoutService.analyses` (in
memory only, capped, lost on restart), this survives restarts the same way
`scout_state.json` does.
"""
from __future__ import annotations

import itertools
import json
import logging
import os
import time
from pathlib import Path

log = logging.getLogger(__name__)

STORE_PATH = Path(os.getenv("SCOUT_STRATEGIES_PATH", "data/scout_strategies.json"))

# Fields copied verbatim from a `build_models()` model dict onto each entry.
_MODEL_FIELDS = (
    "trader", "strategy", "label", "why", "params", "pairs",
    "position_pct", "risk_pct", "stop_loss_pct", "take_profit_pct", "leverage",
)

# Fields a user is allowed to edit after the fact.
_EDITABLE_FIELDS = frozenset({
    "name", "params", "pairs",
    "position_pct", "risk_pct", "stop_loss_pct", "take_profit_pct", "leverage",
})


class StrategiesStore:
    def __init__(self) -> None:
        self.entries: list[dict] = []
        self._ids = itertools.count(1)
        self._load()

    def _load(self) -> None:
        try:
            raw = json.loads(STORE_PATH.read_text())
            self.entries = raw.get("entries", [])
            if self.entries:
                self._ids = itertools.count(max(e["id"] for e in self.entries) + 1)
        except Exception:
            pass

    def _save(self) -> None:
        try:
            STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
            STORE_PATH.write_text(json.dumps({"entries": self.entries}))
        except Exception as exc:
            log.warning("scout strategies store save failed: %r", exc)

    def add_models(
        self, models: list[dict], video_id: str, title: str, url: str, thumbnail: str | None = None
    ) -> list[dict]:
        """Append every extracted model as a new list entry tagged with its
        source video. Deduped on (video_id, strategy) so re-analyzing the
        same video (background re-poll, manual re-trigger) doesn't spam
        duplicates; never touches an already-stored entry, so user edits are
        never clobbered by a later re-analysis of the same video."""
        existing_keys = {(e["video_id"], e["strategy"]) for e in self.entries}
        added: list[dict] = []
        for m in models:
            key = (video_id, m.get("strategy"))
            if key in existing_keys:
                continue
            entry = {
                "id": next(self._ids),
                "video_id": video_id,
                "video_title": title,
                "video_url": url,
                "video_thumbnail": thumbnail,
                "name": m.get("name"),
                "added_at": time.time(),
                "edited": False,
                "edited_at": None,
                **{k: m.get(k) for k in _MODEL_FIELDS},
            }
            self.entries.append(entry)
            added.append(entry)
            existing_keys.add(key)
        if added:
            self._save()
        return added

    def list_entries(self) -> list[dict]:
        return list(reversed(self.entries))

    def update_entry(self, entry_id: int, patch: dict) -> dict:
        entry = next((e for e in self.entries if e["id"] == entry_id), None)
        if entry is None:
            raise ValueError("Unknown strategy id")
        changed = False
        for k, v in patch.items():
            if k in _EDITABLE_FIELDS and entry.get(k) != v:
                entry[k] = v
                changed = True
        if changed:
            entry["edited"] = True
            entry["edited_at"] = time.time()
            self._save()
        return entry

    def delete_entry(self, entry_id: int) -> bool:
        before = len(self.entries)
        self.entries = [e for e in self.entries if e["id"] != entry_id]
        removed = len(self.entries) != before
        if removed:
            self._save()
        return removed


strategies_store = StrategiesStore()
