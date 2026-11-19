import json

import pytest
from fastapi.testclient import TestClient


VIDEO = 'https://www.youtube.com/watch?v=9hE5-98ZeCg'


@pytest.fixture
def draft():
    # Handwritten contract fixture; not a claim about what this URL contains.
    return dict(status='compatible', summary='Fixture breakout', entry_offset_bps=75,
                entry_second=25, exit_second=90, blockers=[], trader_name='Fixture Trader', strategy_name='UTC Breakout')


def test_pasted_draft_is_validated_without_gemini_key(draft, monkeypatch):
    from research import app

    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    client = TestClient(app)
    response = client.post('/api/v1/backtest/video-strategy/import', json={
        'url': 'https://youtu.be/9hE5-98ZeCg?t=25', 'output': json.dumps(draft),
    })
    assert response.status_code == 200, response.text
    assert response.json() == {'url': VIDEO, 'provider': 'pasted_gemini', 'model': None, 'draft': draft}
    offline = client.post('/api/v1/backtest/video-strategy/analyze', json={'url': VIDEO})
    assert offline.status_code == 503
    assert 'GEMINI_API_KEY' in offline.json()['detail']


@pytest.mark.parametrize('override', [
    {'entry_offset_bps': True}, {'entry_offset_bps': 401}, {'exit_second': None},
    {'blockers': ['Stop-loss not implemented']}, {'code': 'print(1)'},
])
def test_incomplete_or_generated_code_cannot_be_loaded(override, draft):
    from research import app
    bad = {**draft, **override}
    response = TestClient(app).post('/api/v1/backtest/video-strategy/import', json={
        'url': VIDEO, 'output': json.dumps(bad),
    })
    assert response.status_code == 422


def test_unrelated_strategy_is_visible_but_not_executable(draft):
    from research import app
    from app.backtest.models import BacktestParams

    client = TestClient(app)
    draft.update(status='needs_review', blockers=['Requires 5-minute candles'], entry_offset_bps=None)
    result = client.post('/api/v1/backtest/video-strategy/import', json={'url': VIDEO, 'output': json.dumps(draft)})
    assert result.status_code == 200 and result.json()['draft']['status'] == 'needs_review'
    with pytest.raises(ValueError, match='loadable'):
        BacktestParams.model_validate({'symbol': 'BTCUSDT', 'strategy': 'studio_breakout',
                                      'video_origin': result.json()})


def test_cross_origin_cannot_start_analysis(monkeypatch):
    from research import app

    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    response = TestClient(app).post('/api/v1/backtest/video-strategy/analyze', json={'url': VIDEO},
                                    headers={'origin': 'https://example.invalid'})
    assert response.status_code == 403


def test_rejects_non_video_urls(draft):
    from research import app
    client = TestClient(app)
    for url in ('http://www.youtube.com/watch?v=9hE5-98ZeCg',
                'https://www.youtube.com.evil.example/watch?v=9hE5-98ZeCg',
                'https://www.youtube.com/playlist?list=PLxyz',
                'https://www.youtube.com/watch?v=bad'):
        response = client.post('/api/v1/backtest/video-strategy/import', json={'url': url, 'output': json.dumps(draft)})
        assert response.status_code == 422


def test_direct_gemini_analysis_without_youtube_data_api(draft, monkeypatch):
    import httpx
    from research import app

    monkeypatch.delenv('YOUTUBE_API_KEY', raising=False)
    monkeypatch.setenv('GEMINI_API_KEY', 'fixture-not-a-credential')
    monkeypatch.delenv('BITENGINE_GEMINI_MODEL', raising=False)
    requests = []

    def handler(request):
        requests.append(request.url.host)
        assert str(request.url) == 'https://generativelanguage.googleapis.com/v1beta/interactions'
        assert request.headers['x-goog-api-key'] == 'fixture-not-a-credential'
        body = json.loads(request.content)
        assert body['model'] == 'gemini-3.8-flash'
        assert body['generation_config'] == {'thinking_level': 'low', 'max_output_tokens': 8192}
        assert body['store'] is False and 'tools' not in body
        assert body['input'][1] == {'type': 'video', 'uri': VIDEO}
        assert body['response_format']['mime_type'] == 'application/json'
        return httpx.Response(200, json={'status': 'completed', 'steps': [
            {'type': 'model_output', 'content': [{'type': 'text', 'text': json.dumps(draft)}]}
        ]})

    async_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kw: async_client(transport=httpx.MockTransport(handler), **kw))
    with TestClient(app) as client:
        settings = client.get('/api/v1/backtest/video-strategy').json()
        assert settings['api_enabled'] is True and settings['search_enabled'] is False
        assert settings['model'] == 'gemini-3.8-flash'
        response = client.post('/api/v1/backtest/video-strategy/analyze', json={'url': 'https://youtu.be/9hE5-98ZeCg'})
        assert response.status_code == 200, response.text
        assert response.json() == {'url': VIDEO, 'provider': 'gemini_api', 'model': settings['model'], 'draft': draft}
        assert 'fixture-not-a-credential' not in response.text
    assert requests == ['generativelanguage.googleapis.com']


@pytest.mark.parametrize(('upstream', 'expected'), [(429, 429), (400, 502), (403, 503)])
def test_gemini_errors_do_not_expose_upstream_details(monkeypatch, upstream, expected):
    import httpx
    from research import app

    monkeypatch.setenv('GEMINI_API_KEY', 'fixture-not-a-credential')
    transport = httpx.MockTransport(lambda _: httpx.Response(upstream, text='upstream secret detail'))
    async_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kw: async_client(transport=transport, **kw))
    with TestClient(app) as client:
        response = client.post('/api/v1/backtest/video-strategy/analyze', json={'url': VIDEO})
    assert response.status_code == expected
    assert 'upstream secret detail' not in response.text


def test_applied_video_offset_and_source_are_saved(draft, sample, tmp_path, monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from app.backtest import engine
    from app.backtest.history import BacktestHistory
    from app.backtest.models import BacktestParams
    from app.backtest.storage import BarStorage

    cache = BarStorage(':memory:')
    cache.upsert_bars('BTCUSDT', '1h', sample, 'binance')
    history = BacktestHistory(str(tmp_path / 'runs.sqlite'))
    monkeypatch.setattr(engine, 'HistoricalDataLoader', lambda: SimpleNamespace(storage=cache))
    monkeypatch.setattr(engine, 'backtest_history', history)
    params = BacktestParams.model_validate(dict(
        symbol='BTCUSDT', interval='1h', strategy='studio_breakout', start_date='2024-01-09',
        end_date='2024-01-13', strategy_params={'entry_offset_bps': 80},
        video_origin={'url': VIDEO, 'provider': 'pasted_gemini', 'model': None, 'draft': draft},
    ))
    result = asyncio.run(engine.run_backtest(params))
    record = history.get(result.id)
    assert record is not None
    saved = record['run_evidence']['inputs']
    assert saved['video_origin']['url'] == VIDEO
    assert saved['video_origin']['draft']['entry_offset_bps'] == 75
    assert saved['strategy_params']['entry_offset_bps'] == 80
    assert result.metrics.total_trades == 1
