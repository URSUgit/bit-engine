"""Google OAuth2 for a personal YouTube connection: authorize URL, code
exchange, token refresh, and on-disk storage.

Standalone from the platform's NextAuth/Prisma login (`apps/web`) — this is
a single-user credential for a personal YouTube connection, stored the same
lightweight way `app/scout/service.py` persists `scout_state.json` (plain
JSON file, sync read/write, broad try/except — see that file's `_load`/
`_save`), just kept in its own file since it holds a credential rather than
general app state.
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from urllib.parse import urlencode

import httpx

log = logging.getLogger(__name__)

CLIENT_ID = os.getenv("YOUTUBE_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("YOUTUBE_CLIENT_SECRET", "")
REDIRECT_URI = os.getenv("YOUTUBE_REDIRECT_URI", "http://localhost:8001/api/v1/youtube/callback")
TOKEN_PATH = Path(os.getenv("YOUTUBE_TOKEN_PATH", "data/youtube_oauth.json"))

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/youtube.readonly"

_EXPIRY_SLACK_S = 60


def _load_tokens() -> dict | None:
    try:
        return json.loads(TOKEN_PATH.read_text())
    except Exception:
        return None


def _save_tokens(tokens: dict) -> None:
    try:
        TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_PATH.write_text(json.dumps(tokens))
    except Exception as exc:
        log.warning("youtube token save failed: %r", exc)


def build_authorize_url(state: str) -> str:
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "access_type": "offline",
        "prompt": "consent",
        "scope": SCOPE,
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


async def exchange_code(code: str) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "redirect_uri": REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )
        r.raise_for_status()
        payload = r.json()

    tokens = {
        "access_token": payload["access_token"],
        "refresh_token": payload.get("refresh_token"),
        "expires_at": time.time() + payload.get("expires_in", 3600),
    }
    if not tokens["refresh_token"]:
        # Google omits refresh_token on re-consent if one was already issued
        # to this client for this account — keep the one we already have.
        existing = _load_tokens()
        if existing and existing.get("refresh_token"):
            tokens["refresh_token"] = existing["refresh_token"]
    _save_tokens(tokens)
    return tokens


async def _refresh(tokens: dict) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            TOKEN_URL,
            data={
                "refresh_token": tokens["refresh_token"],
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "grant_type": "refresh_token",
            },
        )
        r.raise_for_status()
        payload = r.json()

    refreshed = {
        **tokens,
        "access_token": payload["access_token"],
        "expires_at": time.time() + payload.get("expires_in", 3600),
    }
    _save_tokens(refreshed)
    return refreshed


async def get_valid_access_token() -> str | None:
    tokens = _load_tokens()
    if not tokens or not tokens.get("refresh_token"):
        return None
    if tokens.get("expires_at", 0) - _EXPIRY_SLACK_S <= time.time():
        try:
            tokens = await _refresh(tokens)
        except Exception as exc:
            log.warning("youtube token refresh failed: %r", exc)
            return None
    return tokens["access_token"]


def is_connected() -> bool:
    tokens = _load_tokens()
    return bool(tokens and tokens.get("refresh_token"))


def disconnect() -> None:
    try:
        TOKEN_PATH.unlink(missing_ok=True)
    except Exception as exc:
        log.warning("youtube token delete failed: %r", exc)
