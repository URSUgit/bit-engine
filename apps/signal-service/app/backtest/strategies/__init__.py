"""Strategy registry — all available backtest strategies."""
from .base import Strategy, StrategyContext
from .rsi import RSIStrategy
from .buyhold import BuyHoldStrategy
from .ma_cross import MACrossStrategy
from .momentum import MomentumStrategy
from .bollinger import BollingerStrategy

STRATEGIES: dict[str, type[Strategy]] = {
    "rsi": RSIStrategy,
    "buy_and_hold": BuyHoldStrategy,
    "ma_cross": MACrossStrategy,
    "momentum": MomentumStrategy,
    "bollinger": BollingerStrategy,
}

__all__ = ["Strategy", "StrategyContext", "STRATEGIES"]
