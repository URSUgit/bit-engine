import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.backtest import engine
from app.backtest.history import BacktestHistory
from app.backtest.models import BacktestParams
from app.backtest.storage import BarStorage
from app.paper.store import PaperStore
from app.routers import paper
from test_paper_forward import feed, snapshot


@pytest.fixture
def setup(tmp_path, monkeypatch, sample):
    from research import app
    db = BarStorage(':memory:')
    db.upsert_bars('BTCUSDT', '1h', sample, 'binance')
    history = BacktestHistory(str(tmp_path / 'runs.sqlite'))
    store = PaperStore(str(tmp_path / 'paper.sqlite'))
    monkeypatch.setattr(engine, 'HistoricalDataLoader', lambda: SimpleNamespace(storage=db))
    monkeypatch.setattr(engine, 'backtest_history', history)
    monkeypatch.setattr(paper, 'backtest_history', history, raising=False)
    monkeypatch.setattr(paper, '_store', store)
    draft = dict(status='compatible', summary='Handmade example', entry_offset_bps=75,
                 entry_second=25, exit_second=90, blockers=[], trader_name='Fixture Trader', strategy_name='UTC Breakout')
    params = dict(symbol='BTCUSDT', interval='1h', strategy='studio_breakout', start_date='2024-01-09',
                  end_date='2024-01-13', strategy_params={'entry_offset_bps': 80}, initial_capital=2400,
                  position_size_pct=.4, commission_pct=.002, slippage_pct=.001, spread_bps=10)
    origin = dict(url='https://www.youtube.com/watch?v=9hE5-98ZeCg', provider='pasted_gemini', model=None, draft=draft)
    def run(**changes):
        return asyncio.run(engine.run_backtest(BacktestParams.model_validate({**params, 'video_origin': origin, **changes})))
    return TestClient(app), history, run


URL = '/api/v1/paper/bots'


def test_named_bots_keep_saved_parameters_and_separate_state(setup, monkeypatch, sample):
    client, history, backtest = setup
    first = backtest()
    second = backtest(strategy_params={'entry_offset_bps': 200})
    assert history.list()[0]['trader_name'] == 'Fixture Trader'
    assert history.list()[0]['strategy_name'] == 'UTC Breakout'
    assert client.post(URL, json={'backtest_id': first.id, 'offset_bps': 900}).status_code == 422
    saved = client.post(URL, json={'backtest_id': first.id})
    assert saved.status_code == 201, saved.text
    bot = saved.json()
    assert bot['status'] == 'ready' and bot['cash'] == 2400 and bot['offset_bps'] == 80
    assert bot['name'] == 'Fixture Trader · UTC Breakout'
    assert bot['source']['backtest_id'] == first.id
    first_id = bot['id']
    other = client.post(URL, json={'backtest_id': second.id}).json()
    assert other['id'] != first_id and other['offset_bps'] == 200
    feed(monkeypatch, snapshot(sample, 61))
    for bot_id in (first_id, other['id']):
        assert client.post(f'{URL}/{bot_id}/start').status_code == 200
    feed(monkeypatch, snapshot(sample, 62))
    asyncio.run(paper.tick_forward())
    asyncio.run(paper.tick_forward())
    monkeypatch.setattr(paper, '_store', PaperStore(paper._store.db_path))
    runs = {item['id']: item for item in client.get(URL).json()['bots']}
    a = runs[first_id]
    assert a['cash'] == 1440
    assert a['position']['entry_price'] == pytest.approx(first.trades[0].entry_price)
    assert a['position']['size'] == pytest.approx(first.trades[0].size)
    assert len(a['events']) == 1 and a['source']['video_origin']['draft']['trader_name'] == 'Fixture Trader'
    assert runs[other['id']]['events'] == []
    assert client.post(f'{URL}/{first_id}/stop').json()['status'] == 'stopped'
    assert client.post(f'{URL}/{first_id}/start').status_code == 409
    assert client.get('/api/v1/paper/positions').status_code == 404


def test_bot_requires_saved_named_supported_result(setup):
    client, _, backtest = setup
    plain = backtest(video_origin=None)
    impact = backtest(enable_market_impact=True)
    assert client.post(URL, json={'backtest_id': 'missing'}).status_code == 404
    for result in (plain, impact):
        assert client.post(URL, json={'backtest_id': result.id}).status_code == 422
    assert client.get(URL).json() == {'bots': []}


def test_research_bot_changes_require_a_local_request(setup, monkeypatch, sample):
    client, _, backtest = setup
    result = backtest()
    body = {'backtest_id': result.id}
    cross_origin = {'origin': 'https://example.invalid'}
    assert client.post(URL, json=body, headers=cross_origin).status_code == 403
    bot = client.post(URL, json=body).json()
    feed(monkeypatch, snapshot(sample, 61))
    endpoint = f"{URL}/{bot['id']}"
    assert client.post(endpoint + '/start', headers=cross_origin).status_code == 403
    assert client.post(endpoint + '/start').json()['status'] == 'running'
    assert client.post(endpoint + '/stop', headers={'sec-fetch-site': 'cross-site'}).status_code == 403
    assert client.get(URL).json()['bots'][0]['status'] == 'running'
    assert client.post(endpoint + '/stop').json()['status'] == 'stopped'
