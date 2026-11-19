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
