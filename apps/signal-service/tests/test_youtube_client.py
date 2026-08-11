"""app/youtube/client.py: no real YouTube Data API calls here — every test
monkeypatches the `_get(path, params)` seam (or the higher-level functions it
composes), same style as `test_scout_vision.py`'s seam-level mocking."""
import pytest

from app.youtube import client as client_mod

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def reset_search_cache():
    client_mod._search_cache.clear()
    yield
    client_mod._search_cache.clear()


def test_video_from_item_normalizes_playlist_item():
    item = {
        "snippet": {
            "title": "BTC breakout setup",
            "videoOwnerChannelTitle": "Trader Joe",
            "publishedAt": "2026-07-01T00:00:00Z",
            "resourceId": {"videoId": "abcdefghijk"},
            "thumbnails": {"medium": {"url": "https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg"}},
        }
    }

    video = client_mod._video_from_item(item)

    assert video == {
        "video_id": "abcdefghijk",
        "title": "BTC breakout setup",
        "channel": "Trader Joe",
        "channel_id": None,
        "thumbnail": "https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg",
        "published_at": "2026-07-01T00:00:00Z",
        "url": "https://www.youtube.com/watch?v=abcdefghijk",
    }


def test_video_from_item_normalizes_search_item():
    item = {
        "id": {"videoId": "zyxwvutsrqp"},
        "snippet": {
            "title": "RSI reversal setup",
            "channelTitle": "Trader Joe",
            "channelId": "UCabcdefghijklmnopqrstuv",
            "publishedAt": "2026-07-05T00:00:00Z",
            "thumbnails": {"medium": {"url": "https://i.ytimg.com/vi/zyxwvutsrqp/mqdefault.jpg"}},
        },
    }

    video = client_mod._video_from_item(item)

    assert video == {
        "video_id": "zyxwvutsrqp",
        "title": "RSI reversal setup",
        "channel": "Trader Joe",
        "channel_id": "UCabcdefghijklmnopqrstuv",
        "thumbnail": "https://i.ytimg.com/vi/zyxwvutsrqp/mqdefault.jpg",
        "published_at": "2026-07-05T00:00:00Z",
        "url": "https://www.youtube.com/watch?v=zyxwvutsrqp",
    }


async def test_search_videos_passes_query_and_normalizes_results(monkeypatch):
    async def fake_get(path, params):
        assert path == "search"
        assert params["q"] == "crypto trading strategy"
        assert params["type"] == "video"
        return {
            "items": [
                {
                    "id": {"videoId": "v1"},
                    "snippet": {"title": "T1", "channelTitle": "C1", "channelId": "UC1"},
                }
            ],
            "nextPageToken": "tok2",
        }

    monkeypatch.setattr(client_mod, "_get", fake_get)

    result = await client_mod.search_videos("crypto trading strategy")

    assert result["next_page_token"] == "tok2"
    assert result["videos"] == [
        {
            "video_id": "v1",
            "title": "T1",
            "channel": "C1",
            "channel_id": "UC1",
            "thumbnail": None,
            "published_at": None,
            "url": "https://www.youtube.com/watch?v=v1",
        }
    ]


async def test_search_videos_caches_first_page_by_query(monkeypatch):
    calls = []

    async def fake_get(path, params):
        calls.append(params["q"])
        return {"items": [], "nextPageToken": None}

    monkeypatch.setattr(client_mod, "_get", fake_get)

    await client_mod.search_videos("day trading strategy")
    await client_mod.search_videos("Day Trading Strategy  ")  # same query, different case/whitespace
    await client_mod.search_videos("day trading strategy")

    assert calls == ["day trading strategy"]


async def test_search_videos_does_not_cache_across_page_tokens(monkeypatch):
    calls = []

    async def fake_get(path, params):
        calls.append(params.get("pageToken"))
        return {"items": [], "nextPageToken": None}

    monkeypatch.setattr(client_mod, "_get", fake_get)

    await client_mod.search_videos("day trading strategy")
    await client_mod.search_videos("day trading strategy", page_token="tok2")

    assert calls == [None, "tok2"]


