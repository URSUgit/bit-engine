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
from typing import AsyncIterator
from urllib.parse import quote, unquote

import httpx

from . import audio, vision
from .extract import (
    build_models,
    detect_guest,
    extract,
    extract_frame_findings,
    join_transcript,
    parse_rss,
    parse_video_id,
)
from .strategies_store import strategies_store

log = logging.getLogger(__name__)

POLL_INTERVAL_S = float(os.getenv("SCOUT_POLL_S", "180"))
STATE_PATH = Path(os.getenv("SCOUT_STATE_PATH", "data/scout_state.json"))
FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={cid}"
OEMBED_URL = "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid}&format=json"
SEARCH_URL = "https://www.youtube.com/results?search_query={q}"

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; BitPrivat/1.0)"}

# Rotated to autonomously scout for new trading channels without a YouTube
# API key (see `discover_channels`).
SEED_QUERIES = [
    "crypto day trading strategy",
    "bitcoin technical analysis live",
    "swing trading crypto signals",
    "altcoin trading strategy",
    "futures trading strategy crypto",
    "price action trading crypto",
    "crypto scalping strategy",
    "trading indicators explained",
]

AUTO_DISCOVER = os.getenv("SCOUT_AUTO_DISCOVER", "1") == "1"
DISCOVER_INTERVAL_S = float(os.getenv("SCOUT_DISCOVER_INTERVAL_S", "900"))
MAX_AUTO_CHANNELS = int(os.getenv("SCOUT_MAX_AUTO_CHANNELS", "12"))

# The search-scrape in discover_channels() is the least durable of Scout's
# no-API-key techniques (it regexes YouTube's internal ytInitialData blob,
# which can be reshuffled by a redesign, or return a consent/CAPTCHA page
# instead of results if the server IP gets flagged) — and either failure
# mode returns 0 candidates without raising, so nothing else would notice.
# This many consecutive empty auto-discovery cycles trips discovery_alert.
DISCOVERY_ALERT_CYCLES = int(os.getenv("SCOUT_DISCOVERY_ALERT_CYCLES", "5"))

# When a watched channel posts a video with no captions, the background
# poll loop used to give up and analyze the title alone. That's now a last
# resort: try chart/ticker OCR first (cheap), then audio transcription if
# OCR still finds nothing. Both are real network+CPU cost per video, so
# this can be turned off if the poll loop needs to stay light.
BG_WATCH_FALLBACK = os.getenv("SCOUT_BG_WATCH_FALLBACK", "1") == "1"


def _transcript_proxy_config():
    """YouTube blocks unauthenticated transcript fetches from most cloud and
    even many residential IPs (raises IpBlocked/RequestBlocked). The library's
    only real fix is routing through a rotating proxy; wire one up only if
    the operator has configured credentials, otherwise fetch direct exactly
    as before. See https://github.com/jdepoix/youtube-transcript-api#working-around-ip-bans-requestblocked-or-ipblocked-exception
    """
    ws_user = os.getenv("SCOUT_WEBSHARE_PROXY_USERNAME")
    ws_pass = os.getenv("SCOUT_WEBSHARE_PROXY_PASSWORD")
    if ws_user and ws_pass:
        from youtube_transcript_api.proxies import WebshareProxyConfig

        return WebshareProxyConfig(proxy_username=ws_user, proxy_password=ws_pass)

    proxy_url = os.getenv("SCOUT_TRANSCRIPT_PROXY_URL")
    if proxy_url:
        from youtube_transcript_api.proxies import GenericProxyConfig

        return GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)

    return None

# Channel name immediately followed (within a bounded window) by its browse
# id in YouTube's search-results JSON blob (`ytInitialData`).
_OWNER_RE = re.compile(r'"text":"([^"]{2,80})".{0,400}?"browseId":"(UC[0-9A-Za-z_-]{22})"', re.S)

# Channel "About" page scraping — self-published only (real avatar photo,
# own description, own external/social links), no third-party lookups and
# no attempt to identify individual people in multi-host videos.
_CHANNEL_AVATAR_RE = re.compile(r'<meta property="og:image" content="([^"]+)"')
_CHANNEL_DESC_RE = re.compile(r'"description":"((?:[^"\\]|\\.)*)"')
_CHANNEL_LINK_RE = re.compile(
    r'"channelExternalLinkViewModel":\{"title":\{"content":"([^"]*)".{0,600}?q=([^"\\]+)"', re.S
)

