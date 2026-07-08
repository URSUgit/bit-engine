"""Forecast module: strategies, composition, live lifecycle, error validation."""
import math

import pytest

from app.forecast.service import HORIZONS_S, ForecastService
from app.forecast.strategies import (
    Composition,
    CompositionMember,
    DriftStrategy,
    EmaMomentumStrategy,
    LastValueStrategy,
    LinRegStrategy,
    MeanReversionStrategy,
)


def _linear_ticks(n=120, start=100.0, slope=0.5, t0=1_000.0):
    """One tick per second, price rising `slope` per second."""
    return [(t0 + i, start + slope * i) for i in range(n)]


# ── strategies ────────────────────────────────────────────────────────────

def test_last_value_is_random_walk_baseline():
    ticks = _linear_ticks()
    assert LastValueStrategy().predict(ticks, 60) == ticks[-1][1]
    assert LastValueStrategy().predict([], 60) is None


def test_linreg_extrapolates_linear_trend_exactly():
    ticks = _linear_ticks(slope=0.5)
    last = ticks[-1][1]
    for h in (5, 30, 60, 300, 600):
        assert LinRegStrategy().predict(ticks, h) == pytest.approx(last + 0.5 * h, rel=1e-9)


def test_drift_extrapolates_exponential_growth_exactly():
    # 0.1% per second compounding
    ticks = [(1_000.0 + i, 100.0 * (1.001 ** i)) for i in range(120)]
    pred = DriftStrategy().predict(ticks, 60)
    assert pred == pytest.approx(ticks[-1][1] * (1.001 ** 60), rel=1e-6)


def test_ema_momentum_tracks_linear_trend_direction():
    up = EmaMomentumStrategy().predict(_linear_ticks(slope=0.5), 60)
    down = EmaMomentumStrategy().predict(_linear_ticks(slope=-0.5), 60)
    last_up = _linear_ticks(slope=0.5)[-1][1]
    last_down = _linear_ticks(slope=-0.5)[-1][1]
    assert up > last_up
    assert down < last_down


def test_mean_reversion_pulls_toward_window_mean():
    # Flat at 100, then a spike to 110: forecast must come back down.
    ticks = [(1_000.0 + i, 100.0) for i in range(300)] + [(1_300.0, 110.0)]
    strat = MeanReversionStrategy()
    pred_short = strat.predict(ticks, 5)
    pred_long = strat.predict(ticks, 600)
    assert pred_short < 110.0
    assert pred_long < pred_short  # longer horizon reverts further
    assert pred_long > 99.0        # but never past the mean


def test_strategies_return_none_without_enough_data():
    two_ticks = _linear_ticks(n=2)
    for strat in (DriftStrategy(), LinRegStrategy(), EmaMomentumStrategy(), MeanReversionStrategy()):
        assert strat.predict(two_ticks, 60) is None


# ── composition ───────────────────────────────────────────────────────────

def test_composition_weighted_average():
    ticks = _linear_ticks(slope=1.0)
    last = ticks[-1][1]
    comp = Composition("mix", [
        CompositionMember("last_value", weight=1.0),   # predicts last
        CompositionMember("linreg", weight=3.0),       # predicts last + h
    ])
    pred = comp.predict(ticks, 10)
    # (last*1 + (last+10)*3) / 4 = last + 7.5
    assert pred == pytest.approx(last + 7.5, rel=1e-9)


def test_composition_skips_members_without_data_and_renormalizes():
    two_ticks = _linear_ticks(n=2)
    comp = Composition("mix", [
        CompositionMember("last_value", weight=1.0),
        CompositionMember("linreg", weight=9.0),  # no data -> excluded
    ])
    assert comp.predict(two_ticks, 10) == two_ticks[-1][1]


