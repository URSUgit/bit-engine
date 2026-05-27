"""
Bar-by-bar backtest engine.
- No look-ahead: strategies see only history through the current bar.
- Orders fill at NEXT bar's open + slippage (realistic).
- Commission applied on entry and exit.
"""
from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime
from typing import Optional

from .data import HistoricalDataLoader, SYMBOL_CATALOG
from .history import backtest_history
from .metrics import build_equity_curve, compute_metrics
from .models import (
    Bar, BacktestParams, BacktestResult, Position, Signal,
    Trade, TradeRecord,
)
from .strategies import STRATEGIES
from .strategies.base import Strategy, StrategyContext

log = logging.getLogger(__name__)


def _asset_class(symbol: str) -> str:
    for cat, syms in SYMBOL_CATALOG.items():
        if symbol in syms:
            if cat == "crypto":
                return "crypto"
            if cat in ("stocks", "etfs", "indices"):
                return "stock"
            if cat == "forex":
                return "forex"
            if cat == "commodities":
                return "commodity"
    return "stock"


class Backtest:
    """Single-asset, single-position backtest runner."""

    def __init__(
        self,
        initial_capital: float = 10_000,
        commission_pct: float = 0.001,
        slippage_pct: float = 0.0005,
        position_size_pct: float = 1.0,
    ) -> None:
        self.initial_capital = initial_capital
        self.commission_pct = commission_pct
        self.slippage_pct = slippage_pct
        self.position_size_pct = position_size_pct

        self.cash = initial_capital
        self.position: Optional[Position] = None
        self.trades: list[Trade] = []
        self.equity: list[tuple[datetime, float]] = []
        self._entry_bar_index: int = -1

    # ── execution helpers ────────────────────────────────────────────────────

    def _enter_long(self, symbol: str, fill_price: float, bar: Bar, bar_index: int) -> None:
        if self.position is not None or self.cash <= 0:
            return
        allocation = self.cash * self.position_size_pct
        # Commission is charged on notional. Effective cost per unit = price * (1 + commission).
        units = allocation / (fill_price * (1 + self.commission_pct))
        cost = units * fill_price
        fee = cost * self.commission_pct
        total = cost + fee
        if total > self.cash:
            units = self.cash / (fill_price * (1 + self.commission_pct))
            cost = units * fill_price
            fee = cost * self.commission_pct
            total = cost + fee
        if units <= 0:
            return
        self.cash -= total
        self.position = Position(
            symbol=symbol,
            side="long",
            entry_price=fill_price,
            entry_time=bar.timestamp,
            size=units,
            cost=total,
        )
        self._entry_bar_index = bar_index
        self._entry_fee = fee

    def _exit_long(self, fill_price: float, bar: Bar, bar_index: int) -> None:
        if self.position is None or self.position.side != "long":
            return
        gross = self.position.size * fill_price
        fee = gross * self.commission_pct
        net = gross - fee
        self.cash += net
        pnl = net - self.position.cost
        pnl_pct = pnl / self.position.cost * 100 if self.position.cost > 0 else 0.0

        self.trades.append(Trade(
            symbol=self.position.symbol,
            side="long",
            entry_time=self.position.entry_time,
            exit_time=bar.timestamp,
            entry_price=self.position.entry_price,
            exit_price=fill_price,
            size=self.position.size,
            pnl=pnl,
            pnl_pct=pnl_pct,
            duration_bars=bar_index - self._entry_bar_index,
            entry_fee=self._entry_fee,
            exit_fee=fee,
        ))
        self.position = None
        self._entry_bar_index = -1

    # ── main loop ────────────────────────────────────────────────────────────

    def _mark_to_market(self, bar: Bar) -> float:
        if self.position is None:
            return self.cash
        return self.cash + self.position.size * bar.close

    def run(
        self,
        bars: list[Bar],
        strategy: Strategy,
        symbol: str = "",
    ) -> tuple[list[Trade], list[tuple[datetime, float]]]:
        """
        Iterate bars, ask strategy for signals, simulate fills.
        Returns (trades, equity_series).
        """
        if not bars:
            return [], []

        # Allow oracle / look-ahead strategies to precompute signals from full bar data
        strategy.prepare(bars)

        for i, bar in enumerate(bars):
            # 1. Strategy decides using history up to and including current bar
            ctx = StrategyContext(history=bars[: i + 1], position=self.position)
            signal: Signal = strategy.on_bar(ctx)

            # 2. Execute pending signal at NEXT bar's open (no look-ahead at fills either).
            # On the LAST bar, we close any open position at the close to settle.
            if i + 1 < len(bars):
                next_bar = bars[i + 1]
                if signal == "buy" and self.position is None:
                    fill = next_bar.open * (1 + self.slippage_pct)
                    self._enter_long(symbol, fill, next_bar, i + 1)
                elif signal in ("sell", "close") and self.position is not None:
                    fill = next_bar.open * (1 - self.slippage_pct)
                    self._exit_long(fill, next_bar, i + 1)
            else:
                # End-of-data: settle position at final close
                if self.position is not None:
                    self._exit_long(bar.close, bar, i)

            # 3. Record equity AFTER any execution at this bar
            self.equity.append((bar.timestamp, self._mark_to_market(bar)))

        return self.trades, self.equity


