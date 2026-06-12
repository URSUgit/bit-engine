"""Monte Carlo simulation — randomize trade sequence to show outcome distribution."""
from __future__ import annotations
import numpy as np
from dataclasses import dataclass


@dataclass
class MonteCarloResult:
    n_simulations: int
    initial_capital: float
    # Percentile final equity values
    p5_equity: float
    p25_equity: float
    p50_equity: float
    p75_equity: float
    p95_equity: float
    # Max drawdown distribution
    p5_max_dd: float
    p50_max_dd: float
    p95_max_dd: float
    # Risk metrics
    ruin_probability: float    # fraction of sims hitting < initial_capital * 0.5
    positive_probability: float  # fraction of sims ending above initial_capital
    # For chart: equity bands at each "trade step"
    # List of {step, p5, p25, p50, p75, p95}
    equity_band: list[dict]
    # Summary
    expected_final_equity: float
    std_final_equity: float


def run_monte_carlo(
    trades: list[dict],    # list of trade dicts with 'pnl' key (from BacktestResult.trades)
    initial_capital: float,
    n_simulations: int = 1000,
    band_steps: int = 50,  # number of points in equity_band (downsample for performance)
) -> MonteCarloResult:
    """
    For each simulation:
    1. Randomly shuffle the trade order
    2. Replay trades sequentially on initial_capital
    3. Track equity and max drawdown

    trades: each dict must have 'pnl' (USD profit/loss for that trade)
    """
    if not trades:
        # Return trivial result for no trades
        return MonteCarloResult(
            n_simulations=0, initial_capital=initial_capital,
            p5_equity=initial_capital, p25_equity=initial_capital,
            p50_equity=initial_capital, p75_equity=initial_capital,
            p95_equity=initial_capital,
            p5_max_dd=0, p50_max_dd=0, p95_max_dd=0,
            ruin_probability=0, positive_probability=1,
            equity_band=[], expected_final_equity=initial_capital,
            std_final_equity=0,
        )

    pnls = np.array([t['pnl'] for t in trades], dtype=float)
    n_trades = len(pnls)

    # Run n_simulations shuffles
    # Shape: (n_simulations, n_trades)
    simulated = np.array([np.random.permutation(pnls) for _ in range(n_simulations)])

    # Equity curves: cumsum of pnl + initial_capital
    equity_paths = initial_capital + np.cumsum(simulated, axis=1)  # (n_sims, n_trades)

    # Final equities
    final_equities = equity_paths[:, -1]

    # Max drawdown per simulation
    # For each sim: rolling max equity, then max(peak - current) / peak
    def max_drawdown(eq_path):
        peak = np.maximum.accumulate(eq_path)
        dd = (peak - eq_path) / np.where(peak > 0, peak, 1)
        return dd.max() * 100  # percentage

    max_dds = np.array([max_drawdown(equity_paths[i]) for i in range(n_simulations)])

    # Equity band (downsample to band_steps points)
    if n_trades > band_steps:
        indices = np.linspace(0, n_trades - 1, band_steps, dtype=int)
        band_paths = equity_paths[:, indices]
    else:
        indices = np.arange(n_trades)
        band_paths = equity_paths

    equity_band = []
    for j, step_idx in enumerate(indices):
        col = band_paths[:, j]
        equity_band.append({
            "step": int(step_idx),
            "p5": float(np.percentile(col, 5)),
            "p25": float(np.percentile(col, 25)),
            "p50": float(np.percentile(col, 50)),
            "p75": float(np.percentile(col, 75)),
            "p95": float(np.percentile(col, 95)),
        })

    return MonteCarloResult(
        n_simulations=n_simulations,
        initial_capital=initial_capital,
        p5_equity=float(np.percentile(final_equities, 5)),
        p25_equity=float(np.percentile(final_equities, 25)),
        p50_equity=float(np.percentile(final_equities, 50)),
        p75_equity=float(np.percentile(final_equities, 75)),
        p95_equity=float(np.percentile(final_equities, 95)),
        p5_max_dd=float(np.percentile(max_dds, 5)),
        p50_max_dd=float(np.percentile(max_dds, 50)),
        p95_max_dd=float(np.percentile(max_dds, 95)),
        ruin_probability=float(np.mean(final_equities < initial_capital * 0.5)),
        positive_probability=float(np.mean(final_equities > initial_capital)),
        equity_band=equity_band,
        expected_final_equity=float(np.mean(final_equities)),
        std_final_equity=float(np.std(final_equities)),
    )
