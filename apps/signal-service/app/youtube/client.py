"""YouTube Data API v3 client: subscriptions, liked videos, arbitrary
playlists — normalized into the same {video_id,title,channel,thumbnail,
published_at,url} shape the existing Scout live analyzer already consumes
(`url` matches exactly what `app/scout/extract.py`'s `parse_video_id` and
the `/analyze_stream` endpoint expect, so no translation is needed
downstream).

All calls go through httpx.AsyncClient, matching the codebase's existing
async-HTTP idiom (see `app/scout/service.py`) rather than the sync-only
google-api-python-client.
"""
from __future__ import annotations

import re
import time
from urllib.parse import parse_qs, urlparse

import httpx

from . import auth

API_BASE = "https://www.googleapis.com/youtube/v3"

# search.list costs 100 quota units/call against a default 10,000/day budget
# (~100 searches/day). Trading-channel discovery queries repeat a lot
# (users re-running "crypto day trading strategy" etc.), so caching the
# first page by query stretches that budget considerably.
_SEARCH_CACHE_TTL = 6 * 3600
_search_cache: dict[str, tuple[float, dict]] = {}


class NotConnected(Exception):
    """Raised when a call is made before the user has connected YouTube."""


class QuotaExceeded(Exception):
    """Raised when the YouTube Data API rejects a call for exceeding its daily
    quota — most likely from `search.list`, which costs 100 units/call against
    a default 10,000/day budget (i.e. ~100 searches/day)."""


async def _get(path: str, params: dict) -> dict:
    token = await auth.get_valid_access_token()
    if not token:
        raise NotConnected("YouTube account not connected")
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(
            f"{API_BASE}/{path}",
            params=params,
            headers={"Authorization": f"Bearer {token}"},
        )
        if r.status_code == 403 and "quota" in r.text.lower():
            raise QuotaExceeded("YouTube API daily quota exceeded — try again later")
        r.raise_for_status()
        return r.json()


def _video_from_item(item: dict) -> dict:
    snippet = item.get("snippet", {})
    item_id = item.get("id")
    # playlistItems.list: id is the playlist-item id, the video id is nested;
    # search.list: id is {"videoId": ...} instead.
    video_id = (snippet.get("resourceId") or {}).get("videoId") or (
        item_id.get("videoId") if isinstance(item_id, dict) else item_id
    )
    thumbnails = snippet.get("thumbnails") or {}
    thumb = (thumbnails.get("medium") or thumbnails.get("default") or thumbnails.get("high") or {}).get("url")
    return {
        "video_id": video_id,
        "title": snippet.get("title", ""),
        "channel": snippet.get("videoOwnerChannelTitle") or snippet.get("channelTitle", ""),
        "channel_id": snippet.get("videoOwnerChannelId") or snippet.get("channelId"),
        "thumbnail": thumb,
        "published_at": snippet.get("publishedAt"),
        "url": f"https://www.youtube.com/watch?v={video_id}",
    }


def parse_playlist_id(url_or_id: str) -> str | None:
    """Accept a raw playlist id or a `...?list=...` URL, mirroring
    `app/scout/extract.py`'s `parse_video_id`."""
    s = url_or_id.strip()
    if "://" not in s and re.fullmatch(r"[A-Za-z0-9_-]{10,64}", s):
        return s
    qs = parse_qs(urlparse(s).query)
    values = qs.get("list")
    return values[0] if values else None


async def get_my_channel() -> dict:
    data = await _get("channels", {"mine": "true", "part": "snippet,contentDetails"})
    items = data.get("items") or []
    if not items:
        raise ValueError("No YouTube channel found for this account")
    item = items[0]
    related = item.get("contentDetails", {}).get("relatedPlaylists", {})
    thumbnails = item.get("snippet", {}).get("thumbnails") or {}
    return {
        "title": item.get("snippet", {}).get("title", ""),
        "thumbnail": (thumbnails.get("default") or {}).get("url"),
        "uploads_playlist_id": related.get("uploads"),
        "likes_playlist_id": related.get("likes"),
    }


async def list_subscriptions(page_token: str | None = None) -> dict:
    params = {"mine": "true", "part": "snippet", "maxResults": 50, "order": "alphabetical"}
    if page_token:
        params["pageToken"] = page_token
    data = await _get("subscriptions", params)
    channels = [
        {
            "channel_id": item["snippet"]["resourceId"]["channelId"],
            "title": item["snippet"]["title"],
            "thumbnail": (item["snippet"].get("thumbnails") or {}).get("default", {}).get("url"),
        }
        for item in data.get("items", [])
    ]
    return {"channels": channels, "next_page_token": data.get("nextPageToken")}


async def _playlist_items(playlist_id: str, max_results: int, page_token: str | None) -> dict:
    params = {"playlistId": playlist_id, "part": "snippet", "maxResults": max_results}
    if page_token:
        params["pageToken"] = page_token
    data = await _get("playlistItems", params)
    videos = [_video_from_item(item) for item in data.get("items", [])]
    return {"videos": videos, "next_page_token": data.get("nextPageToken")}


async def list_playlist_items(playlist_id: str, page_token: str | None = None) -> dict:
    return await _playlist_items(playlist_id, 50, page_token)


async def list_liked_videos(page_token: str | None = None) -> dict:
    channel = await get_my_channel()
    likes_id = channel.get("likes_playlist_id")
    if not likes_id:
        return {"videos": [], "next_page_token": None}
    return await _playlist_items(likes_id, 50, page_token)


async def search_videos(query: str, page_token: str | None = None, max_results: int = 25) -> dict:
    """Keyword video search across all of YouTube (not limited to the
    connected account's subscriptions), via `search.list`. First-page results
    are cached by query for `_SEARCH_CACHE_TTL` since search.list is by far
    the most expensive call this client makes."""
    cache_key = query.strip().lower()
    if page_token is None:
        cached = _search_cache.get(cache_key)
        if cached and time.time() - cached[0] < _SEARCH_CACHE_TTL:
            return cached[1]

    params = {"q": query, "part": "snippet", "type": "video", "maxResults": max_results, "order": "relevance"}
    if page_token:
        params["pageToken"] = page_token
    data = await _get("search", params)
    videos = [_video_from_item(item) for item in data.get("items", [])]
    result = {"videos": videos, "next_page_token": data.get("nextPageToken")}

    if page_token is None:
        _search_cache[cache_key] = (time.time(), result)
    return result


async def list_subscription_feed(max_channels: int = 20) -> list[dict]:
    """Practical stand-in for YouTube's deprecated `activities.list(home=true)`
    subscription feed: pulls the N most recent uploads from each of the
    user's first `max_channels` subscriptions and merges them by recency.
    Quota-bounded by design, not a live paginated feed."""
    subs = await list_subscriptions()
    channel_ids = [c["channel_id"] for c in subs["channels"][:max_channels]]

    videos: list[dict] = []
    for i in range(0, len(channel_ids), 50):
        batch = channel_ids[i : i + 50]
        data = await _get("channels", {"id": ",".join(batch), "part": "contentDetails"})
        for item in data.get("items", []):
            uploads_id = item.get("contentDetails", {}).get("relatedPlaylists", {}).get("uploads")
            if not uploads_id:
                continue
            page = await _playlist_items(uploads_id, 5, None)
            videos.extend(page["videos"])

    videos.sort(key=lambda v: v.get("published_at") or "", reverse=True)
    return videos
