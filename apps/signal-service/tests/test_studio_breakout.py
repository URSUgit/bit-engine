from datetime import datetime, timedelta, timezone

import pytest

from app.backtest.engine import Backtest
from app.backtest.models import Bar
from app.backtest.strategies.studio_breakout import StudioBreakout




def simulate(bars, offset=50):
    engine = Backtest(
        initial_capital=10_000, commission_pct=0.001, slippage_pct=0,
        position_size_pct=0.25, spread_bps=0, execution_latency_ms=0,
        enable_market_impact=False, use_funding_rates=False,
    )
    strategy = StudioBreakout(entry_offset_bps=offset)
    trades, equity = engine.run(bars, strategy, symbol='BTCUSDT', interval='1h')
    return engine, trades, equity


def test_breakout_matches_handmade_scenario(sample):
    _, trades, _ = simulate(sample)
    assert len(trades) == 1
    trade = trades[0]
    assert trade.entry_time.isoformat() == '2024-01-11T15:00:00+00:00'
    assert trade.exit_time.isoformat() == '2024-01-12T00:00:00+00:00'
    assert trade.entry_price == 101.0
    assert trade.exit_price == 98.0
    assert trade.pnl_pct == pytest.approx((98 * (1 - 0.001) / (101 * (1 + 0.001)) - 1) * 100)
    assert trade.entry_fee > 0 and trade.exit_fee > 0
    assert simulate(sample)[1:] == simulate(sample)[1:]
    assert simulate(sample, 200)[1] == []


def test_final_signal_does_not_fill_without_next_candle(sample):
    engine, trades, _ = simulate(sample[:63])
    assert trades == [] and engine.position is None


def test_existing_position_is_not_closed_at_an_invented_fill(sample):
    engine, trades, _ = simulate(sample[:72])
    assert trades == [] and engine.position.entry_price == 101.0


def test_gap_rejected_instead_of_filling_next_available_candle(sample):
    with pytest.raises(ValueError, match='contiguous'):
        simulate(sample[:42] + sample[43:])


def test_midnight_entry_exits_on_a_later_utc_day():
    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    values = [100] * 47 + [102] + [103] * 24 + [104]
    bars = [Bar(start + timedelta(hours=i), p, p, p, p, 1) for i, p in enumerate(values)]
    _, trades, _ = simulate(bars, 0)
    assert [(t.entry_time, t.exit_time) for t in trades] == [(bars[48].timestamp, bars[72].timestamp)]


def test_utc_day_is_independent_of_display_timezone(sample):
    offset = timezone(timedelta(hours=5, minutes=30))
    for bar in sample:
        bar.timestamp = bar.timestamp.astimezone(offset)
    _, trades, _ = simulate(sample)
    assert [t.entry_time.astimezone(timezone.utc).hour for t in trades] == [15]


@pytest.mark.parametrize('source', ['binance', 'synthetic_gbm'])
def test_existing_backtester_uses_only_binance_hourly_cache(sample, monkeypatch, source):
    import asyncio
    from types import SimpleNamespace
    from app.backtest import engine
    from app.backtest.models import BacktestParams
    from app.backtest.storage import BarStorage

    cache = BarStorage(':memory:')
    cache.upsert_bars('BTCUSDT', '1h', sample, source)
    monkeypatch.setattr(engine, 'HistoricalDataLoader', lambda: SimpleNamespace(storage=cache))
    params = BacktestParams(symbol='BTCUSDT', interval='1h', strategy='studio_breakout',
                            start_date='2024-01-09', end_date='2024-01-13', slippage_pct=0)
    if source != 'binance':
        with pytest.raises(ValueError, match='real Binance'):
            asyncio.run(engine.run_backtest(params))
        return
    result = asyncio.run(engine.run_backtest(params))
    assert len(result.trades) == 1
    assert result.trades[0].entry_price == 101.0
    assert result.trades[0].exit_price == 98.0
    assert result.params_used['entry_offset_bps'] == 50


