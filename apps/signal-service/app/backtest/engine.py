"""
Bar-by-bar backtest engine with realistic fill simulation.

Realism features (all configurable via BacktestParams):
  - Bid/ask spread (buy at ask = close + ½ spread, sell at bid = close - ½ spread)
  - Market impact (Almgren-Chriss simplified)
  - Execution latency (fills at next bar when latency > ½ bar duration)
  - Funding rate deductions for perpetual positions
  - Liquidation engine (closes position when loss exceeds 90% of margin)
  - Full friction breakdown (commission / slippage / spread / funding)
  - Long AND short positions
"""
from __future__ import annotations

import logging
import math
import time
import uuid
from datetime import datetime
from typing import Optional

from .data import HistoricalDataLoader, SYMBOL_CATALOG, binance_symbol
from .history import backtest_history
from .metrics import build_equity_curve, compute_metrics
from .models import (
    Bar, BacktestParams, BacktestResult, Position, Signal,
    Trade, TradeRecord,
)
from .strategies import STRATEGIES
from .strategies.base import Strategy, StrategyContext

log = logging.getLogger(__name__)

# Approximate milliseconds per bar for each interval
_BAR_MS: dict[str, int] = {
    "1s":  1_000,
    "1m":  60_000,
    "3m":  180_000,
    "5m":  300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h":  3_600_000,
    "2h":  7_200_000,
    "4h":  14_400_000,
    "1d":  86_400_000,
    "1wk": 604_800_000,
}

# Funding rate is every 8 h; bars per funding period
_FUNDING_BARS: dict[str, int] = {
    "1m": 480, "3m": 160, "5m": 96, "15m": 32,
    "30m": 16, "1h": 8, "4h": 2, "1d": 1,
}


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
    # Native Binance pairs (BTCUSDT) aren't in the Yahoo-keyed catalog but
    # are still crypto — otherwise they'd get stock annualization and,
    # worse, never accrue funding rates.
    if binance_symbol(symbol):
        return "crypto"
    return "stock"


def _avg_daily_volume(bars: list[Bar], lookback: int = 20) -> float:
    """Rolling average close × volume as proxy for notional daily volume."""
    w = bars[-lookback:] if len(bars) >= lookback else bars
    if not w:
        return 1.0
    return sum(b.close * b.volume for b in w) / len(w)


