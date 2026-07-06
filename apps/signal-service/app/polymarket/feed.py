"""
Clean data feed for Polymarket CLOB.

Implements every data-quality rule from the article:
 - Discard first N ticks after reconnect (stale snapshot protection)
 - Reject abnormal price jumps (> MAX_JUMP_PCT in one tick)
 - Continuous latency monitoring — respawn feed if lag > MAX_LAG_MS
 - Run two parallel feeds and cross-validate; emit only agreed ticks
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import AsyncIterator, Callable

import httpx

log = logging.getLogger(__name__)

POLYMARKET_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/market"
POLYMARKET_REST = "https://clob.polymarket.com"

MAX_JUMP_PCT = 0.08       # reject tick if price moved > 8% in one step
MAX_LAG_MS = 3_000        # respawn feed if no tick received in 3s
WARMUP_TICKS = 3          # discard first N ticks after (re)connect
HISTORY_LEN = 200         # rolling tick history kept per feed


@dataclass
class Tick:
    market_id: str
    yes_price: float        # 0-1
    no_price: float         # 0-1
    timestamp_ms: int
    feed_id: int            # which parallel feed produced this


@dataclass
class FeedStats:
    feed_id: int
    ticks_received: int = 0
    ticks_rejected: int = 0
    reconnects: int = 0
    last_tick_ms: int = field(default_factory=lambda: int(time.monotonic() * 1000))
    latency_ms: float = 0.0

    @property
    def reject_rate(self) -> float:
        total = self.ticks_received + self.ticks_rejected
        return self.ticks_rejected / total if total else 0.0


class _SingleFeed:
    """One WebSocket feed connection with dirty-data filtering."""

    def __init__(self, feed_id: int, market_id: str, on_tick: Callable[[Tick], None]):
        self.feed_id = feed_id
        self.market_id = market_id
        self.on_tick = on_tick
        self.stats = FeedStats(feed_id=feed_id)
        self._last_price: float | None = None
        self._warmup_remaining = WARMUP_TICKS
        self._running = False
        self._history: deque[Tick] = deque(maxlen=HISTORY_LEN)

    async def run(self) -> None:
        self._running = True
        while self._running:
            try:
                await self._connect_and_stream()
            except Exception as exc:
                self.stats.reconnects += 1
                log.warning("Feed %d disconnected (%s), reconnecting in 1s…", self.feed_id, exc)
                self._warmup_remaining = WARMUP_TICKS
                await asyncio.sleep(1)

    async def _connect_and_stream(self) -> None:
        try:
            import websockets  # type: ignore
        except ImportError:
            # websockets not installed — simulate with REST polling
            await self._poll_rest()
            return

        async with websockets.connect(POLYMARKET_WS, ping_interval=20) as ws:
            await ws.send(f'{{"type":"subscribe","channel":"market","markets":["{self.market_id}"]}}')
            self._warmup_remaining = WARMUP_TICKS
            async for raw in ws:
                if not self._running:
                    return
                self._process_raw(raw)
                self.stats.last_tick_ms = int(time.monotonic() * 1000)

    async def _poll_rest(self) -> None:
        """Fallback: poll REST CLOB for price when websockets unavailable."""
        while self._running:
            t0 = time.monotonic()
            try:
                async with httpx.AsyncClient(timeout=5) as client:
                    resp = await client.get(f"{POLYMARKET_REST}/markets/{self.market_id}")
                    if resp.status_code == 200:
                        data = resp.json()
                        yes = float(data.get("outcomePrices", ["0.5"])[0])
                        self._emit(yes, round(1 - yes, 4))
            except Exception as exc:
                log.debug("Feed %d REST poll error: %s", self.feed_id, exc)
            lag = (time.monotonic() - t0) * 1000
            self.stats.latency_ms = lag
            self.stats.last_tick_ms = int(time.monotonic() * 1000)
            await asyncio.sleep(2)

    def _process_raw(self, raw: str) -> None:
        import json
        try:
            msg = json.loads(raw)
        except Exception:
            return
        for event in msg if isinstance(msg, list) else [msg]:
            if event.get("type") not in ("price_change", "book"):
                continue
            yes = float(event.get("yes_price") or event.get("price") or 0)
            no = round(1 - yes, 4)
            self._emit(yes, no)

    def _emit(self, yes: float, no: float) -> None:
        if self._warmup_remaining > 0:
            self._warmup_remaining -= 1
            self.stats.ticks_rejected += 1
            return

        # Reject abnormal jumps
        if self._last_price is not None:
            jump = abs(yes - self._last_price)
            if jump > MAX_JUMP_PCT:
                log.debug("Feed %d: rejected jump %.4f→%.4f", self.feed_id, self._last_price, yes)
                self.stats.ticks_rejected += 1
                return

        self._last_price = yes
        self.stats.ticks_received += 1
        tick = Tick(
            market_id=self.market_id,
            yes_price=yes,
            no_price=no,
            timestamp_ms=int(time.time() * 1000),
            feed_id=self.feed_id,
        )
        self._history.append(tick)
        self.on_tick(tick)

    def stop(self) -> None:
        self._running = False


class CleanFeed:
    """
    Runs two parallel feeds for the same market.
    Only forwards a tick when both feeds agree within CONSENSUS_BAND.
    Monitors latency and respawns stale connections.
    """

    CONSENSUS_BAND = 0.02   # feeds must agree within 2¢

    def __init__(self, market_id: str):
        self.market_id = market_id
        self._latest: dict[int, Tick] = {}
        self._feeds: list[_SingleFeed] = []
        self._subscribers: list[asyncio.Queue[Tick]] = []
        self._tasks: list[asyncio.Task] = []

    def subscribe(self) -> asyncio.Queue[Tick]:
        q: asyncio.Queue[Tick] = asyncio.Queue(maxsize=500)
        self._subscribers.append(q)
        return q

    async def start(self, n_feeds: int = 2) -> None:
        for i in range(n_feeds):
            feed = _SingleFeed(feed_id=i, market_id=self.market_id, on_tick=self._on_raw_tick)
            self._feeds.append(feed)
            self._tasks.append(asyncio.create_task(feed.run()))
        self._tasks.append(asyncio.create_task(self._watchdog()))

    async def stop(self) -> None:
        for f in self._feeds:
            f.stop()
        for t in self._tasks:
            t.cancel()

    def stats(self) -> list[FeedStats]:
        return [f.stats for f in self._feeds]

    def _on_raw_tick(self, tick: Tick) -> None:
        self._latest[tick.feed_id] = tick
        if len(self._latest) < 2:
            return  # need both feeds before consensus check
        prices = [t.yes_price for t in self._latest.values()]
        spread = max(prices) - min(prices)
        if spread > self.CONSENSUS_BAND:
            return  # feeds disagree — drop tick
        # Use average of agreed prices
        agreed_tick = Tick(
            market_id=tick.market_id,
            yes_price=round(sum(prices) / len(prices), 4),
            no_price=round(1 - sum(prices) / len(prices), 4),
            timestamp_ms=tick.timestamp_ms,
            feed_id=-1,   # -1 = consensus tick
        )
        for q in self._subscribers:
            if not q.full():
                q.put_nowait(agreed_tick)

    async def _watchdog(self) -> None:
        """Restart feeds that haven't produced a tick in MAX_LAG_MS."""
        while True:
            await asyncio.sleep(5)
            now_ms = int(time.monotonic() * 1000)
            for feed in self._feeds:
                lag = now_ms - feed.stats.last_tick_ms
                feed.stats.latency_ms = lag
                if lag > MAX_LAG_MS:
                    log.warning("Feed %d stale (%dms), respawning…", feed.feed_id, lag)
                    feed.stop()
                    feed._running = False
                    new_feed = _SingleFeed(
                        feed_id=feed.feed_id,
                        market_id=self.market_id,
                        on_tick=self._on_raw_tick,
                    )
                    self._feeds[feed.feed_id] = new_feed
                    self._tasks.append(asyncio.create_task(new_feed.run()))