# ── High-level orchestrator ───────────────────────────────────────────────────

async def run_backtest(params: BacktestParams) -> BacktestResult:
    """End-to-end: load data, instantiate strategy, run, compute metrics."""
    t0 = time.perf_counter()

    if params.strategy not in STRATEGIES:
        raise ValueError(f"Unknown strategy '{params.strategy}'. Available: {list(STRATEGIES)}")

    loader = HistoricalDataLoader()
    bars = await loader.load(
        symbol=params.symbol,
        start_date=params.start_date,
        end_date=params.end_date,
        interval=params.interval,
    )
    if len(bars) < 20:
        raise ValueError(
            f"Insufficient historical data for {params.symbol} ({params.interval}). "
            f"Got {len(bars)} bars. Try a longer date range or a different symbol."
        )

    strategy_cls = STRATEGIES[params.strategy]
    strategy = strategy_cls(**params.strategy_params)

    bt = Backtest(
        initial_capital=params.initial_capital,
        commission_pct=params.commission_pct,
        slippage_pct=params.slippage_pct,
        position_size_pct=params.position_size_pct,
    )
    trades, equity = bt.run(bars, strategy, symbol=params.symbol)

    asset_cls = _asset_class(params.symbol)
    metrics = compute_metrics(
        initial_capital=params.initial_capital,
        equity=equity,
        trades=trades,
        interval=params.interval,
        asset_class=asset_cls,
    )

    # Benchmark: buy & hold
    benchmark = Backtest(
        initial_capital=params.initial_capital,
        commission_pct=params.commission_pct,
        slippage_pct=params.slippage_pct,
        position_size_pct=params.position_size_pct,
    )
    bench_trades, bench_equity = benchmark.run(
        bars, STRATEGIES["buy_and_hold"](), symbol=params.symbol,
    )
    bench_metrics = compute_metrics(
        initial_capital=params.initial_capital,
        equity=bench_equity,
        trades=bench_trades,
        interval=params.interval,
        asset_class=asset_cls,
    )

    runtime_ms = (time.perf_counter() - t0) * 1000

    entry_analysis = getattr(strategy, "entry_analysis", None)

    result = BacktestResult(
        id=str(uuid.uuid4()),
        symbol=params.symbol,
        strategy=params.strategy,
        interval=params.interval,
        start_date=bars[0].timestamp.date().isoformat(),
        end_date=bars[-1].timestamp.date().isoformat(),
        params_used=strategy.params,
        metrics=metrics,
        benchmark_metrics=bench_metrics,
        trades=[
            TradeRecord(
                side=t.side,
                entry_time=t.entry_time.isoformat(),
                exit_time=t.exit_time.isoformat(),
                entry_price=round(t.entry_price, 6),
                exit_price=round(t.exit_price, 6),
                size=round(t.size, 8),
                pnl=round(t.pnl, 2),
                pnl_pct=round(t.pnl_pct, 2),
                duration_bars=t.duration_bars,
            )
            for t in trades
        ],
        equity_curve=build_equity_curve(equity),
        bars_processed=len(bars),
        runtime_ms=round(runtime_ms, 1),
        entry_analysis=entry_analysis,
    )

    # Persist for history / sharing
    try:
        backtest_history.save(result)
    except Exception as e:
        log.warning("Failed to save backtest to history: %s", e)

    return result
