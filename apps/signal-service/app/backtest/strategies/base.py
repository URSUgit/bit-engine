"""Base classes for backtest strategies."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from ..models import Bar, Position, Signal


@dataclass
class StrategyContext:
    """
    Per-bar context handed to a strategy.

    history:    all bars up to and INCLUDING current_bar (no look-ahead).
    position:   currently open position for this symbol, or None.
    properties: optional extra data (funding_rate, open_interest, fear_greed, …).
    """
    history: list[Bar]
    position: Position | None
    properties: dict = field(default_factory=dict)

    @property
    def current_bar(self) -> Bar:
        return self.history[-1]

    @property
    def closes(self) -> list[float]:
        return [b.close for b in self.history]


class Strategy(ABC):
    """Abstract base. Subclasses must implement `on_bar` and declare params_schema."""

    name: str = "abstract"
    description: str = "abstract strategy"
    params_schema: dict = {}

    def __init__(self, **params) -> None:
        # Merge user-provided params with schema defaults
        merged = {k: v.get("default") for k, v in self.params_schema.items()}
        merged.update({k: v for k, v in params.items() if v is not None})
        self.params = merged

    def prepare(self, bars: list[Bar], progress_cb=None) -> None:
        """
        Optional hook called once with the FULL bar series before the engine loop.
        Standard strategies leave this as a no-op.
        Oracle / look-ahead strategies override this to precompute signals.
        progress_cb(phase, current, total) is an optional thread-safe callback.
        """

    @abstractmethod
    def on_bar(self, ctx: StrategyContext) -> Signal:
        """Return 'buy', 'sell', 'close', or 'hold'."""
        ...

    def info(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "params_schema": self.params_schema,
            "current_params": self.params,
        }
