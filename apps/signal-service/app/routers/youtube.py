"""Connect the user's own YouTube account (OAuth2) and browse their
subscriptions feed / liked videos / an arbitrary playlist. Selecting a video
is handled entirely on the frontend by feeding its URL into the existing
`/api/v1/scout/analyze_stream` live-analysis pipeline — this router only
does account connection and video listing."""
from __future__ import annotations

import logging
import os
import secrets

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse

from app.youtube import auth, client

log = logging.getLogger(__name__)

router = APIRouter()

WEB_APP_URL = os.getenv("WEB_APP_URL", "http://localhost:3000")


@router.get("/authorize")
async def authorize():
    state = secrets.token_urlsafe(16)
    return RedirectResponse(auth.build_authorize_url(state))


@router.get("/callback")
async def callback(code: str | None = None, error: str | None = None, state: str | None = None):
    if error:
        return RedirectResponse(f"{WEB_APP_URL}/lab/scout/youtube?error={error}")
    if not code:
        return RedirectResponse(f"{WEB_APP_URL}/lab/scout/youtube?error=missing_code")
    try:
        await auth.exchange_code(code)
    except Exception as exc:
        log.warning("youtube oauth exchange failed: %r", exc)
        return RedirectResponse(f"{WEB_APP_URL}/lab/scout/youtube?error=exchange_failed")
    return RedirectResponse(f"{WEB_APP_URL}/lab/scout/youtube?connected=1")


@router.get("/status")
async def status():
    if not auth.is_connected():
        return {"connected": False, "channel": None}
    try:
        channel = await client.get_my_channel()
    except client.NotConnected:
        # A refresh_token was stored, but it no longer works (expired/revoked
        # on Google's side) — report as disconnected so the frontend prompts
        # to reconnect instead of showing a "connected" state that silently
        # fails on every tab.
        return {"connected": False, "channel": None}
    except Exception as exc:
        log.warning("youtube status channel lookup failed: %r", exc)
        channel = None
    return {"connected": True, "channel": channel}


@router.post("/disconnect")
async def disconnect():
    auth.disconnect()
    return {"connected": False}


def _require_connected() -> None:
    if not auth.is_connected():
        raise HTTPException(status_code=401, detail="Connect your YouTube account first")


@router.get("/subscriptions")
async def subscriptions(page_token: str | None = Query(None)):
    _require_connected()
    try:
        return await client.list_subscriptions(page_token)
    except client.NotConnected as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except client.QuotaExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc))


@router.get("/feed")
async def feed():
    _require_connected()
    try:
        return {"videos": await client.list_subscription_feed()}
    except client.NotConnected as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except client.QuotaExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc))


@router.get("/liked")
async def liked(page_token: str | None = Query(None)):
    _require_connected()
    try:
        return await client.list_liked_videos(page_token)
    except client.NotConnected as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except client.QuotaExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc))


@router.get("/search")
async def search(q: str = Query(..., min_length=2), page_token: str | None = Query(None)):
    _require_connected()
    try:
        return await client.search_videos(q, page_token)
    except client.NotConnected as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except client.QuotaExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc))


@router.get("/playlist")
async def playlist(id: str = Query(..., min_length=1), page_token: str | None = Query(None)):
    _require_connected()
    playlist_id = client.parse_playlist_id(id)
    if not playlist_id:
        raise HTTPException(status_code=422, detail="Not a recognizable playlist URL/id")
    try:
        return await client.list_playlist_items(playlist_id, page_token)
    except client.NotConnected as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except client.QuotaExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc))