@pytest.mark.parametrize(
    "value,expected",
    [
        ("PL1234567890", "PL1234567890"),
        ("https://www.youtube.com/playlist?list=PL1234567890", "PL1234567890"),
        ("https://www.youtube.com/watch?v=abc&list=PLxyz", "PLxyz"),
        ("not a url and no list", None),
    ],
)
def test_parse_playlist_id(value, expected):
    assert client_mod.parse_playlist_id(value) == expected


async def test_list_liked_videos_resolves_likes_playlist_then_paginates(monkeypatch):
    async def fake_get_my_channel():
        return {"title": "Me", "likes_playlist_id": "LL123"}

    async def fake_playlist_items(playlist_id, max_results, page_token):
        assert playlist_id == "LL123"
        return {"videos": [{"video_id": "v1"}], "next_page_token": None}

    monkeypatch.setattr(client_mod, "get_my_channel", fake_get_my_channel)
    monkeypatch.setattr(client_mod, "_playlist_items", fake_playlist_items)

    result = await client_mod.list_liked_videos()

    assert result == {"videos": [{"video_id": "v1"}], "next_page_token": None}


async def test_list_liked_videos_empty_when_no_likes_playlist(monkeypatch):
    async def fake_get_my_channel():
        return {"title": "Me", "likes_playlist_id": None}

    monkeypatch.setattr(client_mod, "get_my_channel", fake_get_my_channel)

    result = await client_mod.list_liked_videos()

    assert result == {"videos": [], "next_page_token": None}


async def test_list_subscription_feed_merges_and_sorts_by_recency(monkeypatch):
    async def fake_list_subscriptions():
        return {
            "channels": [{"channel_id": "UCA"}, {"channel_id": "UCB"}],
            "next_page_token": None,
        }

    async def fake_get(path, params):
        assert path == "channels"
        return {
            "items": [
                {"contentDetails": {"relatedPlaylists": {"uploads": "UUA"}}},
                {"contentDetails": {"relatedPlaylists": {"uploads": "UUB"}}},
            ]
        }

    async def fake_playlist_items(playlist_id, max_results, page_token):
        by_playlist = {
            "UUA": [{"video_id": "old", "published_at": "2026-01-01T00:00:00Z"}],
            "UUB": [{"video_id": "new", "published_at": "2026-06-01T00:00:00Z"}],
        }
        return {"videos": by_playlist[playlist_id], "next_page_token": None}

    monkeypatch.setattr(client_mod, "list_subscriptions", fake_list_subscriptions)
    monkeypatch.setattr(client_mod, "_get", fake_get)
    monkeypatch.setattr(client_mod, "_playlist_items", fake_playlist_items)

    videos = await client_mod.list_subscription_feed()

    assert [v["video_id"] for v in videos] == ["new", "old"]


async def test_get_raises_not_connected_when_no_token(monkeypatch):
    async def fake_token():
        return None

    monkeypatch.setattr(client_mod.auth, "get_valid_access_token", fake_token)

    with pytest.raises(client_mod.NotConnected):
        await client_mod._get("subscriptions", {})


async def test_get_raises_quota_exceeded_on_403_quota_response(monkeypatch):
    async def fake_token():
        return "tok"

    monkeypatch.setattr(client_mod.auth, "get_valid_access_token", fake_token)

    class FakeResponse:
        status_code = 403
        text = "quotaExceeded: The request cannot be completed because you have exceeded your quota."

        def raise_for_status(self):
            raise AssertionError("raise_for_status should not be reached for a quota error")

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url, params=None, headers=None):
            return FakeResponse()

    monkeypatch.setattr(client_mod.httpx, "AsyncClient", FakeAsyncClient)

    with pytest.raises(client_mod.QuotaExceeded):
        await client_mod._get("search", {})
