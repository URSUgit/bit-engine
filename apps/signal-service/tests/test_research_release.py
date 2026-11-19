from fastapi.testclient import TestClient


def test_research_release_serves_history_without_live_or_custom_routes():
    from research import app

    client = TestClient(app)
    assert client.get('/health').json()['mode'] == 'research'
    assert client.get('/api/v1/backtest/symbols').status_code == 200
    assert client.get('/api/v1/paper/forward').status_code == 200
    assert client.post('/api/v1/backtest/run_custom', json={}).status_code == 404
    assert client.post('/api/v1/paper/positions', json={}).status_code == 404
    assert client.get('/api/v1/cryptobot/status').status_code == 404
    assert client.get('/api/v1/scout/status').status_code == 404
    assert client.post('/api/v1/backtest/seed-demo', json={}).status_code == 404


def test_research_can_reopen_saved_runs_but_cannot_delete_them(sample, tmp_path, monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from app.backtest import engine
    from app.backtest.history import BacktestHistory
    from app.backtest.models import BacktestParams
    from app.backtest.storage import BarStorage
    from research import app, backtest

    cache = BarStorage(':memory:')
    cache.upsert_bars('BTCUSDT', '1h', sample, 'binance')
    history = BacktestHistory(str(tmp_path / 'runs.sqlite'))
    monkeypatch.setattr(engine, 'HistoricalDataLoader', lambda: SimpleNamespace(storage=cache))
    monkeypatch.setattr(engine, 'backtest_history', history)
    monkeypatch.setattr(backtest, 'backtest_history', history)
    result = asyncio.run(engine.run_backtest(BacktestParams.model_validate({
        'symbol': 'BTCUSDT', 'strategy': 'studio_breakout', 'interval': '1h',
        'start_date': '2024-01-09', 'end_date': '2024-01-12',
    })))
    client = TestClient(app)
    url = '/api/v1/backtest/history'
    assert [row['id'] for row in client.get(url).json()['runs']] == [result.id]
    assert client.delete(f'{url}/{result.id}').status_code == 405
    saved = client.get(f'{url}/{result.id}')
    assert saved.status_code == 200
    expected = result.model_dump(mode='json')
    assert saved.json()['run_evidence'] == expected['run_evidence']
    assert saved.json()['open_position_at_end'] == expected['open_position_at_end']


def test_research_chart_uses_cache_only_and_preserves_source(seeded_storage):
    from research import app

    client = TestClient(app)
    reply = client.get('/api/v1/backtest/data/BTCUSDT', params={
        'interval': '1d', 'start_date': '2022-01-01', 'end_date': '2022-01-02',
    })
    assert reply.status_code == 200, reply.text
    assert reply.json()['source'] == 'test_fixture'
    assert reply.json()['count'] == 2
    reply = client.get('/api/v1/backtest/data/UNKNOWN', params={
        'interval': '1h', 'start_date': '2022-01-01', 'end_date': '2022-01-02',
    })
    assert reply.status_code == 200
    assert reply.json()['bars'] == []


def test_research_release_starts_and_cancels_only_paper_loop(monkeypatch):
    import asyncio
    import threading
    from research import app, paper

    running = threading.Event()
    stopped = threading.Event()

    async def loop():
        running.set()
        try:
            await asyncio.Future()
        finally:
            stopped.set()

    monkeypatch.setattr(paper, 'run_forward_loop', loop)
    with TestClient(app) as client:
        assert client.get('/health').status_code == 200
        assert running.wait(timeout=2)
    assert stopped.is_set()
