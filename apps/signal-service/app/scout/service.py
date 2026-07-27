"""YouTube scout service: channel watching, transcript analysis, live feed.

No YouTube API key needed: channel RSS feeds + youtube-transcript-api +
oEmbed cover discovery, content and metadata. Analysis uses the agent LLM
when a key is configured and falls back to the heuristic extractor.
"""
from __future__ import annotations

import asyncio
import itertools
import json
import logging
import os
import re
import time
from collections import deque
from pathlib import Path

import httpx

from .extract import extract, parse_rss, parse_video_id

log = logging.getLogger(__name__)

POLL_INTERVAL_S = float(os.getenv("SCOUT_POLL_S", "180"))
STATE_PATH = Path(os.getenv("SCOUT_STATE_PATH", "data/scout_state.json"))
FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={cid}"
OEMBED_URL = "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid}&format=json"

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; BitPrivat/1.0)"}

LLM_SYSTEM = (
    "You extract actionable trading content from a YouTube video transcript. "
    "Respond with ONLY a JSON object: {\"assets\": [{\"symbol\": str, \"mentions\": int}], "
    "\"sentiment\": float in [-1,1], "
    "\"signals\": [{\"asset\": str, \"direction\": \"buy\"|\"sell\", \"confidence\": float in [0,1], \"reasoning\": str}], "
    "\"strategies\": [{\"strategy\": str, \"why\": str, \"params\": {}}]}. "
    "Symbols use Yahoo style (BTC-USD, AAPL). strategy must be one of: {names}. "
    "Only include signals the speaker actually implies. No prose outside JSON."
)