LLM_SYSTEM = (
    "You extract actionable trading content from a YouTube video transcript. The "
    "transcript is prefixed with [Ns] markers giving the video second each part "
    "was spoken. Respond with ONLY a JSON object: {\"assets\": [{\"symbol\": str, \"mentions\": int}], "
    "\"sentiment\": float in [-1,1], "
    "\"signals\": [{\"asset\": str, \"direction\": \"buy\"|\"sell\", \"confidence\": float in [0,1], "
    "\"reasoning\": str, \"timestamp_s\": number|null}], "
    "\"strategies\": [{\"strategy\": str, \"why\": str, \"params\": {}, \"timestamp_s\": number|null}]}. "
    "timestamp_s is the nearest preceding [Ns] marker to where that signal/strategy was actually said — "
    "it's used to anchor a real backtest at the trader's exact stated moment, so it must come from the "
    "markers, never guessed. Symbols use Yahoo style (BTC-USD, AAPL). strategy must be one of: {names}. "
    "Only include signals the speaker actually implies. No prose outside JSON."
)


class ScoutService:
    def __init__(self) -> None:
        self.channels: dict[str, dict] = {}
        self.seen: set[str] = set()
        self.analyses: deque[dict] = deque(maxlen=200)
        self.discovered: deque[dict] = deque(maxlen=60)
        self._channel_about_cache: dict[str, dict] = {}
        self.discovery_log: deque[dict] = deque(maxlen=40)
        self._ids = itertools.count(1)
        self._running = False
        self.last_poll: float | None = None
        self.last_discover: float | None = None
        self.discovery_stale_cycles = 0
        self.discovery_alert: str | None = None
        self._seed_cycle = itertools.cycle(SEED_QUERIES)
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

    async def watch(self, ref: str, auto: bool = False, query: str | None = None) -> dict:
        ch = await self.resolve_channel(ref)
        ch["auto"] = auto
        if query:
            ch["found_via"] = query
        self.channels[ch["id"]] = ch
        self._save()
        return ch

    def unwatch(self, cid: str) -> bool:
        removed = self.channels.pop(cid, None) is not None
        if removed:
            self._save()
        return removed

    async def latest_video(self, cid: str) -> dict | None:
        """Most recent video for a channel via its RSS feed — no API key, no
        quota. Lets the browse UI show live-analysis progress for a channel
        right after it's watched, instead of waiting for the next background
        poll cycle (up to `POLL_INTERVAL_S` away)."""
        async with httpx.AsyncClient(timeout=15, headers=_HEADERS) as client:
            r = await client.get(FEED_URL.format(cid=cid))
            r.raise_for_status()
        entries = parse_rss(r.text)
        if not entries:
            return None
        entry = entries[0]
        return {
            "video_id": entry["video_id"],
            "title": entry["title"],
            "url": f"https://www.youtube.com/watch?v={entry['video_id']}",
        }

    # ── autonomous discovery ──────────────────────────────────────────────

    async def discover_channels(self, query: str, limit: int = 6) -> list[dict]:
        """Scrape a YouTube search for candidate trading channels — no API
        key required. Returns candidates and records the search for the
        live discovery feed regardless of whether anything gets watched."""
        candidates: list[dict] = []
        try:
            async with httpx.AsyncClient(timeout=15, headers=_HEADERS, follow_redirects=True) as client:
                r = await client.get(SEARCH_URL.format(q=quote(query)))
                r.raise_for_status()
                html = r.text
            found: dict[str, str] = {}
            for name, cid in _OWNER_RE.findall(html):
                if cid in found or cid in self.channels:
                    continue
                found[cid] = name
                if len(found) >= limit:
                    break
            candidates = [
                {"id": cid, "name": name, "query": query, "watching": False}
                for cid, name in found.items()
            ]
        except Exception as exc:
            log.warning("scout discovery failed for %r: %r", query, exc)
        self.discovery_log.appendleft({
            "query": query,
            "found": len(candidates),
            "at": time.time(),
        })
        for c in candidates:
            if not any(d["id"] == c["id"] for d in self.discovered):
                self.discovered.appendleft(c)
        self.last_discover = time.time()
        return candidates

    async def auto_discover_and_watch(self) -> list[dict]:
        """One autonomous discovery cycle: search a rotating seed query and
        start watching a couple of promising new channels, bounded so the
        feed doesn't run away."""
        auto_count = sum(1 for c in self.channels.values() if c.get("auto"))
        if auto_count >= MAX_AUTO_CHANNELS:
            return []
        query = next(self._seed_cycle)
        candidates = await self.discover_channels(query, limit=4)

        if candidates:
            self.discovery_stale_cycles = 0
            self.discovery_alert = None
        else:
            self.discovery_stale_cycles += 1
            if self.discovery_stale_cycles >= DISCOVERY_ALERT_CYCLES:
                stale_min = self.discovery_stale_cycles * DISCOVER_INTERVAL_S / 60
                self.discovery_alert = (
                    f"Autonomous channel discovery has found 0 candidates for "
                    f"{self.discovery_stale_cycles} consecutive cycles (~{stale_min:.0f}m). "
                    "The search-scrape likely broke (YouTube markup change) or the server IP "
                    "is being blocked/CAPTCHA'd. Watching existing channels is unaffected — "
                    "only finding new ones has stalled."
                )
                if self.discovery_stale_cycles == DISCOVERY_ALERT_CYCLES:
                    log.error("scout discovery health: %s", self.discovery_alert)
                else:
                    log.warning("scout discovery health (still stale): %s", self.discovery_alert)

        watched: list[dict] = []
        for c in candidates:
            if auto_count >= MAX_AUTO_CHANNELS:
                break
            try:
                ch = await self.watch(c["id"], auto=True, query=query)
                watched.append(ch)
                auto_count += 1
            except Exception as exc:
                log.warning("scout auto-watch failed for %s: %r", c["id"], exc)
        return watched

    # ── analysis ──────────────────────────────────────────────────────────

    async def _fetch_transcript(self, video_id: str) -> list[dict]:
        """Timestamped transcript chunks — [{text, start}, ...]. Timing is
        kept (not flattened here) so every downstream extraction can anchor
        a signal/strategy/clue to the exact video second it was said."""
        def _get() -> list[dict]:
            from youtube_transcript_api import YouTubeTranscriptApi

            api = YouTubeTranscriptApi(proxy_config=_transcript_proxy_config())
            chunks = api.fetch(video_id, languages=["en", "en-US", "en-GB"])
            return [{"text": c.text, "start": c.start} for c in chunks]

        return await asyncio.to_thread(_get)

    async def _fetch_title(self, video_id: str) -> dict:
        async with httpx.AsyncClient(timeout=10, headers=_HEADERS) as client:
            r = await client.get(OEMBED_URL.format(vid=video_id))
            r.raise_for_status()
            data = r.json()
            return {
                "title": data.get("title", video_id),
                "channel": data.get("author_name", ""),
                "channel_url": data.get("author_url"),
                "thumbnail": data.get("thumbnail_url"),
            }

    async def _fetch_published_at(self, video_id: str) -> str | None:
        """Upload date, scraped off the watch page (no API key). Needed to
        turn a transcript timestamp into an absolute moment in time — the
        anchor a real backtest replays from."""
        try:
            async with httpx.AsyncClient(timeout=10, headers=_HEADERS) as client:
                r = await client.get(f"https://www.youtube.com/watch?v={video_id}")
                r.raise_for_status()
            m = re.search(r'"publishDate":"(\d{4}-\d{2}-\d{2})"', r.text)
            return m.group(1) if m else None
        except Exception:
            return None

    async def _analyze_with_llm(self, title: str, transcript: str, segments: list[dict] | None = None) -> dict | None:
        from app.agent.providers import ANTHROPIC_API_KEY, OPENAI_API_KEY, complete
        from app.backtest.strategies import STRATEGIES

        if not (ANTHROPIC_API_KEY or OPENAI_API_KEY):
            return None
        system = LLM_SYSTEM.replace("{names}", ", ".join(sorted(STRATEGIES)))
        marked = (
            " ".join(f"[{seg.get('start', 0):.0f}s] {seg.get('text', '')}" for seg in segments)
            if segments else transcript
        )
        try:
            text = await complete([
                {"role": "system", "content": system},
                {"role": "user", "content": f"Title: {title}\n\nTranscript (may be truncated):\n{marked[:24000]}"},
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

    async def _build_analysis(self, title: str, segments: list[dict], channel: str) -> dict:
        """Run the LLM path if configured, else the heuristic extractor;
        shared by analyze_video and analyze_video_live."""
        from .extract import extract_clues

        transcript, offset_index = join_transcript(segments) if segments else ("", [])
        base_offset = len(title) + 1
        analysis = await self._analyze_with_llm(title, transcript, segments) if transcript else None
        if analysis is None:
            analysis = extract(title, transcript, channel=channel or "", segments=segments)
        elif "models" not in analysis:
            clues = extract_clues(f"{title}\n{transcript}", offset_index, base_offset)
            analysis["clues"] = clues
            analysis["models"] = build_models(
                analysis.get("strategies", []), analysis.get("assets", []), clues, channel or ""
            )
        return analysis

    async def analyze_video(
        self,
        video_id: str,
        title: str | None = None,
        channel: str | None = None,
        published_at: str | None = None,
    ) -> dict:
        thumbnail: str | None = None
        channel_url: str | None = None
        if title is None or channel is None:
            try:
                meta = await self._fetch_title(video_id)
                title = title or meta["title"]
                channel = channel or meta["channel"]
                thumbnail = meta.get("thumbnail")
                channel_url = meta.get("channel_url")
            except Exception:
                title = title or video_id
                channel = channel or ""
        segments: list[dict] = []
        transcript_error: str | None = None
        try:
            segments = await self._fetch_transcript(video_id)
        except Exception as exc:
            transcript_error = f"{type(exc).__name__}"
        if published_at is None:
            published_at = await self._fetch_published_at(video_id)
        analysis = await self._build_analysis(title, segments, channel)

        analysis_source = "transcript" if segments else "title"
        frame_findings: dict | None = None
        if not segments and BG_WATCH_FALLBACK:
            # No captions — actually watch/listen instead of guessing from
            # the title alone. Chart/ticker OCR first (cheap); audio
            # transcription only if that still leaves nothing to extract.
            try:
                frame_findings = await self._ocr_frame_findings(video_id)
            except Exception as exc:
                log.warning("scout background OCR fallback failed for %s: %r", video_id, exc)
            if frame_findings is not None:
                self._merge_frame_findings(analysis, frame_findings, channel or "")
                analysis_source = "vision"
            if not analysis.get("assets"):
                audio_segments = await audio.transcribe(video_id)
                if audio_segments:
                    analysis = await self._build_analysis(title, audio_segments, channel)
                    if frame_findings is not None:
                        self._merge_frame_findings(analysis, frame_findings, channel or "")
                    segments = audio_segments
                    analysis_source = "audio"

        transcript, _ = join_transcript(segments)
        record = {
            "id": next(self._ids),
            "video_id": video_id,
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "title": title,
            "channel": channel,
            "video_thumbnail": thumbnail,
            "analyzed_at": time.time(),
            "published_at": published_at,
            "transcript_chars": len(transcript),
            "transcript_error": transcript_error,
            "analysis_source": analysis_source,
            "frame_findings": frame_findings,
            **analysis,
        }
        self.analyses.appendleft(record)
        self.seen.add(video_id)
        strategies_store.add_models(
            analysis.get("models", []), video_id, title, record["url"], thumbnail, channel_url
        )
        return record

    def _merge_frame_findings(self, analysis: dict, frame_findings: dict, trader: str) -> None:
        """Fold OCR-derived assets/clues into the transcript-derived
        analysis in place. Frame mentions add to spoken mention counts;
        frame clues only fill gaps left by spoken clues (spoken language
        wins on conflict). Rebuilds `models` so named strategy cards reflect
        the merged pairs/clues."""
        counts = {a["symbol"]: a["mentions"] for a in analysis.get("assets", [])}
        for a in frame_findings.get("assets", []):
            counts[a["symbol"]] = counts.get(a["symbol"], 0) + a["mentions"]
        analysis["assets"] = sorted(
            ({"symbol": s, "mentions": m} for s, m in counts.items()),
            key=lambda x: -x["mentions"],
        )
        clues = dict(analysis.get("clues") or {})
        frame_clues = frame_findings.get("clues") or {}
        for key, val in frame_clues.items():
            if key == "notes" or val is None:
                continue
            if clues.get(key) is None:
                clues[key] = val
        analysis["clues"] = clues
        analysis["models"] = build_models(
            analysis.get("strategies", []), analysis["assets"], clues, trader
        )

    async def _ocr_frame_findings(self, video_id: str) -> dict | None:
        """Consume vision.analyze_frames without emitting SSE events — for
        the background-loop fallback (analyze_video), which has no live
        listener unlike analyze_video_live's own inline OCR loop below."""
        frame_texts: list[str] = []
        async for ev in vision.analyze_frames(video_id):
            if ev.get("stage") == "result" and not ev.get("skipped"):
                frame_texts = ev.get("frame_texts", [])
        if not frame_texts:
            return None
        return extract_frame_findings(" ".join(frame_texts))

    async def analyze_video_live(
        self, video_id: str, title: str | None = None, channel: str | None = None
    ) -> AsyncIterator[dict]:
        """Same analysis as analyze_video (including its OCR/audio watch
        fallback for caption-less videos), plus a lightweight guest-speaker
        heuristic, emitting one event per pipeline stage for a live SSE
        view."""
        try:
            yield {"stage": "resolving", "video_id": video_id}

            thumbnail: str | None = None
            channel_url: str | None = None
            if title is None or channel is None:
                yield {"stage": "fetching_title"}
                try:
                    meta = await self._fetch_title(video_id)
                    title = title or meta["title"]
                    channel = channel or meta["channel"]
                    thumbnail = meta.get("thumbnail")
                    channel_url = meta.get("channel_url")
                except Exception:
                    title = title or video_id
                    channel = channel or ""

            yield {"stage": "fetching_transcript"}
            segments: list[dict] = []
            transcript_error: str | None = None
            try:
                segments = await self._fetch_transcript(video_id)
            except Exception as exc:
                transcript_error = f"{type(exc).__name__}"
                yield {"stage": "transcript_error", "error": transcript_error}

            published_at = await self._fetch_published_at(video_id)

            yield {"stage": "extracting_signals"}
            analysis = await self._build_analysis(title, segments, channel)
            transcript, _ = join_transcript(segments)

            yield {"stage": "checking_guest"}
            guest = detect_guest(title)

            yield {"stage": "downloading_frames"}
            frame_texts: list[str] = []
            async for ev in vision.analyze_frames(video_id):
                if ev.get("stage") == "frame":
                    yield {
                        "stage": "ocr_frame",
                        "index": ev["index"],
                        "total": ev["total"],
                        "found": ev["text"],
                    }
                elif ev.get("skipped"):
                    yield {"stage": "frames_skipped", "reason": ev.get("reason")}
                else:
                    frame_texts = ev.get("frame_texts", [])

            frame_findings = None
            if frame_texts:
                yield {"stage": "merging_frame_findings"}
                frame_findings = extract_frame_findings(" ".join(frame_texts))
                self._merge_frame_findings(analysis, frame_findings, channel or "")

            analysis_source = "transcript" if segments else "title"
            if frame_findings is not None:
                analysis_source = "vision"
            if not segments and not analysis.get("assets"):
                yield {"stage": "transcribing_audio"}
                audio_segments = await audio.transcribe(video_id)
                if audio_segments:
                    analysis = await self._build_analysis(title, audio_segments, channel)
                    if frame_findings is not None:
                        self._merge_frame_findings(analysis, frame_findings, channel or "")
                    segments = audio_segments
                    transcript, _ = join_transcript(segments)
                    analysis_source = "audio"

            record = {
                "id": next(self._ids),
                "video_id": video_id,
                "url": f"https://www.youtube.com/watch?v={video_id}",
                "title": title,
                "channel": channel,
                "video_thumbnail": thumbnail,
                "analyzed_at": time.time(),
                "published_at": published_at,
                "transcript_chars": len(transcript),
                "transcript_error": transcript_error,
                "analysis_source": analysis_source,
                "multi_speaker": guest["multi_speaker"],
                "guest_note": guest["note"],
                "frame_findings": frame_findings,
                **analysis,
            }
            self.analyses.appendleft(record)
            self.seen.add(video_id)
            self._save()
            strategies_store.add_models(
                analysis.get("models", []), video_id, title, record["url"], thumbnail, channel_url
            )
            yield {"stage": "done", "record": record}
        except Exception as exc:
            log.warning("scout live analysis failed for %s: %r", video_id, exc)
            yield {"stage": "error", "message": str(exc)}

    # ── instant validation ────────────────────────────────────────────────

    # "10Y", the app-wide max-lookback convention (see
    # apps/web/src/app/lab/backtester/components/shared.tsx PRESETS).
    MAX_PERIOD_DAYS = 365 * 10

    # Selectable windows for trader-profile backtests. "all" mirrors the
    # app-wide 10Y max preset above.
    PERIOD_DAYS = {"1m": 30, "3m": 90, "6m": 180, "1y": 365, "all": MAX_PERIOD_DAYS}

    async def _load_recent_bars(self, symbol: str) -> tuple[list, str]:
        """180d hourly bars, falling back to 2y daily if too few hourly bars
        exist. Shared by quick_backtest and backtest_saved_strategy."""
        from datetime import datetime, timedelta, timezone

        from app.backtest.data import HistoricalDataLoader

        loader = HistoricalDataLoader()
        end = datetime.now(timezone.utc)
        bars = await loader.load(symbol, end - timedelta(days=180), end, "1h")
        interval = "1h"
        if len(bars) < 100:
            bars = await loader.load(symbol, end - timedelta(days=365 * 2), end, "1d")
            interval = "1d"
        if len(bars) < 60:
            raise ValueError(f"Not enough history for {symbol}")
        return bars, interval

    async def _load_period_bars(self, symbol: str, days: int) -> tuple[list, str]:
        """Bars over the last `days` — used for trader-profile aggregate
        backtests. Short windows (<=180d) use hourly bars so there's still
        a meaningful bar count (daily bars would starve a 1-month window
        down to ~30 candles); longer windows use daily bars, matching the
        Backtester UI's own max preset for "all"."""
        from datetime import datetime, timedelta, timezone

        from app.backtest.data import HistoricalDataLoader

        loader = HistoricalDataLoader()
        end = datetime.now(timezone.utc)
        if days <= 180:
            bars = await loader.load(symbol, end - timedelta(days=days), end, "1h")
            if len(bars) >= 48:
                return bars, "1h"
        bars = await loader.load(symbol, end - timedelta(days=days), end, "1d")
        if len(bars) < 20:
            raise ValueError(f"Not enough history for {symbol}")
        return bars, "1d"

    def _run_strategy_backtest(self, symbol: str, strategy_key: str, params: dict | None, bars: list, interval: str) -> dict:
        """Shared engine-run + metrics-compute step. Callers supply already
        loaded bars so bar-loading strategy (recent-window vs. max-period)
        stays their choice."""
        from app.backtest.engine import Backtest, _asset_class
        from app.backtest.metrics import compute_metrics
        from app.backtest.strategies import STRATEGIES

        engine = Backtest()
        strat = STRATEGIES[strategy_key](**(params or {}))
        trades, equity = engine.run(bars, strat, symbol=symbol, interval=interval)
        metrics = compute_metrics(
            initial_capital=engine.initial_capital,
            equity=equity,
            trades=trades,
            interval=interval,
            asset_class=_asset_class(symbol),
        )
        return {
            "symbol": symbol,
            "interval": interval,
            "bars": len(bars),
            "total_return_pct": round(metrics.total_return_pct, 2),
            "sharpe_ratio": round(metrics.sharpe_ratio, 2),
            "max_drawdown_pct": round(metrics.max_drawdown_pct, 2),
            "total_trades": metrics.total_trades,
            "win_rate": round(metrics.win_rate_pct, 1),
        }

    async def quick_backtest(self, analysis_id: int, strategy_index: int, symbol: str | None = None) -> dict:
        """Backtest a suggested strategy on the video's top asset, now."""
        rec = next((a for a in self.analyses if a["id"] == analysis_id), None)
        if rec is None:
            raise ValueError("Unknown analysis id")
        if not 0 <= strategy_index < len(rec["strategies"]):
            raise ValueError("Unknown strategy index")
        suggestion = rec["strategies"][strategy_index]
        sym = symbol or (rec["assets"][0]["symbol"] if rec["assets"] else "BTC-USD")

        bars, interval = await self._load_recent_bars(sym)
        result = self._run_strategy_backtest(sym, suggestion["strategy"], suggestion.get("params"), bars, interval)
        return {"analysis_id": analysis_id, "strategy": suggestion["strategy"], **result}

    async def backtest_saved_strategy(self, strategy_id: int, symbol: str | None = None) -> dict:
        """Backtest a strategy from the persistent strategies_store list (survives
        restarts and outlives the analyses that produced it, unlike quick_backtest's
        analysis_id/strategy_index which only work while that analysis is still in
        the capped in-memory `self.analyses`)."""
        entry = next((e for e in strategies_store.entries if e["id"] == strategy_id), None)
        if entry is None:
            raise ValueError("Unknown strategy id")
        sym = symbol or (entry.get("pairs") or ["BTC-USD"])[0]

        bars, interval = await self._load_recent_bars(sym)
        result = self._run_strategy_backtest(sym, entry["strategy"], entry.get("params"), bars, interval)
        return {"strategy_id": strategy_id, "name": entry.get("name"), "strategy": entry["strategy"], **result}

    # ── trader profiles ─────────────────────────────────────────────────────

    def _channel_url_for_trader(self, trader: str) -> str | None:
        """Best-known channel URL for a trader name: prefer a watched
        channel (exact id, from resolve_channel), else fall back to
        whatever channel_url got captured on any of their persisted
        strategy entries (oEmbed author_url at analysis time)."""
        for ch in self.channels.values():
            if ch.get("name") == trader:
                return f"https://www.youtube.com/channel/{ch['id']}"
        for e in reversed(strategies_store.entries):
            if e.get("trader") == trader and e.get("channel_url"):
                return e["channel_url"]
        return None

    async def _fetch_channel_about(self, channel_url: str) -> dict:
        """Real avatar photo plus self-published description/external links
        straight off the channel's own YouTube "About" page — the channel's
        own words, no third-party lookups, no identification of individual
        people in multi-host videos."""
        if channel_url in self._channel_about_cache:
            return self._channel_about_cache[channel_url]
        result: dict = {"avatar": None, "description": None, "links": []}
        try:
            about_url = channel_url.rstrip("/") + "/about"
            async with httpx.AsyncClient(timeout=10, headers=_HEADERS, follow_redirects=True) as client:
                r = await client.get(about_url)
                r.raise_for_status()
                html = r.text
            m = _CHANNEL_AVATAR_RE.search(html)
            if m:
                result["avatar"] = m.group(1)
            m = _CHANNEL_DESC_RE.search(html)
            if m:
                try:
                    result["description"] = json.loads('"' + m.group(1) + '"')
                except Exception:
                    pass
            links: list[dict] = []
            seen_urls: set[str] = set()
            for link_title, q in _CHANNEL_LINK_RE.findall(html):
                target = unquote(q)
                if target in seen_urls:
                    continue
                seen_urls.add(target)
                links.append({"title": link_title, "url": target})
            result["links"] = links
        except Exception as exc:
            log.warning("scout channel about fetch failed for %s: %r", channel_url, exc)
        self._channel_about_cache[channel_url] = result
        return result

    async def list_traders(self) -> list[dict]:
        """Every trader with at least one persisted (technical) strategy,
        grouped from strategies_store, sorted by video count desc."""
        grouped: dict[str, dict] = {}
        for e in strategies_store.entries:
            trader = e.get("trader")
            if not trader:
                continue
            g = grouped.setdefault(trader, {"trader": trader, "video_ids": set(), "strategy_count": 0})
            g["video_ids"].add(e.get("video_id"))
            g["strategy_count"] += 1
        out: list[dict] = []
        for g in grouped.values():
            avatar = None
            channel_url = self._channel_url_for_trader(g["trader"])
            if channel_url:
                about = await self._fetch_channel_about(channel_url)
                avatar = about.get("avatar")
            out.append({
                "trader": g["trader"],
                "video_count": len(g["video_ids"]),
                "strategy_count": g["strategy_count"],
                "avatar": avatar,
            })
        out.sort(key=lambda x: x["video_count"], reverse=True)
        return out

    async def trader_profile(self, trader: str, period: str = "all") -> dict:
        """A trader's video/strategy history plus aggregate performance,
        each strategy backtested over the requested window (1m/3m/6m/1y/all)."""
        entries = [e for e in strategies_store.entries if e.get("trader") == trader]
        if not entries:
            raise ValueError("Unknown trader")
        days = self.PERIOD_DAYS.get(period, self.PERIOD_DAYS["all"])

        channel_url = self._channel_url_for_trader(trader)
        about = await self._fetch_channel_about(channel_url) if channel_url else {
            "avatar": None, "description": None, "links": [],
        }

        videos: list[dict] = []
        returns: list[float] = []
        win_rates: list[float] = []
        for e in entries:
            sym = (e.get("pairs") or ["BTC-USD"])[0]
            try:
                bars, interval = await self._load_period_bars(sym, days)
                metrics = self._run_strategy_backtest(sym, e["strategy"], e.get("params"), bars, interval)
                returns.append(metrics["total_return_pct"])
                win_rates.append(metrics["win_rate"])
            except Exception as exc:
                metrics = {"symbol": sym, "error": str(exc)}
            videos.append({
                "id": e.get("id"),
                "video_id": e.get("video_id"),
                "title": e.get("video_title"),
                "url": e.get("video_url"),
                "thumbnail": e.get("video_thumbnail"),
                "strategy": e.get("strategy"),
                "label": e.get("label"),
                "symbol": sym,
                "metrics": metrics,
            })

        summary = {
            "video_count": len({e.get("video_id") for e in entries}),
            "strategy_count": len(entries),
            "avg_return_pct": round(sum(returns) / len(returns), 2) if returns else None,
            "best_return_pct": round(max(returns), 2) if returns else None,
            "worst_return_pct": round(min(returns), 2) if returns else None,
            "avg_win_rate": round(sum(win_rates) / len(win_rates), 1) if win_rates else None,
        }
        return {
            "trader": trader,
            "avatar": about.get("avatar"),
            "channel": {"description": about.get("description"), "links": about.get("links", [])},
            "period": period,
            "videos": videos,
            "summary": summary,
        }

    # ── anchored (timestamp-real) backtest ──────────────────────────────────

    _DEFAULT_STOP_PCT = 5.0
    _DEFAULT_TARGET_PCT = 10.0

    def _entry_time(self, rec: dict, signal: dict) -> "datetime | None":
        """Absolute moment the signal was said: the video's publish time
        plus the signal's transcript timestamp (falls back to publish time
        if no timestamp was recovered)."""
        from datetime import datetime, timedelta, timezone

        published_at = rec.get("published_at")
        if not published_at:
            return None
        try:
            published = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
        except ValueError:
            return None
        if published.tzinfo is None:
            published = published.replace(tzinfo=timezone.utc)
        ts = signal.get("timestamp_s")
        return published + timedelta(seconds=ts) if ts else published

    async def anchored_backtest(self, analysis_id: int, signal_index: int) -> dict:
        """Replay a video's ACTUAL call: enter at the real historical price
        at the exact moment (video timestamp) the trader said it, using
        their own stated stop-loss/take-profit (or sane defaults), and see
        what would really have happened — instead of a generic indicator
        backtest run "now"."""
        from datetime import datetime, timedelta, timezone

        from app.backtest.data import HistoricalDataLoader

        rec = next((a for a in self.analyses if a["id"] == analysis_id), None)
        if rec is None:
            raise ValueError("Unknown analysis id")
        signals = rec.get("signals") or []
        if not 0 <= signal_index < len(signals):
            raise ValueError("Unknown signal index")
        signal = signals[signal_index]
        symbol = signal["asset"]
        direction = signal["direction"]

        entry_time = self._entry_time(rec, signal)
        if entry_time is None:
            raise ValueError("No publish date available to anchor this backtest — try re-analyzing the video")

        clues = rec.get("clues") or {}
        stop_pct = clues.get("stop_loss_pct") or self._DEFAULT_STOP_PCT
        target_pct = clues.get("take_profit_pct") or self._DEFAULT_TARGET_PCT
        defaulted = clues.get("stop_loss_pct") is None or clues.get("take_profit_pct") is None

        now = datetime.now(timezone.utc)
        window_end = min(entry_time + timedelta(days=30), now)
        loader = HistoricalDataLoader()
        bars = await loader.load(symbol, entry_time - timedelta(hours=6), window_end, "1h")
        if len(bars) < 5:
            bars = await loader.load(symbol, entry_time - timedelta(days=2), window_end, "1d")
        if len(bars) < 2:
            raise ValueError(f"Not enough post-call price history for {symbol}")

        entry_bar = next((b for b in bars if b.timestamp >= entry_time), bars[0])
        entry_price = entry_bar.open
        is_long = direction == "buy"
        stop_price = entry_price * (1 - stop_pct / 100) if is_long else entry_price * (1 + stop_pct / 100)
        target_price = entry_price * (1 + target_pct / 100) if is_long else entry_price * (1 - target_pct / 100)

        outcome = "open"
        exit_bar = bars[-1]
        exit_price = exit_bar.close
        for bar in bars:
            if bar.timestamp <= entry_bar.timestamp:
                continue
            hit_stop = bar.low <= stop_price if is_long else bar.high >= stop_price
            hit_target = bar.high >= target_price if is_long else bar.low <= target_price
            if hit_stop:
                outcome, exit_bar, exit_price = "stop_hit", bar, stop_price
                break
            if hit_target:
                outcome, exit_bar, exit_price = "target_hit", bar, target_price
                break
        else:
            outcome = "timeout" if window_end < now else "open"

        pnl_pct = (exit_price - entry_price) / entry_price * 100 * (1 if is_long else -1)

        return {
            "analysis_id": analysis_id,
            "signal_index": signal_index,
            "symbol": symbol,
            "direction": direction,
            "entry_time": entry_bar.timestamp.isoformat(),
            "entry_price": round(entry_price, 6),
            "exit_time": exit_bar.timestamp.isoformat(),
            "exit_price": round(exit_price, 6),
            "outcome": outcome,
            "pnl_pct": round(pnl_pct, 2),
            "stop_loss_pct": round(stop_pct, 2),
            "take_profit_pct": round(target_pct, 2),
            "defaulted_risk_params": defaulted,
            "bars_examined": len(bars),
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
                            entry["video_id"],
                            title=entry["title"],
                            channel=ch["name"],
                            published_at=entry.get("published"),
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
            if AUTO_DISCOVER and (
                self.last_discover is None or time.time() - self.last_discover > DISCOVER_INTERVAL_S
            ):
                try:
                    watched = await self.auto_discover_and_watch()
                    if watched:
                        log.info("scout: auto-watched %d new channels", len(watched))
                except Exception as exc:
                    log.warning("scout auto-discovery error: %r", exc)
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
            "auto_discover": AUTO_DISCOVER,
            "last_discover": self.last_discover,
            "discover_interval_s": DISCOVER_INTERVAL_S,
            "discovery_log": list(self.discovery_log)[:15],
            "discovered_count": len(self.discovered),
            "discovery_alert": self.discovery_alert,
            "discovery_stale_cycles": self.discovery_stale_cycles,
        }


scout_service = ScoutService()