@pytest.mark.parametrize(('start', 'end'), [('2024-01-08', '2024-01-13'), ('2024-01-09', '2024-01-14')])
def test_breakout_refuses_to_silently_shorten_requested_range(sample, monkeypatch, start, end):
    import asyncio
    from types import SimpleNamespace
    from app.backtest import engine
    from app.backtest.models import BacktestParams
    from app.backtest.storage import BarStorage

    cache = BarStorage(':memory:')
    cache.upsert_bars('BTCUSDT', '1h', sample, 'binance')
    monkeypatch.setattr(engine, 'HistoricalDataLoader', lambda: SimpleNamespace(storage=cache))
    params = BacktestParams(symbol='BTCUSDT', interval='1h', strategy='studio_breakout',
                            start_date=start, end_date=end)
    with pytest.raises(ValueError, match='does not cover the requested UTC range'):
        asyncio.run(engine.run_backtest(params))


def test_result_evidence_repeats_and_tracks_exact_input(sample, tmp_path, monkeypatch):
    import asyncio
    from dataclasses import replace
    from types import SimpleNamespace
    from app.backtest import engine
    from app.backtest.history import BacktestHistory
    from app.backtest.models import BacktestParams
    from app.backtest.storage import BarStorage

    cache = BarStorage(':memory:')
    cache.upsert_bars('BTCUSDT', '1h', sample, 'binance')
    monkeypatch.setattr(engine, 'HistoricalDataLoader', lambda: SimpleNamespace(storage=cache))
    history = BacktestHistory(str(tmp_path / 'runs.db'))
    monkeypatch.setattr(engine, 'backtest_history', history)
    params = BacktestParams(symbol='BTCUSDT', interval='1h', strategy='studio_breakout',
                            start_date='2024-01-09', end_date='2024-01-13', commission_pct=0.002)
    first = asyncio.run(engine.run_backtest(params))
    evidence = first.model_dump(mode='json')['run_evidence']
    assert evidence['source'] == 'binance'
    assert datetime.fromisoformat(evidence['first_candle_utc']) == sample[0].timestamp
    assert datetime.fromisoformat(evidence['last_candle_utc']) == sample[-1].timestamp
    assert evidence['inputs']['end_date'] == '2024-01-13'  # exclusive
    assert evidence['inputs']['commission_pct'] == 0.002
    assert evidence['inputs']['strategy_params']['entry_offset_bps'] == 50
    assert len(evidence['candle_sha256']) == 64
    saved = history.get(first.id)
    assert saved is not None and saved['run_evidence'] == evidence
    again = asyncio.run(engine.run_backtest(params)).model_dump(mode='json')['run_evidence']
    assert again == evidence
    cache.upsert_bars('BTCUSDT', '1h', [replace(sample[-1], volume=1)], 'binance')
    changed = asyncio.run(engine.run_backtest(params)).model_dump(mode='json')['run_evidence']
    assert changed['candle_sha256'] != evidence['candle_sha256']
    assert changed['inputs'] == evidence['inputs']


