"""Backtest engine + metrics math on deterministic synthetic data."""
from datetime import datetime, timedelta, timezone

import pytest

from conftest import make_bars


def _frictionless_engine():
    from app.backtest.engine import Backtest

    return Backtest(
        initial_capital=10_000,
        commission_pct=0.0,
        slippage_pct=0.0,
        position_size_pct=1.0,
        spread_bps=0.0,
        execution_latency_ms=0,
        enable_market_impact=False,
        use_funding_rates=False,
    )


def test_buy_and_hold_tracks_price_ratio():
    """With zero frictions, buy-and-hold final equity ≈ initial * price ratio."""
    from app.backtest.strategies import STRATEGIES

    bars = make_bars(300, drift=0.003, seed=1)
    strategy = STRATEGIES["buy_and_hold"]()
    trades, equity = _frictionless_engine().run(bars, strategy, symbol="TEST", interval="1d")

    assert equity, "equity curve must not be empty"
    price_ratio = bars[-1].close / bars[0].close
    final = equity[-1][1]
    assert final == pytest.approx(10_000 * price_ratio, rel=0.10)


def test_rsi_strategy_runs_and_trades_are_consistent():
    from app.backtest.strategies import STRATEGIES

    bars = make_bars(400, drift=0.0, seed=5)
    strategy = STRATEGIES["rsi"]()
    trades, equity = _frictionless_engine().run(bars, strategy, symbol="TEST", interval="1d")

    for t in trades:
        assert t.exit_time >= t.entry_time
        # Frictionless long PnL must match the price move exactly.
        if t.side == "long":
            expected = (t.exit_price - t.entry_price) * t.size
            assert t.pnl == pytest.approx(expected, rel=1e-6, abs=1e-6)


def test_compute_metrics_known_values():
    from app.backtest.metrics import compute_metrics
    from app.backtest.models import Trade

    t0 = datetime(2024, 1, 1, tzinfo=timezone.utc)

    def trade(pnl: float, i: int) -> Trade:
        return Trade(
            symbol="TEST",
            side="long",
            entry_time=t0 + timedelta(days=i * 10),
            exit_time=t0 + timedelta(days=i * 10 + 5),
            entry_price=100.0,
            exit_price=100.0 + pnl,
            size=1.0,
            pnl=pnl,
            pnl_pct=pnl,
            duration_bars=5,
        )

    trades = [trade(100.0, 0), trade(-50.0, 1)]
    equity = [
        (t0, 10_000.0),
        (t0 + timedelta(days=15), 10_100.0),
        (t0 + timedelta(days=30), 10_050.0),
    ]
    m = compute_metrics(10_000, equity, trades, "1d")

    assert m.total_trades == 2
    assert m.winning_trades == 1
    assert m.losing_trades == 1
    assert m.win_rate_pct == pytest.approx(50.0)
    assert m.profit_factor == pytest.approx(2.0)  # 100 gross win / 50 gross loss
    assert m.total_return_pct == pytest.approx(0.5)  # 10000 -> 10050


def test_compute_metrics_empty_inputs_safe():
    from app.backtest.metrics import compute_metrics

    m = compute_metrics(10_000, [], [], "1d")
    assert m.total_trades == 0
    assert m.final_equity == 10_000
