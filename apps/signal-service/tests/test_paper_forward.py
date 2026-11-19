"""Paper forward in the original app: fixture prices, isolated wallet DB."""
import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.paper.store import PaperStore
from app.routers import paper




@pytest.fixture
def api(tmp_path, monkeypatch):
    app = FastAPI()
    app.include_router(paper.router, prefix='/api/v1/paper')
    monkeypatch.setattr(paper, '_store', PaperStore(str(tmp_path / 'paper.db')))
    return TestClient(app)


URL = '/api/v1/paper/forward'


def snapshot(sample, last, delay=30_000, opening=True):
    window = sample[:last + 1]
    return window, sample[last + 1] if opening else None, (window[-1].ts + 3600) * 1000 + delay


def feed(monkeypatch, value):
    async def simulated_market():
        return value
    monkeypatch.setattr(paper, 'market_snapshot', simulated_market, raising=False)


def test_forward_records_next_open_once_and_survives_reopen(api, monkeypatch, sample):
    signal = next(i for i, bar in enumerate(sample) if bar.timestamp.isoformat() == '2024-01-11T14:00:00+00:00')
    feed(monkeypatch, snapshot(sample, signal - 1))
    resp = api.post(URL + '/start', json={'offset_bps': 50})
    assert resp.status_code == 201, resp.text
    assert resp.json()['position'] is None and resp.json()['events'] == []
    feed(monkeypatch, snapshot(sample, signal))
    asyncio.run(paper.tick_forward())
    asyncio.run(paper.tick_forward())
    monkeypatch.setattr(paper, '_store', PaperStore(paper._store.db_path))
    run = api.get(URL).json()
    assert run['position']['entry_price'] == 101.0
    assert run['position']['entry_time'] == sample[signal + 1].ts
    assert len(run['events']) == 1 and run['events'][0]['kind'] == 'paper_fill'
    assert api.get('/api/v1/paper/positions').json() == []  # no manual-wallet/broker action
    for i in range(signal + 1, signal + 10):
        feed(monkeypatch, snapshot(sample, i))
        asyncio.run(paper.tick_forward())
    run = api.get(URL).json()
    assert run['position'] is None
    assert run['events'][-1]['action'] == 'close' and run['events'][-1]['price'] == 98.0
    assert run['cash'] < 10_000


def test_forward_never_fills_a_late_open(api, monkeypatch, sample):
    signal = next(i for i, bar in enumerate(sample) if bar.timestamp.isoformat() == '2024-01-11T14:00:00+00:00')
    feed(monkeypatch, snapshot(sample, signal - 1))
    assert api.post(URL + '/start', json={'offset_bps': 50}).status_code == 201
    feed(monkeypatch, snapshot(sample, signal, delay=121_000))
    asyncio.run(paper.tick_forward())
    run = api.get(URL).json()
    assert run['status'] == 'paused' and run['position'] is None
    assert run['events'][-1]['kind'] == 'missed_open'


def test_forward_pauses_on_gap_and_does_not_run_after_stop(api, monkeypatch, sample):
    feed(monkeypatch, snapshot(sample, 40))
    start = api.post(URL + '/start', json={'offset_bps': 50})
    assert start.status_code == 201
    assert api.post(URL + '/start', json={'offset_bps': 60}).status_code == 409
    feed(monkeypatch, snapshot(sample, 42))
    asyncio.run(paper.tick_forward())
    run = api.get(URL).json()
    assert run['status'] == 'paused' and run['events'][-1]['kind'] == 'gap'
    assert api.post(URL + '/stop').json()['status'] == 'stopped'
    asyncio.run(paper.tick_forward())
    assert len(api.get(URL).json()['events']) == 1


def test_forward_bar_parser_excludes_open_candle_and_rejects_stale():
    from app.paper.forward import parse_snapshot

    server_ms = 50 * 3_600_000 + 15_000
    rows = [[i * 3_600_000, '100', '101', '99', '100', '10', (i + 1) * 3_600_000 - 1] for i in range(51)]
    bars, opening, observed = parse_snapshot(rows, server_ms)
    assert opening is not None
    assert bars[-1].ts == 49 * 3600 and opening.ts == 50 * 3600 and observed == server_ms
    with pytest.raises(ValueError, match='stale'):
        parse_snapshot(rows, server_ms + 2 * 3_600_000)