def test_composition_rejects_unknown_strategy_and_bad_weight():
    with pytest.raises(ValueError):
        Composition("bad", [CompositionMember("nope")])
    with pytest.raises(ValueError):
        Composition("bad", [CompositionMember("last_value", weight=0)])
    with pytest.raises(ValueError):
        Composition("empty", [])


# ── live lifecycle + error validation ─────────────────────────────────────

def test_emit_covers_all_horizons_and_resolve_scores_errors():
    svc = ForecastService(symbols=["TESTUSDT"])
    t0 = 10_000.0
    # 10 minutes of linear ramp so every strategy has data
    for i in range(601):
        svc.record_tick("TESTUSDT", 100.0 + 0.1 * i, t0 + i)
    now = t0 + 600

    emitted = svc.emit(now)
    comps = {c.name for c in svc.compositions.values() if c.active}
    assert {r.horizon_s for r in emitted} == set(HORIZONS_S)
    assert {r.composition for r in emitted} == comps
    assert len(emitted) == len(comps) * len(HORIZONS_S)

    # Nothing resolves before its horizon
    assert svc.resolve(now + 1) == []

    # Feed the future: price keeps ramping for 10 more minutes
    for i in range(1, 601):
        svc.record_tick("TESTUSDT", 160.0 + 0.1 * i, now + i)
    done = svc.resolve(now + 600)
    assert len(done) == len(emitted)
    assert not svc.pending

    for rec in done:
        assert rec.realized_price == pytest.approx(160.0 + 0.1 * rec.horizon_s, abs=0.2)
        assert rec.abs_error == pytest.approx(
            abs(rec.predicted_price - rec.realized_price), rel=1e-12
        )
        # signed pct error consistent with abs error
        assert abs(rec.pct_error) == pytest.approx(
            rec.abs_error / rec.realized_price * 100, rel=1e-9
        )


def test_direction_hit_and_accuracy_aggregation():
    svc = ForecastService(symbols=["TESTUSDT"])
    t0 = 10_000.0
    for i in range(601):
        svc.record_tick("TESTUSDT", 100.0 + 0.1 * i, t0 + i)
    now = t0 + 600
    svc.emit(now)
    for i in range(1, 601):
        svc.record_tick("TESTUSDT", 160.0 + 0.1 * i, now + i)
    svc.resolve(now + 600)

    acc = svc.accuracy(symbol="TESTUSDT")
    assert acc, "accuracy() should return grouped stats"
    for row in acc:
        assert row["n"] > 0
        assert row["mae"] >= 0
        assert row["rmse"] >= row["mae"] - 1e-9
        assert row["mape_pct"] >= 0
        if row["direction_calls"]:
            assert 0.0 <= row["direction_hit_rate"] <= 1.0

    # The trend composition must nail direction on a pure ramp
    trend_rows = [r for r in acc if r["composition"] == "trend"]
    assert trend_rows
    for row in trend_rows:
        assert row["direction_hit_rate"] == 1.0

    # baseline (last_value) never calls a direction
    base_rows = [r for r in acc if r["composition"] == "baseline"]
    assert all(r["direction_calls"] == 0 for r in base_rows)

    # filters narrow results
    only_5s = svc.accuracy(horizon_s=5)
    assert only_5s and all(r["horizon_s"] == 5 for r in only_5s)


def test_forecast_voided_when_no_tick_near_due_time():
    svc = ForecastService(symbols=["TESTUSDT"])
    t0 = 10_000.0
    for i in range(120):
        svc.record_tick("TESTUSDT", 100.0, t0 + i)
    now = t0 + 119
    svc.emit(now)
    n_pending = len(svc.pending)
    assert n_pending > 0
    # No further ticks arrive (outage). Far past due + tolerance, forecasts
    # void — except 5s-horizon ones, whose due time is still within the
    # resolve tolerance of the last tick received at emit time.
    svc.resolve(now + 700)
    assert len(svc.pending) == 0
    within_tolerance = sum(1 for h in HORIZONS_S if h <= 10)
    n_comps = n_pending // len(HORIZONS_S)
    assert svc.voided == n_pending - within_tolerance * n_comps
    assert len(svc.resolved) == within_tolerance * n_comps


