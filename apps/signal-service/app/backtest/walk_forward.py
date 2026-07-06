"""Walk-forward validation — splits history into N in/out-of-sample windows."""
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .engine import Backtest
    from .models import BacktestResult, Bar


@dataclass
class WalkForwardFold:
    fold: int
    train_start: str   # ISO date
    train_end: str
    test_start: str
    test_end: str
    in_sample_return: float
    out_sample_return: float
    in_sample_sharpe: float
    out_sample_sharpe: float
    in_sample_trades: int
    out_sample_trades: int


@dataclass
class WalkForwardResult:
    folds: list[WalkForwardFold]
    avg_in_sample_sharpe: float
    avg_out_sample_sharpe: float
    avg_in_sample_return: float
    avg_out_sample_return: float
    degradation_ratio: float   # out/in sharpe ratio. >0.7=good, 0.5-0.7=ok, <0.5=overfit
    consistency_score: float   # fraction of folds where out-of-sample was profitable
    overfitting_warning: bool  # True if degradation_ratio < 0.5


def run_walk_forward(
    bars: list,          # full bar list (list[Bar])
    engine_factory,      # callable() -> Backtest instance
    strategy_name: str,
    strategy_params: dict,
    n_splits: int = 5,
    train_pct: float = 0.7,
    anchored: bool = False,
    run_kwargs: dict | None = None,  # extra kwargs forwarded to engine.run()
) -> WalkForwardResult:
    """
    Splits bars into n_splits windows. Each window:
      - train_pct of bars = in-sample
      - (1-train_pct) of bars = out-of-sample

    If anchored=True, in-sample always starts at bar[0] (expanding window).
    If anchored=False, rolling window of fixed size.
    """
    from .strategies import STRATEGIES
    from .engine import _asset_class
    from .metrics import compute_metrics

    if run_kwargs is None:
        run_kwargs = {}

    n_bars = len(bars)
    if n_bars < 40:
        raise ValueError(f"Need at least 40 bars for walk-forward, got {n_bars}")
    if n_splits < 2 or n_splits > 10:
        raise ValueError(f"n_splits must be between 2 and 10, got {n_splits}")

    # Each fold covers an equal slice of the total bar range.
    # fold_size = total_bars / n_splits
    # Within each fold: first train_pct = in-sample, rest = out-of-sample.
    # For rolling (non-anchored): in-sample always has the same width.
    # For anchored: in-sample grows as we move forward.

    fold_size = n_bars // n_splits
    if fold_size < 10:
        raise ValueError(
            f"Too few bars per fold ({fold_size}). "
            f"Reduce n_splits or use more bars."
        )

    strategy_cls = STRATEGIES.get(strategy_name)
    if strategy_cls is None:
        raise ValueError(f"Unknown strategy '{strategy_name}'")

    interval = run_kwargs.get("interval", "1d")
    symbol = run_kwargs.get("symbol", "")
    asset_cls = _asset_class(symbol)

    folds: list[WalkForwardFold] = []

    for split_idx in range(n_splits):
        # Determine the test (out-of-sample) window for this fold.
        # The n_splits test windows cover the entire bar range without overlap.
        test_start_idx = split_idx * fold_size
        # Last fold gets any remaining bars
        if split_idx == n_splits - 1:
            test_end_idx = n_bars
        else:
            test_end_idx = (split_idx + 1) * fold_size

        # Determine in-sample window.
        # The OUT-of-sample window IS the test window.
        # in-sample = test_window * (train_pct / (1 - train_pct))
        out_size = test_end_idx - test_start_idx
        in_size = max(10, round(out_size * train_pct / (1 - train_pct)))

        if anchored:
            # In-sample always starts from bar[0]
            train_start_idx = 0
            train_end_idx = test_start_idx
            # If test_start_idx is 0 (first fold), we need to skip
            if train_end_idx < 10:
                # Not enough in-sample data; skip this fold
                continue
        else:
            # Rolling window: in-sample ends right before test window
            train_end_idx = test_start_idx
            train_start_idx = max(0, train_end_idx - in_size)
            if train_end_idx - train_start_idx < 10:
                # Not enough in-sample bars; skip
                continue

        train_bars = bars[train_start_idx:train_end_idx]
        test_bars = bars[test_start_idx:test_end_idx]

        if len(train_bars) < 5 or len(test_bars) < 5:
            continue

        # Run in-sample backtest
        try:
            in_engine = engine_factory()
            in_strategy = strategy_cls(**strategy_params)
            in_trades, in_equity = in_engine.run(
                train_bars,
                in_strategy,
                symbol=symbol,
                interval=interval,
            )
            in_metrics = compute_metrics(
                initial_capital=in_engine.initial_capital,
                equity=in_equity,
                trades=in_trades,
                interval=interval,
                asset_class=asset_cls,
            )
        except Exception:
            in_metrics = None
            in_trades = []

        # Run out-of-sample backtest (same strategy params — no re-fitting)
        try:
            out_engine = engine_factory()
            out_strategy = strategy_cls(**strategy_params)
            out_trades, out_equity = out_engine.run(
                test_bars,
                out_strategy,
                symbol=symbol,
                interval=interval,
            )
            out_metrics = compute_metrics(
                initial_capital=out_engine.initial_capital,
                equity=out_equity,
                trades=out_trades,
                interval=interval,
                asset_class=asset_cls,
            )
        except Exception:
            out_metrics = None
            out_trades = []

        # Extract ISO dates for fold boundaries
        def _iso(bar) -> str:
            return bar.timestamp.date().isoformat()

        folds.append(WalkForwardFold(
            fold=split_idx + 1,
            train_start=_iso(train_bars[0]),
            train_end=_iso(train_bars[-1]),
            test_start=_iso(test_bars[0]),
            test_end=_iso(test_bars[-1]),
            in_sample_return=round(in_metrics.total_return_pct, 2) if in_metrics else 0.0,
            out_sample_return=round(out_metrics.total_return_pct, 2) if out_metrics else 0.0,
            in_sample_sharpe=round(in_metrics.sharpe_ratio, 2) if in_metrics else 0.0,
            out_sample_sharpe=round(out_metrics.sharpe_ratio, 2) if out_metrics else 0.0,
            in_sample_trades=len(in_trades),
            out_sample_trades=len(out_trades),
        ))

    if not folds:
        raise ValueError("No valid folds produced. Check bar count and n_splits.")

    # Summary statistics
    avg_in_sharpe = sum(f.in_sample_sharpe for f in folds) / len(folds)
    avg_out_sharpe = sum(f.out_sample_sharpe for f in folds) / len(folds)
    avg_in_return = sum(f.in_sample_return for f in folds) / len(folds)
    avg_out_return = sum(f.out_sample_return for f in folds) / len(folds)

    # Degradation ratio: how much of in-sample Sharpe is preserved out-of-sample
    # Use absolute value of in-sample to avoid sign issues
    if abs(avg_in_sharpe) > 0.001:
        degradation_ratio = avg_out_sharpe / avg_in_sharpe
    else:
        # In-sample near zero; if out-sample is also near zero, ratio is ~1
        degradation_ratio = 1.0 if abs(avg_out_sharpe) < 0.5 else 0.0

    # Clamp to reasonable range
    degradation_ratio = max(-2.0, min(2.0, degradation_ratio))

    consistency_score = sum(1 for f in folds if f.out_sample_return > 0) / len(folds)

    return WalkForwardResult(
        folds=folds,
        avg_in_sample_sharpe=round(avg_in_sharpe, 3),
        avg_out_sample_sharpe=round(avg_out_sharpe, 3),
        avg_in_sample_return=round(avg_in_return, 2),
        avg_out_sample_return=round(avg_out_return, 2),
        degradation_ratio=round(degradation_ratio, 3),
        consistency_score=round(consistency_score, 3),
        overfitting_warning=degradation_ratio < 0.5,
    )