class Backtest:
    """Single-asset, single-position backtest runner with realistic fills."""

    def __init__(
        self,
        initial_capital: float = 10_000,
        commission_pct: float = 0.001,
        slippage_pct: float = 0.0005,
        position_size_pct: float = 1.0,
        spread_bps: float = 2.0,
        execution_latency_ms: int = 100,
        enable_market_impact: bool = True,
        use_funding_rates: bool = True,
        funding_rates: list[tuple[int, float]] | None = None,  # [(unix_ts, rate), ...]
    ) -> None:
        self.initial_capital = initial_capital
        self.commission_pct = commission_pct
        self.slippage_pct = slippage_pct
        self.position_size_pct = position_size_pct
        self.spread_bps = spread_bps
        self.execution_latency_ms = execution_latency_ms
        self.enable_market_impact = enable_market_impact
        self.use_funding_rates = use_funding_rates
        self._funding_schedule: list[tuple[int, float]] = funding_rates or []

        self.cash = initial_capital
        self.position: Optional[Position] = None
        self.trades: list[Trade] = []
        self.equity: list[tuple[datetime, float]] = []
        self._entry_bar_index: int = -1
        self._entry_fee: float = 0.0
        self._entry_slippage: float = 0.0
        self._entry_spread: float = 0.0
        self._last_funding_bar: int = 0

        # Friction accumulators
        self.total_commission: float = 0.0
        self.total_slippage: float = 0.0
        self.total_spread: float = 0.0
        self.total_funding: float = 0.0

    # ── fill-price helpers ────────────────────────────────────────────────────

    def _spread_cost(self, price: float, is_buy: bool) -> tuple[float, float]:
        """Return (fill_price, spread_cost_usd) after applying half-spread."""
        half_spread = price * (self.spread_bps / 20_000)
        if is_buy:
            return price + half_spread, 0.0  # spread cost baked into fill price
        return price - half_spread, 0.0

    def _market_impact(self, order_usd: float, avg_daily_vol_usd: float) -> float:
        """
        Almgren-Chriss simplified: impact_bps = k × sqrt(order / avg_daily_vol).
        k=10 is empirically reasonable for retail size on BTC.
        Returns fractional price impact (e.g. 0.0003 = 3 bps).
        """
        if not self.enable_market_impact or avg_daily_vol_usd <= 0:
            return 0.0
        ratio = order_usd / max(avg_daily_vol_usd, 1.0)
        impact_bps = 10.0 * math.sqrt(ratio)
        return min(impact_bps, 50.0) / 10_000.0  # cap at 50 bps

    def _fill_price(
        self,
        raw_price: float,
        is_buy: bool,
        order_usd: float,
        avg_daily_vol: float,
    ) -> tuple[float, float, float]:
        """
        Compute realistic fill price.
        Returns (fill_price, slippage_usd, spread_usd).
        """
        # Spread
        half_spread_frac = self.spread_bps / 20_000
        spread_adj = raw_price * half_spread_frac * (1 if is_buy else -1)
        spread_usd = abs(spread_adj) * (order_usd / raw_price) if raw_price else 0.0

        # Slippage (bar volatility-based)
        slip_adj = raw_price * self.slippage_pct * (1 if is_buy else -1)
        slippage_usd = abs(slip_adj) * (order_usd / raw_price) if raw_price else 0.0

        # Market impact
        impact_frac = self._market_impact(order_usd, avg_daily_vol)
        impact_adj = raw_price * impact_frac * (1 if is_buy else -1)

        fill_price = raw_price + spread_adj + slip_adj + impact_adj
        return fill_price, slippage_usd, spread_usd

    # ── position management ───────────────────────────────────────────────────

    def _enter_position(
        self,
        side: str,
        symbol: str,
        raw_price: float,
        bar: Bar,
        bar_index: int,
        avg_daily_vol: float,
    ) -> None:
        if self.position is not None or self.cash <= 0:
            return
        allocation = self.cash * self.position_size_pct
        is_buy = (side == "long")

        fill_price, slip_usd, spread_usd = self._fill_price(raw_price, is_buy, allocation, avg_daily_vol)

        if fill_price <= 0:
            return
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
        self.total_commission += fee
        self.total_slippage += slip_usd
        self.total_spread += spread_usd

        self.position = Position(
            symbol=symbol,
            side=side,   # type: ignore[arg-type]
            entry_price=fill_price,
            entry_time=bar.timestamp,
            size=units,
            cost=total,
        )
        self._entry_bar_index = bar_index
        self._entry_fee = fee
        self._entry_slippage = slip_usd
        self._entry_spread = spread_usd

    def _exit_position(
        self,
        raw_price: float,
        bar: Bar,
        bar_index: int,
        avg_daily_vol: float,
        reason: str = "signal",
    ) -> None:
        if self.position is None:
            return
        pos = self.position
        is_sell = True
        fill_price, slip_usd, spread_usd = self._fill_price(raw_price, not is_sell, pos.cost, avg_daily_vol)

        if pos.side == "long":
            gross = pos.size * fill_price
            fee = gross * self.commission_pct
            net = gross - fee
            self.cash += net
            pnl = net - pos.cost
        else:  # short
            # Short PnL = (entry - fill) × size, minus fees
            gross_pnl = (pos.entry_price - fill_price) * pos.size
            fee = abs(gross_pnl) * self.commission_pct + pos.cost * self.commission_pct
            net = pos.cost + gross_pnl - fee  # return margin + pnl - fee
            self.cash += net
            pnl = gross_pnl - fee

        pnl_pct = pnl / pos.cost * 100 if pos.cost > 0 else 0.0
        self.total_commission += fee
        self.total_slippage += slip_usd
        self.total_spread += spread_usd

        self.trades.append(Trade(
            symbol=pos.symbol,
            side=pos.side,
            entry_time=pos.entry_time,
            exit_time=bar.timestamp,
            entry_price=pos.entry_price,
            exit_price=fill_price,
            size=pos.size,
            pnl=pnl,
            pnl_pct=pnl_pct,
            duration_bars=bar_index - self._entry_bar_index,
            entry_fee=self._entry_fee,
            exit_fee=fee,
        ))
        self.position = None
        self._entry_bar_index = -1

    # ── liquidation ───────────────────────────────────────────────────────────

    def _check_liquidation(self, current_price: float, bar: Bar, bar_index: int, avg_daily_vol: float) -> bool:
        """Force-close if loss exceeds 90% of committed margin."""
        if self.position is None:
            return False
        pos = self.position
        if pos.side == "long":
            liq_price = pos.entry_price * (1 - 0.9 / max(1, 1))  # no leverage in spot
            triggered = current_price <= pos.entry_price * 0.10  # 90% loss
        else:
            triggered = current_price >= pos.entry_price * 1.90
        if triggered:
            self._exit_position(current_price, bar, bar_index, avg_daily_vol, reason="liquidation")
            return True
        return False

    # ── funding ───────────────────────────────────────────────────────────────

    def _apply_funding(self, bar_index: int, interval: str, bar: Bar) -> None:
        """Deduct/add funding for open perpetual positions."""
        if not self.use_funding_rates or self.position is None:
            return
        period = _FUNDING_BARS.get(interval, 480)
        if bar_index % period != 0 or bar_index == 0:
            return

        # Look up scheduled funding rate, default 0.01% per 8h
        rate = 0.0001
        bar_ts = bar.ts
        for ts, r in self._funding_schedule:
            if ts <= bar_ts:
                rate = r
            else:
                break

        notional = self.position.size * bar.close
        # Positive rate: longs pay shorts. Negative: shorts pay longs.
        if self.position.side == "long":
            funding_payment = notional * rate
        else:
            funding_payment = -notional * rate  # shorts receive when rate > 0

        self.cash -= funding_payment
        self.total_funding += abs(funding_payment)

    # ── main loop ────────────────────────────────────────────────────────────

    def _mark_to_market(self, bar: Bar) -> float:
        if self.position is None:
            return self.cash
        if self.position.side == "long":
            return self.cash + self.position.size * bar.close
        else:
            # Short: cash + margin + unrealized PnL
            pnl = (self.position.entry_price - bar.close) * self.position.size
            return self.cash + self.position.cost + pnl

    def _should_fill_next_bar(self, interval: str) -> bool:
        """If latency > half the bar duration, fill shifts to next bar."""
        bar_ms = _BAR_MS.get(interval, 60_000)
        return self.execution_latency_ms > bar_ms // 2

    def run(
        self,
        bars: list[Bar],
        strategy: Strategy,
        symbol: str = "",
        interval: str = "1d",
        progress_cb=None,
        funding_rates: list[tuple[int, float]] | None = None,
    ) -> tuple[list[Trade], list[tuple[datetime, float]]]:
        if not bars:
            return [], []

        if funding_rates:
            self._funding_schedule = sorted(funding_rates, key=lambda x: x[0])

        strategy.prepare(bars, progress_cb=progress_cb)

        n = len(bars)
        report_every = max(1, n // 40)
        fill_next = self._should_fill_next_bar(interval)
        # Cap history window so strategies see at most 500 bars — any lookback
        # longer than this is unreasonable for scalping and prevents O(N²) growth.
        _HISTORY_WINDOW = 500

        # Pending order buffer for latency simulation
        pending_signal: Signal | None = None
        pending_bar_index: int = -1

        for i, bar in enumerate(bars):
            if progress_cb and i % report_every == 0:
                progress_cb("backtest", i, n)

            # Rolling avg daily volume for market impact
            avg_dvol = _avg_daily_volume(bars[max(0, i - 20): i + 1])

            # Apply funding for perpetuals
            self._apply_funding(i, interval, bar)

            # Check liquidation
            self._check_liquidation(bar.close, bar, i, avg_dvol)

            # Build context with optional properties
            funding_rate = None
            if self._funding_schedule:
                bar_ts = bar.ts
                for ts, r in self._funding_schedule:
                    if ts <= bar_ts:
                        funding_rate = r

            history_start = max(0, i + 1 - _HISTORY_WINDOW)
            ctx = StrategyContext(
                history=bars[history_start:i + 1],
                position=self.position,
                properties={"funding_rate": funding_rate},
            )
            signal: Signal = strategy.on_bar(ctx)

            # Execute fills
            if fill_next:
                # Execute the PREVIOUS bar's signal at this bar's open
                if pending_signal is not None:
                    fill_raw = bar.open
                    if pending_signal == "buy" and self.position is None:
                        self._enter_position("long", symbol, fill_raw, bar, i, avg_dvol)
                    elif pending_signal == "short" and self.position is None:
                        self._enter_position("short", symbol, fill_raw, bar, i, avg_dvol)
                    elif pending_signal in ("sell", "close") and self.position is not None:
                        self._exit_position(fill_raw, bar, i, avg_dvol)
                pending_signal = signal
                pending_bar_index = i
            else:
                # Fill at this bar's close (current bar, realistic for small latency)
                if i + 1 < n:
                    next_bar = bars[i + 1]
                    fill_raw = next_bar.open
                else:
                    fill_raw = bar.close
                    next_bar = bar

                if signal == "buy" and self.position is None:
                    self._enter_position("long", symbol, fill_raw, next_bar, i + 1, avg_dvol)
                elif signal == "short" and self.position is None:
                    self._enter_position("short", symbol, fill_raw, next_bar, i + 1, avg_dvol)
                elif signal in ("sell", "close") and self.position is not None:
                    self._exit_position(fill_raw, next_bar, i + 1, avg_dvol)

            self.equity.append((bar.timestamp, self._mark_to_market(bar)))

        # End-of-data: force close any open position
        if self.position is not None:
            last_bar = bars[-1]
            avg_dvol = _avg_daily_volume(bars[-20:])
            self._exit_position(last_bar.close, last_bar, len(bars) - 1, avg_dvol, reason="end_of_data")

        if progress_cb:
            progress_cb("backtest", n, n)
        return self.trades, self.equity

    def friction_breakdown(self) -> dict:
        gross = sum(abs(t.pnl) for t in self.trades) if self.trades else 1.0
        total = self.total_commission + self.total_slippage + self.total_spread + self.total_funding
        return {
            "commission_usd": round(self.total_commission, 2),
            "slippage_usd": round(self.total_slippage, 2),
            "spread_usd": round(self.total_spread, 2),
            "funding_usd": round(self.total_funding, 2),
            "total_usd": round(total, 2),
            "total_pct_of_gross": round(total / max(gross, 1.0) * 100, 2),
        }


# ── Context extension for properties ──────────────────────────────────────────
# Patch StrategyContext to support properties dict (backward-compatible).
# Strategies that don't use it are unaffected.

from .strategies.base import StrategyContext as _SC  # noqa: E402
import dataclasses

if not hasattr(_SC, "properties"):
    # Dynamically add the field to the existing dataclass
    try:
        _SC = dataclasses.make_dataclass(
            "StrategyContext",
            fields=[("properties", dict, dataclasses.field(default_factory=dict))],
            bases=(_SC,),
        )
        import app.backtest.strategies.base as _base_mod
        _base_mod.StrategyContext = _SC
    except Exception:
        pass  # If patching fails, properties won't be available but nothing breaks


# ── High-level orchestrator ───────────────────────────────────────────────────

async def run_backtest(params: BacktestParams, progress_cb=None) -> BacktestResult:
    """End-to-end: load data, instantiate strategy, run, compute metrics."""
    t0 = time.perf_counter()

    if params.strategy not in STRATEGIES:
        raise ValueError(f"Unknown strategy '{params.strategy}'. Available: {list(STRATEGIES)}")

    if progress_cb:
        progress_cb("loading", 0, 1)

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

    if progress_cb:
        progress_cb("loaded", len(bars), len(bars))

    # Optionally load funding rates for crypto perpetuals
    funding_rates: list[tuple[int, float]] = []
    spread_bps = getattr(params, "spread_bps", 2.0)
    use_funding = getattr(params, "use_funding_rates", True)
    enable_impact = getattr(params, "enable_market_impact", True)
    latency_ms = getattr(params, "execution_latency_ms", 100)

    if use_funding and _asset_class(params.symbol) == "crypto":
        try:
            from .datasources import fetch_funding_rates
            import asyncio
            start_ts_ms = int(bars[0].timestamp.timestamp() * 1000)
            end_ts_ms = int(bars[-1].timestamp.timestamp() * 1000)
            rows = await fetch_funding_rates(
                symbol=params.symbol.replace("-", "").upper(),
                start_ts=start_ts_ms,
                end_ts=end_ts_ms,
            )
            funding_rates = [(r["ts"], r["value"]) for r in rows]
        except Exception as e:
            log.debug("Could not load funding rates: %s", e)

    strategy_cls = STRATEGIES[params.strategy]
    strategy = strategy_cls(**params.strategy_params)

    bt = Backtest(
        initial_capital=params.initial_capital,
        commission_pct=params.commission_pct,
        slippage_pct=params.slippage_pct,
        position_size_pct=params.position_size_pct,
        spread_bps=spread_bps,
        execution_latency_ms=latency_ms,
        enable_market_impact=enable_impact,
        use_funding_rates=use_funding,
        funding_rates=funding_rates,
    )
    trades, equity = bt.run(
        bars, strategy,
        symbol=params.symbol,
        interval=params.interval,
        progress_cb=progress_cb,
        funding_rates=funding_rates,
    )

    if progress_cb:
        progress_cb("metrics", 0, 1)

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
        bars, STRATEGIES["buy_and_hold"](), symbol=params.symbol, interval=params.interval,
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
    friction = bt.friction_breakdown()

    # Anomaly scan
    from .anomalies import AnomalyDetector
    anomaly_detector = AnomalyDetector()
    raw_anomalies = anomaly_detector.scan(bars)
    anomaly_dicts = [
        {
            "timestamp": a.timestamp,
            "type": a.type,
            "severity": a.severity,
            "price": a.price,
            "description": a.description,
            "suggested_action": a.suggested_action,
        }
        for a in raw_anomalies
    ]

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
        friction_breakdown=friction,
        anomalies=anomaly_dicts,
        short_trades=sum(1 for t in trades if t.side == "short"),
    )

    try:
        backtest_history.save(result)
    except Exception as e:
        log.warning("Failed to save backtest to history: %s", e)

    return result
