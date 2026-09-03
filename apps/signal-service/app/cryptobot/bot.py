"""Crypto trading bot — runs a Scout-extracted trader's backtested strategy
against live Binance bars (the same public, keyless data feed the backtester
uses) and, once explicitly promoted to "live", real Bitget spot orders.

Reuses the exact same per-bar `Strategy.on_bar(StrategyContext)` interface
the Backtester already drives (app/backtest/strategies/base.py) — the
strategy code that was backtested is the strategy code that trades live,
nothing is reimplemented.

State machine: stopped → dry_run → live, identical in spirit to
app/polymarket/bot.py's PolyBot — dry_run is the only default, and going
live is never a single step from stopped.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Literal

from app.backtest.data import BINANCE_INTERVAL_MS, binance_symbol, fetch_binance_bars
from app.backtest.models import Position, Signal
from app.backtest.strategies import STRATEGIES
from app.backtest.strategies.base import StrategyContext
from app.cryptobot.exchange import place_market_order
from app.cryptobot.ledger import BotTrade, get_ledger

log = logging.getLogger(__name__)

BotMode = Literal["stopped", "dry_run", "live"]

_HISTORY_WINDOW = 500  # bars of lookback handed to the strategy, matches Backtest.run

# Strategies whose `prepare()` precomputes signals with full look-ahead over
# the entire bar series (see app/backtest/strategies/oracle_scalper.py) — a
# backtest-only ceiling benchmark that cannot function without future bars,
# so it can never be deployed as a live bot.
NOT_LIVE_DEPLOYABLE = {"oracle_scalper"}


@dataclass
class BotConfig:
    bot_id: str
    trader: str
    strategy_id: int          # strategies_store entry id this bot was deployed from
    strategy_key: str
    strategy_params: dict
    symbol: str                # catalog form, e.g. "BTC-USD"
    interval: str = "1d"
    position_size_usd: float = 25.0
    poll_seconds: float = 300.0
    mode: BotMode = "dry_run"  # NEVER defaults to live


@dataclass
class BotStatus:
    bot_id: str
    mode: BotMode
    trader: str
    strategy: str
    symbol: str
    interval: str
    bars_seen: int = 0
    last_signal: str | None = None
    last_price: float | None = None
    position: dict | None = None
    trades_count: int = 0
    last_error: str | None = None
    started_at: float = field(default_factory=time.time)
    uptime_seconds: float = 0.0


class CryptoBot:
    def __init__(self, config: BotConfig) -> None:
        self.config = config
        strategy_cls = STRATEGIES[config.strategy_key]
        self._strategy = strategy_cls(**(config.strategy_params or {}))
        self._pair = binance_symbol(config.symbol) or config.symbol.replace("-", "").upper()
        self._position: Position | None = None
        self._last_bar_ts: int | None = None
        self._task: asyncio.Task | None = None
        self._running = False
        self._activity: list[dict] = []  # rolling poll log: bar ts, price, signal
        self._status = BotStatus(
            bot_id=config.bot_id,
            mode=config.mode,
            trader=config.trader,
            strategy=config.strategy_key,
            symbol=config.symbol,
            interval=config.interval,
        )

    # ── Lifecycle ────────────────────────────────────────────────────────────

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        log.info(
            "CryptoBot started | trader=%s strategy=%s symbol=%s mode=%s",
            self.config.trader, self.config.strategy_key, self.config.symbol, self.config.mode,
        )

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
        log.info("CryptoBot stopped | bot_id=%s", self.config.bot_id)

    def set_mode(self, mode: BotMode) -> None:
        if mode == "live" and self.config.mode == "stopped":
            raise ValueError("Cannot go straight to live — must run dry_run first")
        self.config.mode = mode
        self._status.mode = mode
        log.info("CryptoBot mode -> %s | bot_id=%s", mode, self.config.bot_id)

    def status(self) -> BotStatus:
        self._status.uptime_seconds = time.time() - self._status.started_at
        self._status.position = (
            {
                "side": self._position.side,
                "entry_price": self._position.entry_price,
                "size": self._position.size,
                "cost": self._position.cost,
            }
            if self._position
            else None
        )
        return self._status

    def activity(self) -> list[dict]:
        """Most-recent-first log of every poll cycle's bar/signal, not just
        the ones that led to an executed trade — used to render a live
        timeline of what the strategy has been evaluating."""
        return list(reversed(self._activity))

    # ── Main loop ────────────────────────────────────────────────────────────

    async def _loop(self) -> None:
        while self._running:
            try:
                await self._poll_once()
                self._status.last_error = None
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._status.last_error = repr(exc)
                log.error("CryptoBot poll error | bot_id=%s | %r", self.config.bot_id, exc)
            await asyncio.sleep(self.config.poll_seconds)

    async def _poll_once(self) -> None:
        bar_ms = BINANCE_INTERVAL_MS.get(self.config.interval, 86_400_000)
        end = datetime.now(timezone.utc)
        start = end - timedelta(milliseconds=bar_ms * (_HISTORY_WINDOW + 20))
        bars = await fetch_binance_bars(self.config.symbol, start, end, self.config.interval)
        if len(bars) < 2:
            return

        # The most recent row from klines is the still-forming current
        # candle — never let the strategy act on an unclosed bar.
        closed_bars = bars[:-1]
        latest = closed_bars[-1]
        self._status.last_price = latest.close

        if self._last_bar_ts is not None and latest.ts <= self._last_bar_ts:
            return  # no new closed bar since last poll
        self._last_bar_ts = latest.ts

        window = closed_bars[-_HISTORY_WINDOW:]
        self._strategy.prepare(window)
        ctx = StrategyContext(history=window, position=self._position, properties={})
        signal: Signal = self._strategy.on_bar(ctx)
        self._status.bars_seen += 1
        self._status.last_signal = signal
        self._activity.append({
            "at": time.time(),
            "bar_ts": latest.ts,
            "price": latest.close,
            "signal": signal,
        })
        self._activity = self._activity[-40:]

        if self.config.mode == "stopped":
            return
        await self._handle_signal(signal, latest.close)

    # ── Execution ────────────────────────────────────────────────────────────

    async def _handle_signal(self, signal: Signal, price: float) -> None:
        is_live = self.config.mode == "live"
        if signal == "buy" and self._position is None:
            order = await place_market_order(
                self._pair, "BUY", live=is_live, quote_usd=self.config.position_size_usd,
            )
            self._position = Position(
                symbol=self.config.symbol,
                side="long",
                entry_price=order["price"],
                entry_time=datetime.now(timezone.utc),
                size=order["qty"],
                cost=order["quote_usd"],
            )
            self._record_trade(order, reason="signal=buy")
        elif signal in ("sell", "close") and self._position is not None:
            pos = self._position
            order = await place_market_order(self._pair, "SELL", live=is_live, quantity=pos.size)
            pnl = order["quote_usd"] - pos.cost
            self._position = None
            self._record_trade(order, reason=f"signal={signal}", pnl_usd=pnl)

    def _record_trade(self, order: dict, reason: str, pnl_usd: float | None = None) -> None:
        get_ledger().add(BotTrade(
            id=str(uuid.uuid4()),
            bot_id=self.config.bot_id,
            trader=self.config.trader,
            strategy=self.config.strategy_key,
            symbol=self.config.symbol,
            side=order["side"],
            price=order["price"],
            qty=order["qty"],
            quote_usd=order["quote_usd"],
            order_id=order["order_id"],
            dry_run=order["dry_run"],
            reason=reason,
            pnl_usd=pnl_usd,
        ))
        self._status.trades_count += 1
        log.info(
            "[%s] %s %s %s @ %.6f | bot_id=%s",
            "DRY" if order["dry_run"] else "LIVE",
            order["side"], order["qty"], order["symbol"], order["price"],
            self.config.bot_id,
        )


# ── Global bot registry ───────────────────────────────────────────────────────

_bots: dict[str, CryptoBot] = {}


def get_bot(bot_id: str) -> CryptoBot | None:
    return _bots.get(bot_id)


def all_bots() -> dict[str, CryptoBot]:
    return _bots


async def create_bot(config: BotConfig) -> CryptoBot:
    bot = CryptoBot(config)
    _bots[config.bot_id] = bot
    await bot.start()
    return bot


async def remove_bot(bot_id: str) -> bool:
    bot = _bots.pop(bot_id, None)
    if bot is None:
        return False
    await bot.stop()
    return True
