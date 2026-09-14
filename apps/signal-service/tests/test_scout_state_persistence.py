"""Scout state durability: a read hiccup must never erase watched channels.

Regression coverage for an observed data loss — `data/scout_state.json` went
from 16 channels (including hand-curated ones) to `{"channels": {}}` while its
`seen` list stayed intact. `_load` swallowed the read error silently and the
next `_save` wrote the empty in-memory state straight over the good file.
"""
import json

import pytest

from app.scout.service import ScoutService


def _write_state(path, channels, seen=("vid1", "vid2")):
    path.write_text(json.dumps({"channels": channels, "seen": list(seen)}))


def _service_with_state(monkeypatch, path) -> ScoutService:
    """Build a service bound to `path` (STATE_PATH is resolved at import)."""
    import app.scout.service as svc_mod

    monkeypatch.setattr(svc_mod, "STATE_PATH", path)
    return ScoutService()


CHANNELS = {
    "UC_auto": {"id": "UC_auto", "name": "Auto Found", "auto": True},
    "UC_manual": {"id": "UC_manual", "name": "Hand Picked", "auto": False},
}


def test_load_reads_existing_state(monkeypatch, tmp_path):
    state = tmp_path / "scout_state.json"
    _write_state(state, CHANNELS)

    svc = _service_with_state(monkeypatch, state)

    assert set(svc.channels) == {"UC_auto", "UC_manual"}
    assert svc.seen == {"vid1", "vid2"}
    assert svc.load_failed is False


def test_missing_file_is_a_normal_first_run(monkeypatch, tmp_path):
    svc = _service_with_state(monkeypatch, tmp_path / "does-not-exist.json")

    assert svc.channels == {}
    # Not a failure: saving must still work so the first channel can persist.
    assert svc.load_failed is False


def test_unreadable_state_does_not_get_overwritten(monkeypatch, tmp_path):
    """The core regression: corrupt file -> empty memory -> save must refuse."""
    state = tmp_path / "scout_state.json"
    state.write_text('{"channels": {"UC_manual": {truncated...')
    original = state.read_text()

    svc = _service_with_state(monkeypatch, state)
    assert svc.load_failed is True
    assert svc.channels == {}

    svc._save()

    assert state.read_text() == original, "a failed load must not overwrite the state file"


def test_empty_channels_never_replace_populated_file(monkeypatch, tmp_path):
    """Even with a clean load, an empty channel set must not erase the file.

    This is the shape the real incident took: something emptied the in-memory
    channel list and the next save persisted it.
    """
    state = tmp_path / "scout_state.json"
    _write_state(state, CHANNELS)

    svc = _service_with_state(monkeypatch, state)
    assert len(svc.channels) == 2

    svc.channels = {}
    svc._save()

    on_disk = json.loads(state.read_text())
    assert set(on_disk["channels"]) == {"UC_auto", "UC_manual"}


def test_unwatching_the_last_channel_is_allowed(monkeypatch, tmp_path):
    """The guard must not block a deliberate removal, or unwatching the final
    channel would silently never persist."""
    state = tmp_path / "scout_state.json"
    _write_state(state, {"UC_manual": CHANNELS["UC_manual"]})

    svc = _service_with_state(monkeypatch, state)
    assert svc.unwatch("UC_manual") is True

    assert json.loads(state.read_text())["channels"] == {}


def test_save_persists_channels_and_is_atomic(monkeypatch, tmp_path):
    state = tmp_path / "scout_state.json"
    _write_state(state, {"UC_auto": CHANNELS["UC_auto"]})

    svc = _service_with_state(monkeypatch, state)
    svc.channels["UC_manual"] = CHANNELS["UC_manual"]
    svc._save()

    on_disk = json.loads(state.read_text())
    assert set(on_disk["channels"]) == {"UC_auto", "UC_manual"}
    # The temp file used for the atomic swap must not be left behind.
    assert not list(tmp_path.glob("*.tmp"))


def test_state_path_does_not_depend_on_cwd(monkeypatch, tmp_path):
    """STATE_PATH must resolve to the service's data dir, not the caller's cwd."""
    import importlib

    import app.data_paths as data_paths

    monkeypatch.delenv("SCOUT_STATE_PATH", raising=False)
    importlib.reload(data_paths)

    resolved = data_paths.data_path("SCOUT_STATE_PATH", "scout_state.json")

    assert resolved.is_absolute()
    assert resolved.parent == data_paths.SERVICE_DIR / "data"


def test_relative_env_override_resolves_against_service_dir(monkeypatch):
    import importlib

    import app.data_paths as data_paths

    monkeypatch.setenv("SCOUT_STATE_PATH", "custom/state.json")
    importlib.reload(data_paths)

    resolved = data_paths.data_path("SCOUT_STATE_PATH", "scout_state.json")

    assert resolved == data_paths.SERVICE_DIR / "custom/state.json"


def test_absolute_env_override_is_respected(monkeypatch, tmp_path):
    import importlib

    import app.data_paths as data_paths

    target = tmp_path / "elsewhere.json"
    monkeypatch.setenv("SCOUT_STATE_PATH", str(target))
    importlib.reload(data_paths)

    assert data_paths.data_path("SCOUT_STATE_PATH", "scout_state.json") == target