class ScoutService:
    def __init__(self) -> None:
        self.channels: dict[str, dict] = {}
        self.seen: set[str] = set()
        self.analyses: deque[dict] = deque(maxlen=200)
        self._ids = itertools.count(1)
        self._running = False
        self.last_poll: float | None = None
        self._load()

    # ── persistence (channels + seen ids survive restarts) ────────────────

    def _load(self) -> None:
        try:
            raw = json.loads(STATE_PATH.read_text())
            self.channels = raw.get("channels", {})
            self.seen = set(raw.get("seen", []))
        except Exception:
            pass

    def _save(self) -> None:
        try:
            STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
            STATE_PATH.write_text(
                json.dumps({"channels": self.channels, "seen": sorted(self.seen)[-3000:]})
            )
        except Exception as exc:
            log.warning("scout state save failed: %r", exc)

    # ── channels ──────────────────────────────────────────────────────────

    async def resolve_channel(self, ref: str) -> dict:
        """Accept a channel id (UC…), @handle, or any channel/video URL."""
        ref = ref.strip()
        m = re.search(r"(UC[0-9A-Za-z_-]{22})", ref)
        cid = m.group(1) if m else None
        if not cid:
            # Resolve handle/URL by scraping the channel page for its id.
            url = ref if ref.startswith("http") else f"https://www.youtube.com/{ref.lstrip('@') and '@' + ref.lstrip('@')}"
            async with httpx.AsyncClient(timeout=15, headers=_HEADERS, follow_redirects=True) as client:
                r = await client.get(url)
                r.raise_for_status()
                m = re.search(r'"channelId":"(UC[0-9A-Za-z_-]{22})"', r.text)
                if not m:
                    raise ValueError("Could not find a channel id at that reference")
                cid = m.group(1)
        # Name via the feed itself (also validates the id).
        async with httpx.AsyncClient(timeout=15, headers=_HEADERS) as client:
            r = await client.get(FEED_URL.format(cid=cid))
            r.raise_for_status()
            name = re.search(r"<title>([^<]+)</title>", r.text)
        return {"id": cid, "name": name.group(1) if name else cid}

    async def watch(self, ref: str) -> dict:
        ch = await self.resolve_channel(ref)
        self.channels[ch["id"]] = ch
        self._save()
        return ch

    def unwatch(self, cid: str) -> bool:
        removed = self.channels.pop(cid, None) is not None
        if removed:
            self._save()
        return removed

    # ── analysis ──────────────────────────────────────────────────────────

    async def _fetch_transcript(self, video_id: str) -> str:
        def _get() -> str:
            from youtube_transcript_api import YouTubeTranscriptApi

            chunks = YouTubeTranscriptApi().fetch(video_id, languages=["en", "en-US", "en-GB"])
            return " ".join(c.text for c in chunks)

        return await asyncio.to_thread(_get)

    async def _fetch_title(self, video_id: str) -> dict:
        async with httpx.AsyncClient(timeout=10, headers=_HEADERS) as client:
            r = await client.get(OEMBED_URL.format(vid=video_id))
            r.raise_for_status()
            data = r.json()
            return {"title": data.get("title", video_id), "channel": data.get("author_name", "")}

    async def _analyze_with_llm(self, title: str, transcript: str) -> dict | None:
        from app.agent.providers import ANTHROPIC_API_KEY, OPENAI_API_KEY, complete
        from app.backtest.strategies import STRATEGIES

        if not (ANTHROPIC_API_KEY or OPENAI_API_KEY):
            return None
        system = LLM_SYSTEM.replace("{names}", ", ".join(sorted(STRATEGIES)))
        try:
            text = await complete([
                {"role": "system", "content": system},
                {"role": "user", "content": f"Title: {title}\n\nTranscript (may be truncated):\n{transcript[:24000]}"},
            ])
            body = re.search(r"\{.*\}", str(text), re.S)
            if not body:
                return None
            data = json.loads(body.group(0))
            valid = set(STRATEGIES)
            data["strategies"] = [s for s in data.get("strategies", []) if s.get("strategy") in valid]
            data["engine"] = "llm"
            return data
        except Exception as exc:
            log.warning("scout LLM analysis failed, falling back to heuristic: %r", exc)
            return None

    async def analyze_video(self, video_id: str, title: str | None = None, channel: str | None = None) -> dict:
        if title is None or channel is None:
            try:
                meta = await self._fetch_title(video_id)
                title = title or meta["title"]
                channel = channel or meta["channel"]
            except Exception:
                title = title or video_id
                channel = channel or ""
        transcript = ""
        transcript_error: str | None = None
        try:
            transcript = await self._fetch_transcript(video_id)
        except Exception as exc:
            transcript_error = f"{type(exc).__name__}"
        analysis = await self._analyze_with_llm(title, transcript) if transcript else None
        if analysis is None:
            analysis = extract(title, transcript)
        record = {
            "id": next(self._ids),
            "video_id": video_id,
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "title": title,
            "channel": channel,
            "analyzed_at": time.time(),
            "transcript_chars": len(transcript),
            "transcript_error": transcript_error,
            **analysis,
        }
        self.analyses.appendleft(record)
        self.seen.add(video_id)
        return record

    # ── instant validation ────────────────────────────────────────────────

    async def quick_backtest(self, analysis_id: int, strategy_index: int, symbol: str | None = None) -> dict:
        """Backtest a suggested strategy on the video's top asset, now."""
        from datetime import datetime, timedelta, timezone

        from app.backtest.data import HistoricalDataLoader
        from app.backtest.engine import Backtest, _asset_class
        from app.backtest.metrics import compute_metrics
        from app.backtest.strategies import STRATEGIES

        rec = next((a for a in self.analyses if a["id"] == analysis_id), None)
        if rec is None:
            raise ValueError("Unknown analysis id")
        if not 0 <= strategy_index < len(rec["strategies"]):
            raise ValueError("Unknown strategy index")
        suggestion = rec["strategies"][strategy_index]
        sym = symbol or (rec["assets"][0]["symbol"] if rec["assets"] else "BTC-USD")

        loader = HistoricalDataLoader()
        end = datetime.now(timezone.utc)
        start = end - timedelta(days=180)
        bars = await loader.load(sym, start, end, "1h")
        if len(bars) < 100:
            bars = await loader.load(sym, end - timedelta(days=365 * 2), end, "1d")
        if len(bars) < 60:
            raise ValueError(f"Not enough history for {sym}")

        engine = Backtest()
        strat = STRATEGIES[suggestion["strategy"]](**(suggestion.get("params") or {}))
        interval = "1h" if len(bars) >= 100 else "1d"
        trades, equity = engine.run(bars, strat, symbol=sym, interval=interval)
        metrics = compute_metrics(
            initial_capital=engine.initial_capital,
            equity=equity,
            trades=trades,
            interval=interval,
            asset_class=_asset_class(sym),
        )
        return {
            "analysis_id": analysis_id,
            "strategy": suggestion["strategy"],
            "symbol": sym,
            "interval": interval,
            "bars": len(bars),
            "total_return_pct": round(metrics.total_return_pct, 2),
            "sharpe_ratio": round(metrics.sharpe_ratio, 2),
            "max_drawdown_pct": round(metrics.max_drawdown_pct, 2),
            "total_trades": metrics.total_trades,
            "win_rate": round(metrics.win_rate, 1),
        }

    # ── live loop ─────────────────────────────────────────────────────────

    async def poll_once(self) -> list[dict]:
        """Check every watched channel's RSS; analyze videos we haven't seen."""
        fresh: list[dict] = []
        async with httpx.AsyncClient(timeout=15, headers=_HEADERS) as client:
            for cid, ch in list(self.channels.items()):
                try:
                    r = await client.get(FEED_URL.format(cid=cid))
                    r.raise_for_status()
                    for entry in parse_rss(r.text)[:5]:
                        if entry["video_id"] in self.seen:
                            continue
                        rec = await self.analyze_video(
                            entry["video_id"], title=entry["title"], channel=ch["name"]
                        )
                        fresh.append(rec)
                except Exception as exc:
                    log.warning("scout poll failed for %s: %r", cid, exc)
        if fresh:
            self._save()
        self.last_poll = time.time()
        return fresh

    async def run(self) -> None:
        self._running = True
        log.info("YouTube scout started: %d channels, poll every %.0fs", len(self.channels), POLL_INTERVAL_S)
        while self._running:
            try:
                fresh = await self.poll_once()
                if fresh:
                    log.info("scout: analyzed %d new videos", len(fresh))
            except Exception as exc:
                log.warning("scout loop error: %r", exc)
            await asyncio.sleep(POLL_INTERVAL_S)

    def stop(self) -> None:
        self._running = False

    def status(self) -> dict:
        return {
            "channels": list(self.channels.values()),
            "seen_videos": len(self.seen),
            "analyses": len(self.analyses),
            "last_poll": self.last_poll,
            "poll_interval_s": POLL_INTERVAL_S,
            "running": self._running,
        }


scout_service = ScoutService()
