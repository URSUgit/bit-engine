"""app/youtube/auth.py: no real OAuth network calls here — httpx.AsyncClient
is monkeypatched at the module seam (same style as test_scout.py's
`test_discover_channels_parses_search_html`), and TOKEN_PATH is redirected
to a tmp_path file so tests never touch real on-disk state."""
import time

import pytest

from app.youtube import auth as auth_mod

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def isolated_token_path(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_mod, "TOKEN_PATH", tmp_path / "youtube_oauth.json")


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def fake_client(payload):
    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, data=None):
            return FakeResponse(payload)

    return lambda *a, **k: FakeClient()


async def test_exchange_code_stores_tokens(monkeypatch):
    monkeypatch.setattr(
        auth_mod.httpx,
        "AsyncClient",
        fake_client({"access_token": "at1", "refresh_token": "rt1", "expires_in": 3600}),
    )

    tokens = await auth_mod.exchange_code("some-code")

    assert tokens["access_token"] == "at1"
    assert tokens["refresh_token"] == "rt1"
    assert tokens["expires_at"] > time.time()
    assert auth_mod.is_connected() is True


async def test_exchange_code_keeps_existing_refresh_token_if_omitted(monkeypatch):
    monkeypatch.setattr(
        auth_mod.httpx,
        "AsyncClient",
        fake_client({"access_token": "at1", "refresh_token": "rt1", "expires_in": 3600}),
    )
    await auth_mod.exchange_code("first-code")

    monkeypatch.setattr(
        auth_mod.httpx,
        "AsyncClient",
        fake_client({"access_token": "at2", "expires_in": 3600}),
    )
    tokens = await auth_mod.exchange_code("second-code")

    assert tokens["access_token"] == "at2"
    assert tokens["refresh_token"] == "rt1"


async def test_get_valid_access_token_returns_none_when_never_connected():
    assert await auth_mod.get_valid_access_token() is None


async def test_get_valid_access_token_returns_stored_token_when_not_expired(monkeypatch):
    auth_mod._save_tokens({"access_token": "at1", "refresh_token": "rt1", "expires_at": time.time() + 3600})

    async def fail_refresh(tokens):
        raise AssertionError("should not refresh a non-expired token")

    monkeypatch.setattr(auth_mod, "_refresh", fail_refresh)

    assert await auth_mod.get_valid_access_token() == "at1"


async def test_get_valid_access_token_refreshes_when_expired(monkeypatch):
    auth_mod._save_tokens({"access_token": "stale", "refresh_token": "rt1", "expires_at": time.time() - 10})

    async def fake_refresh(tokens):
        refreshed = {**tokens, "access_token": "fresh", "expires_at": time.time() + 3600}
        auth_mod._save_tokens(refreshed)
        return refreshed

    monkeypatch.setattr(auth_mod, "_refresh", fake_refresh)

    token = await auth_mod.get_valid_access_token()

    assert token == "fresh"
    assert auth_mod._load_tokens()["access_token"] == "fresh"


async def test_is_connected_and_disconnect_round_trip():
    assert auth_mod.is_connected() is False
    auth_mod._save_tokens({"access_token": "at1", "refresh_token": "rt1", "expires_at": time.time() + 3600})
    assert auth_mod.is_connected() is True

    auth_mod.disconnect()

    assert auth_mod.is_connected() is False
    assert auth_mod._load_tokens() is None
