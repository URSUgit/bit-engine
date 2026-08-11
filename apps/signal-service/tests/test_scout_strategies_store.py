"""Persistent extracted-strategies list: add/list/update/delete + dedup."""
from app.scout.strategies_store import StrategiesStore

MODEL_A = {
    "name": "Trader X · RSI Reversal",
    "trader": "Trader X",
    "strategy": "rsi",
    "label": "RSI Reversal",
    "why": "RSI levels discussed",
    "params": {},
    "pairs": ["BTC-USD"],
    "position_pct": 5.0,
    "risk_pct": 1.5,
    "stop_loss_pct": 3.0,
    "take_profit_pct": 9.0,
    "leverage": 10.0,
}
MODEL_B = {**MODEL_A, "name": "Trader X · MACD Crossover", "strategy": "macd", "label": "MACD Crossover"}


def _store(tmp_path, monkeypatch):
    path = tmp_path / "scout_strategies.json"
    monkeypatch.setattr("app.scout.strategies_store.STORE_PATH", path)
    return StrategiesStore()


def test_add_models_persists_and_survives_reload(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    added = store.add_models([MODEL_A, MODEL_B], "vid1", "Title 1", "https://youtube.com/watch?v=vid1")
    assert len(added) == 2
    assert added[0]["trader"] == "Trader X"
    assert added[0]["edited"] is False

    reloaded = StrategiesStore()
    assert len(reloaded.entries) == 2
    assert reloaded.list_entries()[0]["strategy"] == "macd"  # newest first


def test_add_models_dedupes_same_video_and_strategy(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    store.add_models([MODEL_A], "vid1", "Title 1", "url1")
    added_again = store.add_models([MODEL_A], "vid1", "Title 1", "url1")
    assert added_again == []
    assert len(store.entries) == 1


def test_update_entry_marks_edited(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    [entry] = store.add_models([MODEL_A], "vid1", "Title 1", "url1")
    updated = store.update_entry(entry["id"], {"position_pct": 12.5, "name": "Renamed"})
    assert updated["position_pct"] == 12.5
    assert updated["name"] == "Renamed"
    assert updated["edited"] is True
    assert updated["edited_at"] is not None


def test_update_entry_unknown_id_raises(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    try:
        store.update_entry(999, {"name": "x"})
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_delete_entry(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    [entry] = store.add_models([MODEL_A], "vid1", "Title 1", "url1")
    assert store.delete_entry(entry["id"]) is True
    assert store.entries == []
    assert store.delete_entry(entry["id"]) is False
