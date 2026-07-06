"""
Polymarket bot engine.

Workflow (from the article):
  1. Receive clean tick from CleanFeed
  2. Evaluate via SimpleStrategy (breakeven math first)
  3. If edge exists AND not in cooldown → place order (dry_run by default)
  4. Log everything to Ledger
  5. Never deploy without dry-run phase

State machine: STOPPED → DRY_RUN → LIVE
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Literal

from app.polymarket.clob import Market, OrderResult, get_market, place_order
from app.polymarket.feed import CleanFeed, Tick
from app.polymarket.ledger import TradeRecord, get_ledger
from app.polymarket.strategy import SimpleStrategy, TradeDecision

log = logging.getLogger(__name__)

BotMode = Literal["stopped", "dry_run", "live"]


@dataclass
class BotConfig:
    market_id: str
    entry_threshold: float = 0.40
    min_win_rate_edge: float = 0.08
    size_usdc: float = 10.0
    cooldown_seconds: float = 60.0   # min seconds between trades on same market
    mode: BotMode = "dry_run"        # NEVER defaults to live


@dataclass
class BotStatus:
    mode: BotMode
    market_id: str
    market_question: str
    ticks_processed: int = 0
    trades_attempted: int = 0
    trades_skipped: int = 0
    last_tick_price: float | None = None
    last_decision: str = ""
    feed_stats: list[dict] = field(default_factory=list)
    uptime_seconds: float = 0.0
    started_at: float = field(default_factory=time.time)


class PolyBot:
    def __init__(self, config: BotConfig):
        self.config = config
        self._strategy = SimpleStrategy(
            entry_threshold=config.entry_threshold,
            min_win_rate_edge=config.min_win_rate_edge,
            size_usdc=config.size_usdc,
            dry_run=config.mode != "live",
        )
        self._feed: CleanFeed | None = None
        self._market: Market | None = None
        self._task: asyncio.Task | None = None
        self._last_trade_at: float = 0.0
        self._status = BotStatus(
            mode=config.mode,
            market_id=config.market_id,
            market_question="",
        )
        self._running = False

    # ─── Lifecycle ────────────────────────────────────────────────────────────

    async def start(self) -> None:
        if self._running:
            return
        self._market = await get_market(self.config.market_id)
        if self._market is None:
            raise ValueError(f"Market {self.config.market_id} not found")
        self._status.market_question = self._market.question
        self._feed = CleanFeed(self.config.market_id)
        await self._feed.start(n_feeds=2)
        self._running = True
        self._task = asyncio.create_task(self._loop())
        log.info("PolyBot started | market=%s | mode=%s", self.config.market_id, self.config.mode)

    async def stop(self) -> None:
        self._running = False
        if self._feed:
            await self._feed.stop()
        if self._task:
            self._task.cancel()
        log.info("PolyBot stopped")

    def set_mode(self, mode: BotMode) -> None:
        if mode == "live" and self.config.mode == "stopped":
            raise ValueError("Cannot go straight to live — must run dry_run first")
        self.config.mode = mode
        self._status.mode = mode
        self._strategy.dry_run = mode != "live"
        log.info("PolyBot mode → %s", mode)

    # ─── Main loop ────────────────────────────────────────────────────────────

    async def _loop(self) -> None:
        assert self._feed is not None
        q = self._feed.subscribe()
        while self._running:
            try:
                tick: Tick = await asyncio.wait_for(q.get(), timeout=5.0)
                await self._on_tick(tick)
            except asyncio.TimeoutError:
                pass
            except Exception as exc:
                log.error("Bot loop error: %s", exc)

    async def _on_tick(self, tick: Tick) -> None:
        self._status.ticks_processed += 1
        self._status.last_tick_price = tick.yes_price
        self._status.uptime_seconds = time.time() - self._status.started_at
        if self._feed:
            self._status.feed_stats = [
                {"feed_id": s.feed_id, "ticks": s.ticks_received,
                 "rejected": s.ticks_rejected, "latency_ms": round(s.latency_ms, 1)}
                for s in self._feed.stats()
            ]

        if self.config.mode == "stopped":
            return

        # Cooldown check
        if time.time() - self._last_trade_at < self.config.cooldown_seconds:
            return

        # Get sentiment estimate (simple: price distance from 0.5 as proxy)
        sentiment = (0.5 - tick.yes_price) * 2   # negative when YES is expensive

        decision: TradeDecision = self._strategy.evaluate(
            yes_price=tick.yes_price,
            sentiment_score=sentiment,
        )

        self._status.last_decision = f"{decision.side}: {decision.reason}"

        if decision.side == "PASS":
            self._status.trades_skipped += 1
            return

        await self._execute(tick, decision)

    async def _execute(self, tick: Tick, decision: TradeDecision) -> None:
        assert self._market is not None
        self._status.trades_attempted += 1
        self._last_trade_at = time.time()

        try:
            result: OrderResult = await place_order(
                market=self._market,
                side=decision.side,
                price=decision.price,
                size_usdc=decision.size_usdc,
            )
        except Exception as exc:
            log.error("Order failed: %s", exc)
            return

        trade = TradeRecord(
            id=str(uuid.uuid4()),
            market_id=self.config.market_id,
            question=self._market.question,
            side=decision.side,
            entry_price=decision.price,
            size_usdc=decision.size_usdc,
            breakeven_wr=decision.breakeven_win_rate,
            estimated_wr=decision.estimated_win_rate,
            expected_value=decision.expected_value,
            reason=decision.reason,
            order_id=result.order_id,
            dry_run=result.dry_run,
        )
        get_ledger().add(trade)
        log.info(
            "[%s] %s %s @ %.3f | EV=%.3f | order=%s",
            "DRY" if result.dry_run else "LIVE",
            decision.side, self.config.market_id,
            decision.price, decision.expected_value, result.order_id,
        )

    def status(self) -> BotStatus:
        return self._status


# ─── Global bot registry ──────────────────────────────────────────────────────

_bots: dict[str, PolyBot] = {}


def get_bot(market_id: str) -> PolyBot | None:
    return _bots.get(market_id)


def all_bots() -> dict[str, PolyBot]:
    return _bots


async def create_bot(config: BotConfig) -> PolyBot:
    if config.market_id in _bots:
        await _bots[config.market_id].stop()
    bot = PolyBot(config)
    _bots[config.market_id] = bot
    await bot.start()
    return bot