def test_trade_explanation_records_decision_before_fill_and_survives_history(sample, tmp_path, monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from app.backtest import engine
    from app.backtest.history import BacktestHistory
    from app.backtest.models import BacktestParams, BacktestResult
    from app.backtest.storage import BarStorage

    cache = BarStorage(':memory:')
    cache.upsert_bars('BTCUSDT', '1h', sample, 'binance')
    history = BacktestHistory(str(tmp_path / 'runs.sqlite'))
    monkeypatch.setattr(engine, 'HistoricalDataLoader', lambda: SimpleNamespace(storage=cache))
    monkeypatch.setattr(engine, 'backtest_history', history)
    result = asyncio.run(engine.run_backtest(BacktestParams.model_validate({
        'symbol': 'BTCUSDT', 'strategy': 'studio_breakout', 'interval': '1h',
        'start_date': '2024-01-09', 'end_date': '2024-01-13', 'slippage_pct': 0.001,
    })))
    trade, = result.trades
    why = trade.explanation
    assert why is not None
    assert why.entry_signal.rule == 'previous_day_high_cross'
    assert why.entry_signal.candle_open_utc == sample[62].timestamp
    assert why.entry_signal.close_price == 101.0
    assert why.entry_signal.previous_close == 100.0
    assert why.entry_signal.previous_day_high == 100.0
    assert why.entry_signal.trigger_price == 100.50
    assert why.entry_signal.offset_bps == 50
    assert datetime.fromisoformat(trade.entry_time) == sample[63].timestamp
    assert why.entry_reference_price == 101.0 and trade.entry_price > 101.0
    assert why.exit_reason == 'signal' and why.exit_signal is not None
    assert why.exit_signal.rule == 'utc_day_close'
    assert why.exit_signal.candle_open_utc == sample[71].timestamp
    assert datetime.fromisoformat(trade.exit_time) == sample[72].timestamp
    assert why.exit_reference_price == 98.0 and trade.exit_price < 98.0
    assert why.entry_fee == pytest.approx(trade.entry_price * trade.size * 0.001)
    assert why.exit_fee == pytest.approx(trade.exit_price * trade.size * 0.001)
    assert BacktestResult.model_validate(history.get(result.id)).trades[0].explanation == why
    old = result.model_dump()
    del old['trades'][0]['explanation']
    assert BacktestResult.model_validate(old).trades[0].explanation is None


def test_final_open_position_marks_equity_and_exposure_without_a_fake_exit(sample, tmp_path, monkeypatch):
    import asyncio
    from dataclasses import replace
    from types import SimpleNamespace
    from app.backtest import engine
    from app.backtest.history import BacktestHistory
    from app.backtest.models import BacktestParams, BacktestResult
    from app.backtest.storage import BarStorage

    bars = sample[:72]
    bars[-1] = replace(bars[-1], low=99, close=99)
    cache = BarStorage(':memory:')
    cache.upsert_bars('BTCUSDT', '1h', bars, 'binance')
    history = BacktestHistory(str(tmp_path / 'runs.db'))
    monkeypatch.setattr(engine, 'HistoricalDataLoader', lambda: SimpleNamespace(storage=cache))
    monkeypatch.setattr(engine, 'backtest_history', history)
    params = BacktestParams.model_validate(dict(symbol='BTCUSDT', interval='1h', strategy='studio_breakout',
                                                start_date='2024-01-09', end_date='2024-01-12', slippage_pct=0))
    result = asyncio.run(engine.run_backtest(params))
    expected_mark = 2500 / (101 * 1.001) * 99
    assert result.trades == [] and result.metrics.total_trades == 0
    assert result.metrics.final_equity == result.equity_curve[-1].equity == round(7500 + expected_mark, 2)
    assert result.metrics.total_return_pct == round((expected_mark - 2500) / 100, 2)
    assert result.metrics.max_drawdown_pct == round((2500 - expected_mark) / 100, 2)
    assert result.metrics.recovery_factor == -1.0  # equity return / drawdown, even with no closed trades
    assert result.metrics.exposure_pct == result.metrics.time_in_market_pct == round(9 / 71 * 100, 2)
    assert result.open_position_at_end is not None
    assert result.open_position_at_end.entry_time == bars[63].timestamp
    assert result.open_position_at_end.last_close == 99
    assert result.open_position_at_end.unrealized_pnl == round(expected_mark - 2500, 2)
    saved = BacktestResult.model_validate(history.get(result.id))
    assert saved.open_position_at_end == result.open_position_at_end
    old_payload = result.model_dump(exclude={'open_position_at_end'})
    assert BacktestResult.model_validate(old_payload).open_position_at_end is None


@pytest.mark.parametrize('invalid', [True, 0.5, -1, 401])
def test_invalid_offset_rejected(invalid):
    with pytest.raises(ValueError, match='0.*400'):
        StudioBreakout(entry_offset_bps=invalid)
