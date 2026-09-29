"""`data_latest_ts` on a backtest result — the signal the UI uses to tell a
stale feed from a deliberately historical backtest.

It must report the newest bar in the whole cached *series*, not the newest in
the requested window. A 2020 backtest legitimately ends in 2020; a feed whose
newest bar is months old is stale whatever range you ask for, and silently
returns a shorter period than requested.
"""
from __future__ import annotations

RUN_BODY = {
    "symbol": "BTCUSDT",
    "strategy": "rsi",
    "interval": "1d",
    "start_date": "2022-01-15",
    "end_date": "2022-12-15",
}


def _series_latest_ts(storage) -> int:
    return storage.get_meta("BTCUSDT", "1d")["latest_ts"]


def test_result_reports_the_series_latest_bar(client, seeded_storage):
    r = client.post("/api/v1/backtest/run", json=RUN_BODY)
    assert r.status_code == 200
    body = r.json()

    assert body["data_latest_ts"] == _series_latest_ts(seeded_storage)


def test_latest_ts_is_not_the_requested_window_end(client, seeded_storage):
    """The distinction that makes the staleness warning meaningful.

    The fixture's series runs past this request's end_date, so a value equal to
    the window's last bar would mean we're measuring the query, not the feed —
    and every historical backtest would then look stale.
    """
    r = client.post("/api/v1/backtest/run", json=RUN_BODY)
    body = r.json()

    last_bar_in_window = body["equity_curve"][-1]["t"]
    assert body["data_latest_ts"] > last_bar_in_window


def test_latest_ts_accompanies_provenance(client):
    """Both provenance fields travel together; the UI needs source *and* age to
    decide between the REAL chip and the stale-feed warning."""
    body = client.post("/api/v1/backtest/run", json=RUN_BODY).json()

    assert body["data_source"] == "test_fixture"
    assert body["data_is_synthetic"] is False
    assert isinstance(body["data_latest_ts"], int)
