"""Twitter/X scraper using the v2 API Bearer token."""
from __future__ import annotations

import os
from typing import AsyncIterator

import httpx


class TwitterScraper:
    BASE = "https://api.twitter.com/2"

    def __init__(self):
        self.token = os.getenv("TWITTER_BEARER_TOKEN", "")
        self.headers = {"Authorization": f"Bearer {self.token}"}

    async def search_recent(self, query: str, max_results: int = 100) -> list[dict]:
        if not self.token:
            return []

        params = {
            "query": query,
            "max_results": min(max_results, 100),
            "tweet.fields": "created_at,public_metrics,author_id,text",
            "expansions": "author_id",
            "user.fields": "username,public_metrics,verified",
        }

        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"{self.BASE}/tweets/search/recent",
                headers=self.headers,
                params=params,
                timeout=15.0,
            )
            res.raise_for_status()
            return res.json().get("data", [])

    async def stream_filtered(self, rules: list[dict]) -> AsyncIterator[dict]:
        """Filtered stream — yields tweets matching the configured rules."""
        # TODO: implement Twitter v2 filtered stream
        if False:  # type: ignore[unreachable]
            yield {}
