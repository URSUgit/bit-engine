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


def test_annualization_factor_covers_intraday_intervals():
    """Regression: only 1d/1h/1wk were mapped, so every other supported
    interval (1m–12h, 3d, 1mo) fell back to 252 — a 1m crypto backtest
    annualized Sharpe with √252 instead of √525600 (~45x understated)."""
    from app.backtest.metrics import _annualization_factor as ann

    # Crypto trades 24/7: 365 days of bars per year.
    assert ann("1m", "crypto") == pytest.approx(525_600)
    assert ann("15m", "crypto") == pytest.approx(35_040)
    assert ann("4h", "crypto") == pytest.approx(2_190)
    assert ann("1d", "crypto") == pytest.approx(365)
    assert ann("3d", "crypto") == pytest.approx(365 / 3)

    # Stocks: 252 sessions of 6.5 hours.
    assert ann("1d", "stock") == pytest.approx(252)
    assert ann("1h", "stock") == pytest.approx(252 * 6.5)
    assert ann("15m", "stock") == pytest.approx(252 * 26)
    assert ann("1wk", "stock") == pytest.approx(52.2, rel=0.01)
    assert ann("1mo", "stock") == pytest.approx(12.0, rel=0.01)

    # Unknown intervals degrade to daily, never to a wild intraday scale.
    assert ann("weird", "stock") == pytest.approx(252)
    assert ann("weird", "crypto") == pytest.approx(365)

    # Factor must shrink monotonically as bars get coarser.
    crypto_factors = [ann(i, "crypto") for i in ("1m", "5m", "1h", "4h", "1d", "1wk")]
    assert crypto_factors == sorted(crypto_factors, reverse=True)


def test_incremental_macd_matches_naive_reference():
    """The O(1)-per-bar _MacdState must reproduce the O(n^2) reference
    _macd_values on every prefix — it replaced a per-bar full recompute
    that made a 6-month hourly MACD backtest take ~166s."""
    import random

    from app.backtest.strategies.macd import _MacdState, _macd_values

    rng = random.Random(42)
    closes: list[float] = []
    price = 100.0
    for _ in range(400):
        price *= 1 + rng.uniform(-0.02, 0.02)
        closes.append(price)

    for fast, slow, signal in ((12, 26, 9), (5, 15, 4), (3, 7, 2)):
        st = _MacdState(fast, slow, signal)
        for n, close in enumerate(closes, start=1):
            st.update(close)
            ref = _macd_values(closes[:n], fast, slow, signal)
            if n < slow + signal:
                assert ref is None
                continue
            assert ref is not None
            macd_ref, sig_ref, _hist = ref
            assert st.macd_now == pytest.approx(macd_ref, abs=1e-9)
            assert st.sig_now == pytest.approx(sig_ref, abs=1e-9)


def test_asset_class_recognizes_native_binance_symbols():
    """Regression: _asset_class only checked the Yahoo-keyed catalog, so
    BTCUSDT fell through to 'stock' — wrong annualization and, worse,
    funding rates were never applied for native Binance pairs."""
    from app.backtest.engine import _asset_class

    assert _asset_class("BTC-USD") == "crypto"   # catalog path
    assert _asset_class("BTCUSDT") == "crypto"   # native Binance path
    assert _asset_class("SOLUSDC") == "crypto"
    assert _asset_class("AAPL") == "stock"
    assert _asset_class("EURUSD=X") == "forex"
    assert _asset_class("GC=F") == "commodity"


def test_binance_symbol_resolver():
    """Regression: native Binance symbols (BTCUSDT) never matched the
    Yahoo-keyed map, so the Binance data fallback silently skipped them and
    daily history stayed frozen at the GitHub dataset's last day."""
    from app.backtest.data import binance_symbol

    assert binance_symbol("BTCUSDT") == "BTCUSDT"
    assert binance_symbol("btcusdt") == "BTCUSDT"
    assert binance_symbol("BTC-USD") == "BTCUSDT"
    assert binance_symbol("SOLUSDC") == "SOLUSDC"
    assert binance_symbol("AAPL") is None
    assert binance_symbol("EURUSD=X") is None
