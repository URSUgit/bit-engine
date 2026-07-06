"""
Parameter optimization — grid-search across strategy params to find the best settings.
Runs every combination, ranks by chosen metric, returns full heatmap matrix.
"""
from __future__ import annotations

import asyncio
import itertools
import logging
from typing import Any

from pydantic import BaseModel, Field

from .data import HistoricalDataLoader
from .engine import Backtest, _asset_class
from .metrics import compute_metrics
from .models import BacktestParams
from .strategies import STRATEGIES

log = logging.getLogger(__name__)

OPTIMIZABLE_METRICS = {
    "sharpe_ratio", "sortino_ratio", "total_return_pct", "cagr_pct",
    "win_rate_pct", "profit_factor", "calmar_ratio",
}


class ParamRange(BaseModel):
    name: str
    start: float
    stop: float
    step: float

    def values(self) -> list[float]:
        out = []
        v = self.start
        # tolerate float dust
        eps = self.step / 1e6 if self.step > 0 else 1e-9
        while v <= self.stop + eps:
            out.append(round(v, 6))
            v += self.step
        return out


class OptimizeRequest(BaseModel):
    symbol: str
    strategy: str
    start_date: str = "2019-01-01"
    end_date: str | None = None
    interval: str = "1d"
    initial_capital: float = 10000
    commission_pct: float = 0.001
    slippage_pct: float = 0.0005
    position_size_pct: float = 1.0
    param_ranges: list[ParamRange]
    metric: str = Field("sharpe_ratio", description="Metric to maximize")
    max_combinations: int = Field(400, ge=1, le=2000)


class OptimizeCell(BaseModel):
    params: dict[str, float]
    metric_value: float
    total_return_pct: float
    sharpe_ratio: float
    max_drawdown_pct: float
    total_trades: int


class OptimizeResult(BaseModel):
    symbol: str
    strategy: str
    metric: str
    combinations_run: int
    best_params: dict[str, float]
    best_metric_value: float
    best_total_return_pct: float
    cells: list[OptimizeCell]
    param_names: list[str]
    runtime_ms: float


async def run_optimization(req: OptimizeRequest) -> OptimizeResult:
    """Grid search over the cartesian product of param ranges."""
    import time as _time
    t0 = _time.perf_counter()

    if req.strategy not in STRATEGIES:
        raise ValueError(f"Unknown strategy '{req.strategy}'")
    if req.metric not in OPTIMIZABLE_METRICS:
        raise ValueError(f"Metric must be one of {sorted(OPTIMIZABLE_METRICS)}")

    # Pre-compute combinations
    grid_values = [r.values() for r in req.param_ranges]
    combos = list(itertools.product(*grid_values))
    if len(combos) > req.max_combinations:
        raise ValueError(
            f"Grid has {len(combos)} combinations but max_combinations={req.max_combinations}. "
            f"Shrink param ranges or raise the cap."
        )

    # Load data ONCE — every backtest reuses the same bars
    loader = HistoricalDataLoader()
    bars = await loader.load(req.symbol, req.start_date, req.end_date, req.interval)
    if len(bars) < 20:
        raise ValueError(f"Insufficient data for {req.symbol}")

    strategy_cls = STRATEGIES[req.strategy]
    asset_cls = _asset_class(req.symbol)
    param_names = [p.name for p in req.param_ranges]

    cells: list[OptimizeCell] = []

    for combo in combos:
        params = {name: value for name, value in zip(param_names, combo)}
        strategy = strategy_cls(**params)
        bt = Backtest(
            initial_capital=req.initial_capital,
            commission_pct=req.commission_pct,
            slippage_pct=req.slippage_pct,
            position_size_pct=req.position_size_pct,
        )
        trades, equity = bt.run(bars, strategy, symbol=req.symbol)
        m = compute_metrics(
            initial_capital=req.initial_capital,
            equity=equity, trades=trades,
            interval=req.interval, asset_class=asset_cls,
        )
        metric_value = getattr(m, req.metric)
        cells.append(OptimizeCell(
            params=params,
            metric_value=round(float(metric_value), 4),
            total_return_pct=m.total_return_pct,
            sharpe_ratio=m.sharpe_ratio,
            max_drawdown_pct=m.max_drawdown_pct,
            total_trades=m.total_trades,
        ))

    # Best by chosen metric
    best = max(cells, key=lambda c: c.metric_value)
    runtime_ms = (_time.perf_counter() - t0) * 1000

    return OptimizeResult(
        symbol=req.symbol,
        strategy=req.strategy,
        metric=req.metric,
        combinations_run=len(cells),
        best_params=best.params,
        best_metric_value=best.metric_value,
        best_total_return_pct=best.total_return_pct,
        cells=cells,
        param_names=param_names,
        runtime_ms=round(runtime_ms, 1),
    )
