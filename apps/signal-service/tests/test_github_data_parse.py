"""Coin Metrics CSV parsing — specifically, which close column we trust.

Regression for a real defect: the loader preferred `ReferenceRateUSD` over
`PriceUSD`. That column is published one day behind (ReferenceRateUSD[t] ==
PriceUSD[t-1], verified exactly on every overlapping row of btc/eth/ltc/doge/
aave) and only covers the last handful of days, so every import ended with a
week of prices shifted a day late plus one invented close.
"""
from __future__ import annotations

from app.backtest.github_data import _build_daily_bars, _parse_coinmetrics_csv

# Mirrors the real file's shape: PriceUSD is the long aligned series; the
# ReferenceRate* columns appear only at the tail, lagged by one day, and the
# final row has a reference rate but no PriceUSD at all.
CSV = """time,PriceUSD,ReferenceRateUSD,volume_reported_spot_usd_1d
2026-05-16,100.0,,1000
2026-05-17,110.0,,1100
2026-05-18,120.0,110.0,1200
2026-05-19,130.0,120.0,1300
2026-05-20,,130.0,
"""

# What the aligned PriceUSD series actually says, in order.
EXPECTED_CLOSES = [100.0, 110.0, 120.0, 130.0]


def test_parser_uses_the_aligned_price_column():
    points = _parse_coinmetrics_csv(CSV)

    assert [p[1] for p in points] == EXPECTED_CLOSES
    assert [p[0].date().isoformat() for p in points] == [
        "2026-05-16", "2026-05-17", "2026-05-18", "2026-05-19",
    ]


def test_lagged_reference_rate_is_never_substituted():
    """The tail must not pick up ReferenceRateUSD for rows that have PriceUSD."""
    points = _parse_coinmetrics_csv(CSV)
    by_date = {p[0].date().isoformat(): p[1] for p in points}

    # 110.0 is 05-17's real close; it must not reappear on 05-18.
    assert by_date["2026-05-18"] == 120.0
    assert by_date["2026-05-19"] == 130.0


def test_row_with_only_a_reference_rate_is_dropped():
    """The trailing partial row carries no aligned close, so it isn't a bar."""
    points = _parse_coinmetrics_csv(CSV)

    assert "2026-05-20" not in {p[0].date().isoformat() for p in points}
    assert len(points) == len(EXPECTED_CLOSES)


def test_bars_carry_the_parsed_closes_and_chain_opens():
    """Each bar closes on the real price and opens at the previous close."""
    bars = _build_daily_bars(_parse_coinmetrics_csv(CSV))

    assert [b.close for b in bars] == EXPECTED_CLOSES
    # First bar has no prior close, so it opens at its own close.
    assert bars[0].open == bars[0].close == 100.0
    assert [b.open for b in bars[1:]] == EXPECTED_CLOSES[:-1]
    # High/low bracket the real (open, close) pair — never invented wider.
    for b in bars:
        assert b.high == max(b.open, b.close)
        assert b.low == min(b.open, b.close)


def test_volume_is_read_and_missing_volume_is_zero():
    points = _parse_coinmetrics_csv(CSV)

    assert [p[2] for p in points] == [1000.0, 1100.0, 1200.0, 1300.0]


def _configure_import(monkeypatch):
    from app.backtest import github_data
    from app.backtest.storage import BarStorage

    store = BarStorage(":memory:")
    points = _parse_coinmetrics_csv(CSV)
    monkeypatch.setattr(github_data, "bar_storage", store)
    monkeypatch.setattr(github_data, "_MIN_PRICED_ROWS", len(points))
    monkeypatch.setattr(github_data, "fetch_coinmetrics_asset", lambda asset: points)
    return github_data, store, points


def _prices(bars):
    return [(b.open, b.high, b.low, b.close, b.volume) for b in bars]


def test_import_preserves_another_providers_data_by_default(monkeypatch):
    import pytest

    loader, store, points = _configure_import(monkeypatch)
    bars = _build_daily_bars(points)
    store.upsert_bars("BTCUSDT", "1d", bars, "binance")
    with pytest.raises(ValueError, match="binance"):
        loader.load_real_daily("BTCUSDT")
    assert store.get_meta("BTCUSDT", "1d")["source"] == "binance"
    assert _prices(store.get_bars("BTCUSDT", "1d", 0, 2**33)) == _prices(bars)


def test_explicit_provider_switch_never_leaves_mixed_bars(monkeypatch):
    from datetime import timedelta

    loader, store, points = _configure_import(monkeypatch)
    extra = (points[-1][0] + timedelta(days=1), 999.0, 1.0)
    store.upsert_bars("BTCUSDT", "1d", _build_daily_bars(points + [extra]), "binance")
    loader.load_real_daily("BTCUSDT", replace_other_source=True)
    assert store.get_meta("BTCUSDT", "1d")["source"] == loader.SOURCE_LABEL
    assert _prices(store.get_bars("BTCUSDT", "1d", 0, 2**33)) == _prices(_build_daily_bars(points))


def test_failed_explicit_import_keeps_existing_prices(monkeypatch):
    import asyncio
    from app.routers import backtest

    loader, store, points = _configure_import(monkeypatch)
    bars = _build_daily_bars(points)
    store.upsert_bars("BTCUSDT", "1d", bars, "binance")
    monkeypatch.setattr(backtest, "bar_storage", store)
    monkeypatch.setattr(loader, "fetch_coinmetrics_asset", lambda asset: [])
    result = asyncio.run(backtest.import_real_data(backtest.ImportRealRequest(
        symbols=["BTCUSDT"], clear_existing=True,
    )))
    assert result["errors"] and not result["imported"]
    assert _prices(store.get_bars("BTCUSDT", "1d", 0, 2**33)) == _prices(bars)


def test_partial_same_source_refresh_preserves_cached_history(monkeypatch):
    import pytest
    from datetime import timedelta

    loader, store, points = _configure_import(monkeypatch)
    old = (points[0][0] - timedelta(days=1), 90.0, 1.0)
    original = _build_daily_bars([old] + points)
    store.upsert_bars("BTCUSDT", "1d", original, loader.SOURCE_LABEL)
    with pytest.raises(ValueError, match="incomplete"):
        loader.load_real_daily("BTCUSDT")
    assert _prices(store.get_bars("BTCUSDT", "1d", 0, 2**33)) == _prices(original)


def test_same_source_refresh_removes_invalid_trailing_bar(monkeypatch):
    from datetime import timedelta

    loader, store, points = _configure_import(monkeypatch)
    extra = (points[-1][0] + timedelta(days=1), points[-1][1], 0.0)
    store.upsert_bars("BTCUSDT", "1d", _build_daily_bars(points + [extra]), loader.SOURCE_LABEL)
    loader.load_real_daily("BTCUSDT")
    assert _prices(store.get_bars("BTCUSDT", "1d", 0, 2**33)) == _prices(_build_daily_bars(points))
