"""Ensemble strategy: combines signals from multiple sub-strategies via majority vote."""
from __future__ import annotations

from .base import Strategy, StrategyContext
from ..models import Signal


class EnsembleStrategy(Strategy):
    """
    Majority-vote ensemble of up to 8 sub-strategies.

    Vote mapping:
      buy  → +1
      sell → -1  (treated as close-and-go-short if allow_short=True, else close only)
      close → -0.5
      hold  → 0

    Entry: vote_sum > threshold (default 0 = any net positive)
    Exit:  vote_sum < -threshold OR explicit close majority
    """

    name = "ensemble"
    description = (
        "Majority-vote ensemble: up to 8 sub-strategies each cast a vote "
        "('buy', 'sell', 'close', 'hold'). Enters when net vote exceeds "
        "the threshold; exits when it drops below −threshold."
    )
    params_schema: dict = {}

    def __init__(self, sub_strategies: list[Strategy], threshold: float = 0.0, allow_short: bool = False) -> None:
        # Skip normal __init__ (no params_schema)
        self.params = {}
        self._subs = sub_strategies
        self._threshold = threshold
        self._allow_short = allow_short

    def prepare(self, bars, progress_cb=None) -> None:
        for s in self._subs:
            s.prepare(bars, progress_cb)

    def on_bar(self, ctx: StrategyContext) -> Signal:
        _VOTE = {"buy": 1.0, "sell": -1.0, "close": -0.5, "hold": 0.0}
        votes = [_VOTE.get(s.on_bar(ctx), 0.0) for s in self._subs]
        net = sum(votes)

        n = len(votes)
        # Normalise to [-1, +1] range
        norm = net / n if n > 0 else 0.0

        if ctx.position is None:
            if norm > self._threshold:
                return "buy"
            if self._allow_short and norm < -self._threshold:
                return "sell"
        else:
            if norm < -self._threshold:
                return "close"

        return "hold"
