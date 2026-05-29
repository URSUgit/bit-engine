"""Strategy registry — all available backtest strategies."""
from .base import Strategy, StrategyContext
from .rsi import RSIStrategy
from .buyhold import BuyHoldStrategy
from .ma_cross import MACrossStrategy
from .momentum import MomentumStrategy
from .bollinger import BollingerStrategy
from .oracle_scalper import OracleScalperStrategy
from .scalp_ema import ScalpEMAStrategy
from .rsi_divergence import RSIDivergenceStrategy
from .vwap_reversion import VWAPReversionStrategy
from .breakout_scalp import BreakoutScalpStrategy
from .funding_arb import FundingArbStrategy
from .anomaly_fade import AnomalyFadeStrategy

STRATEGIES: dict[str, type[Strategy]] = {
    "rsi": RSIStrategy,
    "buy_and_hold": BuyHoldStrategy,
    "ma_cross": MACrossStrategy,
    "momentum": MomentumStrategy,
    "bollinger": BollingerStrategy,
    "oracle_scalper": OracleScalperStrategy,
    "scalp_ema": ScalpEMAStrategy,
    "rsi_divergence": RSIDivergenceStrategy,
    "vwap_reversion": VWAPReversionStrategy,
    "breakout_scalp": BreakoutScalpStrategy,
    "funding_arb": FundingArbStrategy,
    "anomaly_fade": AnomalyFadeStrategy,
}

__all__ = ["Strategy", "StrategyContext", "STRATEGIES"]

