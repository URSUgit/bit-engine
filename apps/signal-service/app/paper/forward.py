"""One local, paper-only BTCUSDT breakout session. No exchange orders."""
from datetime import datetime, timezone
from math import isfinite
from time import monotonic, time
from typing import Sequence
from uuid import uuid4

import httpx

from app.backtest.models import Bar, Position
from app.backtest.strategies.base import StrategyContext
from app.backtest.strategies.studio_breakout import StudioBreakout

HOUR = 3600
FILL_WINDOW_MS = 120_000
BINANCE_PUBLIC = 'https://data-api.binance.vision'
Snapshot = tuple[list[Bar], Bar | None, int]


def parse_snapshot(rows: Sequence, server_ms: int) -> Snapshot:
    current = server_ms // (HOUR * 1000) * HOUR
    bars = []
    opening = None
    if not isinstance(rows, list):
        raise ValueError('Unexpected Binance candle response')
    for row in rows:
        if not isinstance(row, list) or len(row) < 7:
            raise ValueError('Unexpected Binance candle format')
        opened, closed = int(row[0]), int(row[6])
        if opened % (HOUR * 1000) or closed != opened + HOUR * 1000 - 1:
            raise ValueError('Unexpected Binance hourly timestamps')
        bar = Bar(datetime.fromtimestamp(opened / 1000, timezone.utc), *(float(row[i]) for i in range(1, 6)))
        if not isfinite(bar.volume) or bar.volume < 0:
            raise ValueError('Invalid Binance volume')
        if bar.ts < current:
            bars.append(bar)
        elif bar.ts == current and opening is None:
            opening = bar
        else:
            raise ValueError('Unexpected duplicate or future Binance candle')
    if not bars or bars[-1].ts != current - HOUR:
        raise ValueError('The Binance hourly feed is stale')
    if len(bars) < 48:
        raise ValueError('Binance did not return enough completed hours')
    StudioBreakout().prepare(bars)
    if opening is not None:
        StudioBreakout().prepare([opening])
    return bars, opening, server_ms


async def market_snapshot() -> Snapshot:
    async with httpx.AsyncClient(base_url=BINANCE_PUBLIC, timeout=8) as client:
        clock = await client.get('/api/v3/time', headers={'Cache-Control': 'no-cache'})
        clock.raise_for_status()
        server_ms = int(clock.json()['serverTime'])
        if abs(time() * 1000 - server_ms) > 90_000:
            # Some intermediaries serve a cached time response. A timestamp on
            # the query makes this check fail closed rather than trading stale data.
            clock = await client.get('/api/v3/time', params={'_': int(time() * 1000)})
            clock.raise_for_status()
            server_ms = int(clock.json()['serverTime'])
            if abs(time() * 1000 - server_ms) > 90_000:
                raise ValueError('Binance clock is stale or the local clock is out of sync')
        observed = monotonic()
        response = await client.get('/api/v3/klines', params={
            'symbol': 'BTCUSDT', 'interval': '1h', 'limit': 73, 'endTime': server_ms,
        })
        response.raise_for_status()
        bars, opening, _ = parse_snapshot(response.json(), server_ms)
        return bars, opening, server_ms + int((monotonic() - observed) * 1000)


def new_run(offset_bps: int, snapshot: Snapshot) -> dict:
    bars, _, observed = snapshot
    return dict(id=uuid4().hex, status='running', offset_bps=offset_bps, cash=10_000.0,
                position=None, events=[], last_bar=bars[-1].ts, observed_ms=observed, feed_error=None)


def advance(state: dict, snapshot: Snapshot) -> dict:
    bars, opening, observed = snapshot
    last = bars[-1].ts
    previous = state['last_bar']
    if state['status'] != 'running' or observed < state['observed_ms']:
        return state
    updated = {**state, 'observed_ms': observed, 'feed_error': None}
    if last <= previous:
        return updated
    events = list(state['events'][-99:])
    updated.update(last_bar=last, events=events)
    if last - previous != HOUR:
        events.append(dict(kind='gap', previous=previous, latest=last, observed_ms=observed))
        return {**updated, 'status': 'paused'}
    raw_position = state['position']
    position = None if raw_position is None else Position(**{
        **raw_position, 'entry_time': datetime.fromtimestamp(raw_position['entry_time'], timezone.utc),
    })
    action = StudioBreakout(state['offset_bps']).on_bar(StrategyContext(bars, position))
    if action == 'hold':
        return updated
    expected = last + HOUR
    age = observed - expected * 1000
    if opening is None and 0 <= age <= FILL_WINDOW_MS:
        return {**state, 'observed_ms': observed, 'feed_error': 'Waiting for the next candle open'}
    event: dict[str, str | int | float] = dict(action=action, signal_bar=last, eligible_open=expected, observed_ms=observed)
    if opening is None or opening.ts != expected or not 0 <= age <= FILL_WINDOW_MS:
        events.append({**event, 'kind': 'missed_open'})
        return {**updated, 'status': 'paused'}
    price = opening.open
    fee = .001
    if action == 'buy':
        allocation = state['cash'] * .25
        size = allocation / (price * (1 + fee))
        updated['position'] = dict(symbol='BTCUSDT', side='long', entry_price=price,
                                   entry_time=expected, size=size, cost=allocation)
        updated['cash'] -= allocation
    elif position is not None:
        proceeds = position.size * price * (1 - fee)
        updated['cash'] += proceeds
        updated['position'] = None
        event['pnl'] = round(proceeds - position.cost, 2)
    events.append({**event, 'kind': 'paper_fill', 'price': price})
    return updated
