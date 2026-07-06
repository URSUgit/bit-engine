"""
Live data ingester — continuously pulls the most recent bars from Binance and
upserts them into the SQLite store so the warehouse stays current without a
manual refresh. Designed to run as a background asyncio task started from the
FastAPI lifespan.

Tracks per-symbol ingest state (last poll, bars written, errors) which the
web dashboard surfaces. No new dependencies; reuses the existing fetchers.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone

from .data import fetch_binance_bars, BINANCE_SYMBOL_MAP
from .storage import bar_storage

log = logging.getLogger("signal_service.ingester")

# Default symbols + interval to keep warm. 1m bars on majors give the
# highest-resolution free crypto data available.
DEFAULT_SYMBOLS = ["BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD"]
DEFAULT_INTERVAL = "1m"


@dataclass
class IngestState:
    symbol: str
    interval: str
    enabled: bool = True
    last_poll_ts: int | None = None
    last_bar_ts: int | None = None
    bars_written_total: int = 0
    last_write_count: int = 0
    error: str | None = None
    polls: int = 0

    def to_dict(self) -> dict:
        d = asdict(self)
        d["last_poll_iso"] = (
            datetime.fromtimestamp(self.last_poll_ts, tz=timezone.utc).isoformat()
            if self.last_poll_ts else None
        )
        d["last_bar_iso"] = (
            datetime.fromtimestamp(self.last_bar_ts, tz=timezone.utc).isoformat()
            if self.last_bar_ts else None
        )
        return d


class LiveIngester:
    """Polls Binance on an interval and keeps the SQLite store fresh."""

    def __init__(self, poll_seconds: int = 30) -> None:
        self.poll_seconds = poll_seconds
        self._states: dict[tuple[str, str], IngestState] = {}
        self._running = False
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    # ── lifecycle ──────────────────────────────────────────────────────────
    def start(self, symbols: list[str] | None = None, interval: str = DEFAULT_INTERVAL) -> None:
        for sym in (symbols or DEFAULT_SYMBOLS):
            if sym in BINANCE_SYMBOL_MAP:
                self._states.setdefault((sym, interval), IngestState(symbol=sym, interval=interval))
        if not self._running:
            self._running = True
            self._task = asyncio.create_task(self._loop())
            log.info("live ingester started: %d streams @ %ss", len(self._states), self.poll_seconds)

    def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()

    async def add_stream(self, symbol: str, interval: str = DEFAULT_INTERVAL) -> bool:
        if symbol not in BINANCE_SYMBOL_MAP:
            return False
        async with self._lock:
            self._states.setdefault((symbol, interval), IngestState(symbol=symbol, interval=interval))
        if not self._running:
            self.start([], interval)
        return True

    def set_enabled(self, symbol: str, interval: str, enabled: bool) -> bool:
        st = self._states.get((symbol, interval))
        if not st:
            return False
        st.enabled = enabled
        return True

    def status(self) -> dict:
        return {
            "running": self._running,
            "poll_seconds": self.poll_seconds,
            "stream_count": len(self._states),
            "streams": [s.to_dict() for s in self._states.values()],
        }

    # ── poll loop ──────────────────────────────────────────────────────────
    async def _loop(self) -> None:
        # Small initial delay so startup isn't blocked on the first fetch.
        await asyncio.sleep(2)
        while self._running:
            try:
                await self._poll_all()
            except asyncio.CancelledError:
                break
            except Exception as e:  # never let the loop die
                log.warning("ingester poll cycle error: %s", e)
            await asyncio.sleep(self.poll_seconds)

    async def _poll_all(self) -> None:
        async with self._lock:
            states = list(self._states.values())
        for st in states:
            if not st.enabled:
                continue
            await self._poll_one(st)

    async def _poll_one(self, st: IngestState) -> None:
        st.polls += 1
        st.last_poll_ts = int(datetime.now(tz=timezone.utc).timestamp())
        # Fetch the trailing window so we patch any small gaps, not just the tip.
        end = datetime.now(tz=timezone.utc)
        start = end - timedelta(minutes=180) if st.interval == "1m" else end - timedelta(days=7)
        try:
            bars = await fetch_binance_bars(st.symbol, start, end, st.interval)
            if bars:
                written = bar_storage.upsert_bars(st.symbol, st.interval, bars)
                st.last_write_count = written
                st.bars_written_total += written
                st.last_bar_ts = bars[-1].ts
                st.error = None
            else:
                st.last_write_count = 0
        except Exception as e:
            st.error = str(e)[:160]
            log.warning("ingest %s/%s failed: %s", st.symbol, st.interval, e)


# Module-level singleton — imported by the FastAPI lifespan + router.
live_ingester = LiveIngester()
