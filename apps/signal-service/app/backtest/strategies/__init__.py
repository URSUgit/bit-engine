"""Strategy registry — all available backtest strategies."""
from .base import Strategy, StrategyContext
from .rsi import RSIStrategy
from .buyhold import BuyHoldStrategy
from .ma_cross import MACrossStrategy
from .momentum import MomentumStrategy
from .bollinger import BollingerStrategy
from .oracle_scalper import OracleScalperStrategy

STRATEGIES: dict[str, type[Strategy]] = {
    "rsi": RSIStrategy,
    "buy_and_hold": BuyHoldStrategy,
    "ma_cross": MACrossStrategy,
    "momentum": MomentumStrategy,
    "bollinger": BollingerStrategy,
    "oracle_scalper": OracleScalperStrategy,
}

__all__ = ["Strategy", "StrategyContext", "STRATEGIES"]
