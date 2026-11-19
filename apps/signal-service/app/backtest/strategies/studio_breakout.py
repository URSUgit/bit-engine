"""Studio 01: previous UTC day breakout on consecutive hourly candles."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_CEILING
from math import isfinite

from ..models import Bar, Signal
from .base import Strategy, StrategyContext


def _utc(timestamp: datetime) -> datetime:
    if timestamp.tzinfo is None:
        raise ValueError('Studio candles must carry a timezone')
    return timestamp.astimezone(timezone.utc)


class StudioBreakout(Strategy):
    name = 'studio_breakout'
    description = 'Long-only breakout above the previous UTC day high plus an offset.'
    strict_next_open = True
    params_schema = {'entry_offset_bps': {'type': 'int', 'default': 50, 'min': 0, 'max': 400}}

    def __init__(self, entry_offset_bps: int = 50):
        if type(entry_offset_bps) is not int or not 0 <= entry_offset_bps <= 400:
            raise ValueError('Entry offset must be an integer from 0 to 400 basis points')
        super().__init__(entry_offset_bps=entry_offset_bps)

    def prepare(self, bars: list[Bar], progress_cb=None) -> None:
        previous = None
        for bar in bars:
            timestamp = _utc(bar.timestamp)
            if timestamp.minute or timestamp.second or timestamp.microsecond or (
                previous is not None and timestamp - previous != timedelta(hours=1)
            ):
                raise ValueError('Studio requires contiguous hourly candles on the UTC hour')
            if not all(isfinite(v) for v in (bar.open, bar.high, bar.low, bar.close)) or not (
                0 < bar.low <= min(bar.open, bar.close) <= max(bar.open, bar.close) <= bar.high
            ):
                raise ValueError('Invalid Studio candle prices')
            previous = timestamp

    def on_bar(self, ctx: StrategyContext) -> Signal:
        timestamp = _utc(ctx.current_bar.timestamp)
        if ctx.position is not None:
            return 'close' if timestamp.hour == 23 else 'hold'
        # Locate a complete previous UTC day using only candles visible at signal time.
        end = len(ctx.history) - timestamp.hour - 1
        if end < 24:
            return 'hold'
        previous_day = ctx.history[end - 24:end]
        prior_high = max(Decimal(str(bar.high)) for bar in previous_day)
        prior_high_cents = (prior_high * 100).to_integral_value()
        bps = self.params['entry_offset_bps']
        threshold_cents = (prior_high_cents * (10000 + bps) / 10000).to_integral_value(rounding=ROUND_CEILING)
        threshold = float(threshold_cents / 100)
        return 'buy' if ctx.history[-2].close <= threshold < ctx.current_bar.close else 'hold'
