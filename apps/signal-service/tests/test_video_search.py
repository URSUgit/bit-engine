import httpx
import pytest
from fastapi.testclient import TestClient


PATH = '/api/v1/backtest/video-strategy/search'
VIDEO_ID = '9hE5-98ZeCg'
PUBLIC_RESULT = {
    'items': [
        {'id': {'videoId': VIDEO_ID}, 'snippet': {
            'title': 'Breakouts &amp; replays', 'channelTitle': 'Test Channel',
            'thumbnails': {'medium': {'url': f'https://i.ytimg.com/vi/{VIDEO_ID}/mqdefault.jpg'}},
        }},
        {'id': {'channelId': 'not-a-video'}, 'snippet': {'title': 'Ignore this channel'}},
    ],
    'nextPageToken': 'CAoQAA',
}


def test_video_search_stays_disabled_without_a_key(monkeypatch):
    from research import app

    monkeypatch.delenv('YOUTUBE_API_KEY', raising=False)
    with TestClient(app) as client:
        settings = client.get(PATH.removesuffix('/search')).json()
        assert settings['search_enabled'] is False
        response = client.post(PATH, json={'query': 'BTC breakout'})
        assert response.status_code == 503
        assert 'YOUTUBE_API_KEY' in response.json()['detail']


def test_search_returns_only_video_results_and_paginates_without_account_access(monkeypatch):
    from research import app
    from app.youtube import client as youtube

    requests = []

    def handler(request):
        requests.append(request)
        assert request.url.host == 'www.googleapis.com'
        assert request.url.path == '/youtube/v3/search'
        assert request.headers['x-goog-api-key'] == 'fixture-not-a-credential'
        assert 'authorization' not in request.headers
        assert request.url.params['type'] == 'video'
        assert request.url.params['part'] == 'snippet'
        assert request.url.params['q'] == 'BTC breakout'
        assert request.url.params['maxResults'] == '12'
        assert 'key' not in request.url.params
        return httpx.Response(200, json=PUBLIC_RESULT if len(requests) == 1 else {'items': []})

    async_client = httpx.AsyncClient
    monkeypatch.setattr(youtube.httpx, 'AsyncClient', lambda **kw: async_client(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setenv('YOUTUBE_API_KEY', 'fixture-not-a-credential')

    with TestClient(app) as client:
        settings = client.get(PATH.removesuffix('/search'))
        assert settings.json()['search_enabled'] is True
        assert 'fixture-not-a-credential' not in settings.text
        first = client.post(PATH, json={'query': ' BTC breakout '})
        assert first.status_code == 200
        data = first.json()
        assert data['next_page_token'] == 'CAoQAA'
        assert len(data['videos']) == 1
        assert data['videos'][0]['title'] == 'Breakouts & replays'
        assert data['videos'][0]['url'] == f'https://www.youtube.com/watch?v={VIDEO_ID}'
        second = client.post(PATH, json={'query': 'BTC breakout', 'page_token': data['next_page_token']})
        assert second.json() == {'videos': [], 'next_page_token': None}
    assert 'pageToken' not in requests[0].url.params
    assert requests[1].url.params['pageToken'] == 'CAoQAA'


@pytest.mark.parametrize(('body', 'headers', 'status'), [
    ({'query': '  '}, {}, 422),
    ({'query': 'BTC', 'page_token': 'X' * 513}, {}, 422),
    ({'query': 'BTC'}, {'origin': 'https://example.invalid'}, 403),
    ({'query': 'BTC'}, {'sec-fetch-site': 'cross-site'}, 403),
])
def test_invalid_or_cross_origin_requests_do_not_use_quota(monkeypatch, body, headers, status):
    from research import app
    from app.youtube import client as youtube

    async def unexpected(*args, **kwargs):
        pytest.fail('invalid request used YouTube quota')

    monkeypatch.setattr(youtube, 'search_public_videos', unexpected, raising=False)
    monkeypatch.setenv('YOUTUBE_API_KEY', 'fixture-not-a-credential')
    with TestClient(app) as client:
        assert client.post(PATH, json=body, headers=headers).status_code == status
