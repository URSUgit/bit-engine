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
    position_size_pct: float = Field(0.25, gt=0, le=1.0, description="0.25 = 25% of capital per trade")
    strategy_params: dict = Field(default_factory=dict)
    # ── Realism upgrades (optional, defaults preserve existing behavior) ──────
    spread_bps: float = Field(0.0, ge=0, le=200, description="Bid/ask spread bps (0=disabled)")
    enable_market_impact: bool = Field(False, description="Almgren-Chriss market impact model")
    execution_latency_ms: int = Field(0, ge=0, le=60000, description="Fill latency in ms; if > ½ bar, fills at next bar")
    use_funding_rates: bool = Field(False, description="Fetch & deduct perpetual funding every 8h")
    leverage: float = Field(1.0, ge=1.0, le=125.0, description="Position leverage (1=spot/no leverage)")
    run_anomaly_scan: bool = Field(False, description="Scan for market anomalies and attach to result")


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
    # Extended risk/quality metrics
    recovery_factor: float = 0.0          # total_return / max_drawdown
    sqn: float = 0.0                      # System Quality Number = sqrt(n) * mean/std of pnl_pct
    avg_win_pct: float = 0.0             # average winning trade %
    avg_loss_pct: float = 0.0            # average losing trade %
    avg_win_loss_ratio: float = 0.0      # avg_win / abs(avg_loss)
    max_consecutive_wins: int = 0
    max_consecutive_losses: int = 0


class FeatureStats(BaseModel):
    """Aggregate stats for one feature across all oracle entry bars."""
    feature: str
    count: int           # entries where this feature was available (not None)
    mean: Optional[float]
    std: Optional[float]
    min: Optional[float]
    max: Optional[float]


class EntryDataPoint(BaseModel):
    """All analysis data for one oracle entry bar."""
    bar_index: int
    timestamp: str
    entry_price: float
    features: dict[str, Optional[float]]          # point-in-time snapshot
    series: dict[str, list[Optional[float]]]      # last N bars before entry


class EntryAnalysis(BaseModel):
    """Aggregated time-series and feature analysis for all oracle entry signals."""
    entry_count: int
    series_length: int
    feature_names: list[str]
    entries: list[EntryDataPoint]
    feature_stats: list[FeatureStats]


class BacktestResult(BaseModel):
    id: str
    symbol: str
    strategy: str
    interval: str
    start_date: str
    end_date: str
    params_used: dict
    metrics: PerformanceMetrics
    benchmark_metrics: Optional[PerformanceMetrics] = None
    trades: list[TradeRecord]
    equity_curve: list[EquityPoint]
    bars_processed: int
    runtime_ms: float
    entry_analysis: Optional[EntryAnalysis] = None
    # Realism additions
    friction_breakdown: Optional[dict] = None  # commission/slippage/spread/funding breakdown
    anomalies: Optional[list[dict]] = None     # detected market anomalies
    short_trades: int = 0                      # number of short trades executed


class StrategyInfo(BaseModel):
    name: str
    description: str
    params_schema: dict
