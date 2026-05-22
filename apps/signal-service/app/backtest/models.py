"""Data models for the backtesting engine."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

Side = Literal["long", "short"]
Signal = Literal["buy", "sell", "close", "hold"]


# ── Internal dataclasses (engine state) ───────────────────────────────────────

@dataclass
class Bar:
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float

    @property
    def ts(self) -> int:
        return int(self.timestamp.timestamp())


@dataclass
class Position:
    symbol: str
    side: Side
    entry_price: float
    entry_time: datetime
    size: float          # units of asset
    cost: float          # cash committed including fees

    def mtm_value(self, current_price: float) -> float:
        """Mark-to-market value at current_price."""
        if self.side == "long":
            return self.size * current_price
        return self.cost + (self.entry_price - current_price) * self.size


@dataclass
class Trade:
    symbol: str
    side: Side
    entry_time: datetime
    exit_time: datetime
    entry_price: float
    exit_price: float
    size: float
    pnl: float
    pnl_pct: float
    duration_bars: int
    entry_fee: float = 0.0
    exit_fee: float = 0.0

    @property
    def is_win(self) -> bool:
        return self.pnl > 0


# ── Pydantic models (API surface) ─────────────────────────────────────────────

class BacktestParams(BaseModel):
    symbol: str = Field(..., description="e.g. BTC-USD, AAPL, EURUSD=X")
    strategy: str = Field(..., description="Strategy name (see /strategies)")
    start_date: str = Field("2014-01-01", description="YYYY-MM-DD")
    end_date: Optional[str] = Field(None, description="YYYY-MM-DD or omit for today")
    interval: str = Field("1d", description="1d, 1h, 1wk")
    initial_capital: float = Field(10000, gt=0)
    commission_pct: float = Field(0.001, ge=0, le=0.05, description="0.001 = 0.1%")
    slippage_pct: float = Field(0.0005, ge=0, le=0.01, description="0.0005 = 5 bps")
    position_size_pct: float = Field(1.0, gt=0, le=1.0, description="1.0 = all-in")
    strategy_params: dict = Field(default_factory=dict)


class EquityPoint(BaseModel):
    t: int           # unix timestamp seconds
    equity: float
    drawdown_pct: float


class TradeRecord(BaseModel):
    side: Side
    entry_time: str
    exit_time: str
    entry_price: float
    exit_price: float
    size: float
    pnl: float
    pnl_pct: float
    duration_bars: int


class PerformanceMetrics(BaseModel):
    total_return_pct: float
    cagr_pct: float
    sharpe_ratio: float
    sortino_ratio: float
    max_drawdown_pct: float
    calmar_ratio: float
    win_rate_pct: float
    profit_factor: float
    total_trades: int
    winning_trades: int
    losing_trades: int
    avg_trade_pnl_pct: float
    best_trade_pct: float
    worst_trade_pct: float
    avg_trade_duration_bars: float
    exposure_pct: float
    final_equity: float
    initial_capital: float


class BacktestResult(BaseModel):
    id: str
    symbol: str
    strategy: str
    interval: str
    start_date: str
    end_date: str
    params_used: dict
    metrics: PerformanceMetrics
    benchmark_metrics: Optional[PerformanceMetrics] = None   # buy & hold comparison
    trades: list[TradeRecord]
    equity_curve: list[EquityPoint]
    bars_processed: int
    runtime_ms: float


class StrategyInfo(BaseModel):
    name: str
    description: str
    params_schema: dict