def test_live_payload_shape_and_composition_management():
    svc = ForecastService(symbols=["TESTUSDT"])
    t0 = 10_000.0
    for i in range(200):
        svc.record_tick("TESTUSDT", 100.0 + 0.05 * i, t0 + i)
    svc.emit(t0 + 199)

    payload = svc.live("testusdt")  # case-insensitive
    assert payload["symbol"] == "TESTUSDT"
    assert payload["ticks"][-1]["price"] == pytest.approx(100.0 + 0.05 * 199)
    assert payload["horizons_s"] == list(HORIZONS_S)
    assert payload["pending"]
    assert payload["latest"]

    # compose / replace / deactivate / remove
    comp = svc.add_composition("mine", [
        {"strategy": "drift", "weight": 2, "params": {"lookback_s": 60}},
        {"strategy": "mean_reversion", "weight": 1},
    ])
    assert comp.to_dict()["members"][0]["params"] == {"lookback_s": 60}
    assert svc.set_active("mine", False) is True
    emitted = svc.emit(t0 + 205)
    assert all(r.composition != "mine" for r in emitted)
    assert svc.remove_composition("mine") is True
    assert svc.remove_composition("mine") is False

    with pytest.raises(ValueError):
        svc.add_composition("bad", [{"strategy": "not_a_thing"}])


def test_bad_ticks_rejected():
    svc = ForecastService(symbols=["TESTUSDT"])
    svc.record_tick("TESTUSDT", -5.0)
    svc.record_tick("TESTUSDT", 0.0)
    svc.record_tick("TESTUSDT", math.nan)
    svc.record_tick("TESTUSDT", math.inf)
    assert len(svc.ticks["TESTUSDT"]) == 0


# ── narrator + benford ────────────────────────────────────────────────────

def test_benford_expected_distributions_sum_to_one():
    from app.forecast.analysis import benford_expected

    for pos in (1, 2, 3):
        probs = benford_expected(pos)
        assert sum(probs.values()) == pytest.approx(1.0, abs=1e-9)
    assert set(benford_expected(1)) == set(range(1, 10))
    assert set(benford_expected(3)) == set(range(0, 10))
    # First-digit law: P(1) ~ 30.1%, P(9) ~ 4.6%
    assert benford_expected(1)[1] == pytest.approx(0.30103, abs=1e-4)
    assert benford_expected(1)[9] == pytest.approx(0.04576, abs=1e-4)


def test_kth_significant_digit_extraction():
    from app.forecast.analysis import kth_significant_digit as kd

    assert kd(64241.5, 1) == 6
    assert kd(64241.5, 2) == 4
    assert kd(64241.5, 3) == 2
    assert kd(0.004512, 1) == 4
    assert kd(0.004512, 3) == 1
    assert kd(-7.25, 1) == 7
    assert kd(0.0, 1) is None
    assert kd(5.0, 2) is None  # '5' has one significant digit


def test_benford_test_conforms_on_benford_sample_and_flags_uniform():
    import random

    from app.forecast.analysis import benford_test

    rng = random.Random(5)
    # log-uniform sample follows Benford
    benford_vals = [10 ** rng.uniform(-3, 3) for _ in range(3000)]
    res = benford_test(benford_vals, 1)
    assert res["n"] == 3000
    assert res["conforms"] is True

    # constant-first-digit sample violates it badly
    bad_vals = [rng.uniform(1.0, 1.99) for _ in range(3000)]
    res_bad = benford_test(bad_vals, 1)
    assert res_bad["conforms"] is False

    # tiny samples return no verdict
    assert benford_test(benford_vals[:20], 1)["conforms"] is None


