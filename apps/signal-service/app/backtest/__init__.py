"""Historical backtesting engine — real 10y+ market data + strategy validation."""
from .engine import Backtest, BacktestResult
from .data import HistoricalDataLoader
from .strategies import STRATEGIES

__all__ = ["Backtest", "BacktestResult", "HistoricalDataLoader", "STRATEGIES"]
