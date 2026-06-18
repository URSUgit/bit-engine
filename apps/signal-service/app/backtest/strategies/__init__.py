"""Strategy registry — all available backtest strategies."""
from .base import Strategy, StrategyContext
from .rsi import RSIStrategy
from .buyhold import BuyHoldStrategy
from .ma_cross import MACrossStrategy
from .macd import MACDStrategy
from .momentum import MomentumStrategy
from .bollinger import BollingerStrategy
from .oracle_scalper import OracleScalperStrategy
from .scalp_ema import ScalpEMAStrategy
from .rsi_divergence import RSIDivergenceStrategy
from .vwap_reversion import VWAPReversionStrategy
from .breakout_scalp import BreakoutScalpStrategy
from .funding_arb import FundingArbStrategy
from .anomaly_fade import AnomalyFadeStrategy
from .ichimoku import IchimokuStrategy
from .stoch_rsi import StochRSIStrategy
from .psar import ParabolicSARStrategy
from .cci import CCIStrategy
from .elder_impulse import ElderImpulseStrategy
from .supertrend import SuperTrendStrategy
from .triple_ema import TripleEMAStrategy
from .williams_r import WilliamsRStrategy
from .keltner import KeltnerChannelStrategy
from .heikin_ashi import HeikinAshiStrategy
from .donchian import DonchianChannelStrategy
from .rsi_ma_filter import RSIMAFilterStrategy

STRATEGIES: dict[str, type[Strategy]] = {
    "rsi": RSIStrategy,
    "buy_and_hold": BuyHoldStrategy,
    "ma_cross": MACrossStrategy,
    "macd": MACDStrategy,
    "momentum": MomentumStrategy,
    "bollinger": BollingerStrategy,
    "oracle_scalper": OracleScalperStrategy,
    "scalp_ema": ScalpEMAStrategy,
    "rsi_divergence": RSIDivergenceStrategy,
    "vwap_reversion": VWAPReversionStrategy,
    "breakout_scalp": BreakoutScalpStrategy,
    "funding_arb": FundingArbStrategy,
    "anomaly_fade": AnomalyFadeStrategy,
    "ichimoku": IchimokuStrategy,
    "stoch_rsi": StochRSIStrategy,
    "psar": ParabolicSARStrategy,
    "cci": CCIStrategy,
    "elder_impulse": ElderImpulseStrategy,
    "supertrend": SuperTrendStrategy,
    "triple_ema": TripleEMAStrategy,
    "williams_r": WilliamsRStrategy,
    "keltner_channel": KeltnerChannelStrategy,
    "heikin_ashi": HeikinAshiStrategy,
    "donchian_channel": DonchianChannelStrategy,
    "rsi_ma_filter": RSIMAFilterStrategy,
}

__all__ = ["Strategy", "StrategyContext", "STRATEGIES"]