def test_narrator_warms_up_then_comments():
    from app.forecast.analysis import narrate

    svc = ForecastService(symbols=["TESTUSDT"])
    assert any("Warming up" in m["text"] for m in narrate(svc, "TESTUSDT"))

    t0 = 10_000.0
    for i in range(601):
        svc.record_tick("TESTUSDT", 100.0 + 0.1 * i, t0 + i)
    # 30 emit rounds so every (composition, horizon) group clears the
    # narrator's n>=20 bar for naming a leader.
    for k in range(30):
        svc.emit(t0 + 300 + 10 * k)
    for i in range(1, 601):
        svc.record_tick("TESTUSDT", 160.0 + 0.1 * i, t0 + 600 + i)
    svc.resolve(t0 + 1300)

    msgs = narrate(svc, "testusdt")
    kinds = {m["kind"] for m in msgs}
    assert "price" in kinds
    assert "leader" in kinds       # accuracy has n>=20 per group
    assert "event" in kinds
    texts = " ".join(m["text"] for m in msgs)
    assert "TESTUSDT" in texts
    for m in msgs:
        assert m["ts"] > 0 and m["text"]


def test_benford_best_window_picks_lowest_chi2_with_enough_samples():
    import math as _math
    import random

    from app.forecast.analysis import BENFORD_WINDOWS_S, benford_best_window

    rng = random.Random(9)
    # 40 min of ticks whose moves are log-uniform (Benford-conforming)
    ticks, t0, price = [], 50_000.0, 30_000.0
    for i in range(2400):
        move = 10 ** rng.uniform(-2, 2) * rng.choice((-1, 1))
        price = max(1.0, price + move)
        ticks.append((t0 + i, price))

    best = benford_best_window(ticks, 1)
    assert best["window_s"] in BENFORD_WINDOWS_S
    assert best["n"] >= 100
    assert len(best["windows_tried"]) == len(BENFORD_WINDOWS_S)
    # every candidate with enough samples has chi2 >= the winner's
    # (windows_tried values are rounded to 2dp, so allow that slack)
    for row in best["windows_tried"]:
        if row["n"] >= 100:
            assert row["chi2"] >= best["chi2"] - 0.011
    assert _math.isfinite(best["chi2"])

    # far too little data: falls back to window_s=0 (all ticks)
    tiny = benford_best_window(ticks[:20], 1)
    assert tiny["window_s"] == 0


def test_benford_backtest_ranks_combos_and_details_winner():
    import random

    from app.forecast.analysis import BENFORD_BT_WINDOWS, benford_backtest

    rng = random.Random(13)
    closes, price = [], 30_000.0
    for _ in range(3000):
        # multiplicative random walk: deltas span magnitudes (Benford-ish)
        price *= 1 + rng.uniform(-0.03, 0.031)
        closes.append(price)

    res = benford_backtest(closes)
    assert res["n_closes"] == 3000
    assert res["combos_tested"] > 0
    assert res["results"], "expected ranked results"

    # ranked ascending by chi2 among scored rows
    scored = [r for r in res["results"] if r["n"] >= 100]
    chis = [r["chi2"] for r in scored]
    assert chis == sorted(chis)

    best = res["best"]
    assert best is not None
    assert best["source"] in ("delta", "price")
    assert best["position"] in (1, 2, 3)
    assert best["window_n"] in BENFORD_BT_WINDOWS
    assert len(best["rows"]) in (9, 10)
    assert sum(r["expected_pct"] for r in best["rows"]) == pytest.approx(100.0, abs=0.01)

    # rolling series exists, is chronological, and stays bounded in size
    assert res["rolling"]
    idxs = [p["index"] for p in res["rolling"]]
    assert idxs == sorted(idxs)
    assert len(res["rolling"]) <= 70

    # too little data -> no winner, no crash
    tiny = benford_backtest(closes[:50])
    assert tiny["best"] is None
    assert tiny["rolling"] == []
