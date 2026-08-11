"""/api/v1/youtube router: monkeypatches app.youtube.auth/app.youtube.client
at the import seam the router itself uses (`from app.youtube import auth,
client`), then drives requests through the shared TestClient `client`
fixture from conftest.py (lifespan doesn't run, so no background tasks)."""
import pytest

from app.routers import youtube as youtube_router


@pytest.fixture(autouse=True)
def reset_youtube_mocks(monkeypatch):
    # Every test starts "disconnected" unless it opts in.
    monkeypatch.setattr(youtube_router.auth, "is_connected", lambda: False)


def test_status_reflects_disconnected(client):
    r = client.get("/api/v1/youtube/status")
    assert r.status_code == 200
    assert r.json() == {"connected": False, "channel": None}


def test_status_reflects_connected(client, monkeypatch):
    monkeypatch.setattr(youtube_router.auth, "is_connected", lambda: True)

    async def fake_get_my_channel():
        return {"title": "Me"}

    monkeypatch.setattr(youtube_router.client, "get_my_channel", fake_get_my_channel)

    r = client.get("/api/v1/youtube/status")
    assert r.status_code == 200
    assert r.json() == {"connected": True, "channel": {"title": "Me"}}


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/youtube/subscriptions",
        "/api/v1/youtube/feed",
        "/api/v1/youtube/liked",
        "/api/v1/youtube/playlist?id=PL123",
        "/api/v1/youtube/search?q=btc",
    ],
)
def test_list_endpoints_401_when_not_connected(client, path):
    r = client.get(path)
    assert r.status_code == 401
    assert "Connect your YouTube account" in r.json()["detail"]


def test_search_returns_videos_when_connected(client, monkeypatch):
    monkeypatch.setattr(youtube_router.auth, "is_connected", lambda: True)

    async def fake_search_videos(q, page_token=None):
        assert q == "crypto trading strategy"
        return {"videos": [{"video_id": "v1", "title": "T1"}], "next_page_token": None}

    monkeypatch.setattr(youtube_router.client, "search_videos", fake_search_videos)

    r = client.get("/api/v1/youtube/search?q=crypto+trading+strategy")

    assert r.status_code == 200
    assert r.json() == {"videos": [{"video_id": "v1", "title": "T1"}], "next_page_token": None}


def test_callback_redirects_with_connected_on_success(client, monkeypatch):
    async def fake_exchange_code(code):
        return {"access_token": "at1"}

    monkeypatch.setattr(youtube_router.auth, "exchange_code", fake_exchange_code)

    r = client.get("/api/v1/youtube/callback?code=abc", follow_redirects=False)

    assert r.status_code in (302, 307)
    assert "connected=1" in r.headers["location"]


def test_callback_redirects_with_error_on_google_denial(client):
    r = client.get("/api/v1/youtube/callback?error=access_denied", follow_redirects=False)

    assert r.status_code in (302, 307)
    assert "error=access_denied" in r.headers["location"]


def test_callback_redirects_with_error_on_exchange_failure(client, monkeypatch):
    async def fake_exchange_code(code):
        raise RuntimeError("boom")

    monkeypatch.setattr(youtube_router.auth, "exchange_code", fake_exchange_code)

    r = client.get("/api/v1/youtube/callback?code=abc", follow_redirects=False)

    assert r.status_code in (302, 307)
    assert "error=exchange_failed" in r.headers["location"]


def test_disconnect_clears_connection(client, monkeypatch):
    calls = []
    monkeypatch.setattr(youtube_router.auth, "disconnect", lambda: calls.append(True))

    r = client.post("/api/v1/youtube/disconnect")

    assert r.status_code == 200
    assert r.json() == {"connected": False}
    assert calls == [True]
