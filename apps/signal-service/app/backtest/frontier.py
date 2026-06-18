"""Markowitz Efficient Frontier: find the max-Sharpe portfolio allocation across strategies."""
from __future__ import annotations

from dataclasses import dataclass
import numpy as np


@dataclass
class FrontierPoint:
    volatility: float        # annualized std dev
    expected_return: float   # annualized return
    sharpe: float
    weights: list[float]     # one weight per strategy


@dataclass
class FrontierResult:
    strategies: list[str]
    frontier_points: list[FrontierPoint]   # 50 points along the efficient frontier
    optimal_point: FrontierPoint           # max-Sharpe point
    min_vol_point: FrontierPoint           # minimum volatility point
    equal_weight_point: FrontierPoint      # 1/N benchmark
    annual_rf_rate: float = 0.05           # risk-free rate used


def _portfolio_stats_from_daily(
    weights: np.ndarray,
    mean_daily: np.ndarray,
    cov_daily: np.ndarray,
    days_per_year: float,
    rf_rate: float,
) -> tuple[float, float, float]:
    """Return (annualized_vol, annualized_return, sharpe) using daily scaling."""
    ann_return = float(np.dot(weights, mean_daily)) * days_per_year
    daily_var = float(weights @ cov_daily @ weights)
    ann_vol = float(np.sqrt(max(daily_var * days_per_year, 0.0)))
    sharpe = (ann_return - rf_rate) / ann_vol if ann_vol > 1e-12 else 0.0
    return ann_vol, ann_return, sharpe


def _compute_frontier_scipy(
    strategy_names: list[str],
    return_matrix: np.ndarray,  # shape (n_days, n_strategies)
    rf_rate: float,
    n_points: int = 50,
) -> FrontierResult:
    from scipy.optimize import minimize

    n = return_matrix.shape[1]
    days_per_year = 252.0

    mean_daily = return_matrix.mean(axis=0)
    if n > 1:
        cov_daily = np.cov(return_matrix.T, ddof=1)
    else:
        cov_daily = np.array([[float(np.var(return_matrix[:, 0], ddof=1))]])
    if cov_daily.ndim == 0:
        cov_daily = cov_daily.reshape(1, 1)

    # Regularise: add tiny diagonal to avoid singular matrix
    cov_daily = cov_daily + np.eye(n) * 1e-10

    constraints_base = [{"type": "eq", "fun": lambda w: float(np.sum(w)) - 1.0}]
    bounds = [(0.0, 1.0)] * n
    w0 = np.full(n, 1.0 / n)

    # ── Min-vol point ──────────────────────────────────────────────────────────
    def _port_var(w: np.ndarray) -> float:
        return float(w @ cov_daily @ w)

    res_min = minimize(
        _port_var,
        w0,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints_base,
        options={"ftol": 1e-9, "maxiter": 500},
    )
    w_min = np.clip(res_min.x, 0.0, 1.0)
    w_min /= w_min.sum()
    min_vol_stats = _portfolio_stats_from_daily(w_min, mean_daily, cov_daily, days_per_year, rf_rate)
    min_vol_point = FrontierPoint(
        volatility=min_vol_stats[0],
        expected_return=min_vol_stats[1],
        sharpe=min_vol_stats[2],
        weights=w_min.tolist(),
    )

    # ── Return range for frontier ──────────────────────────────────────────────
    ann_returns_per_asset = mean_daily * days_per_year
    r_min = float(ann_returns_per_asset.min())
    r_max = float(ann_returns_per_asset.max())

    # Clamp to sensible bounds
    r_min = max(r_min, -2.0)
    r_max = min(r_max, 10.0)

    if abs(r_max - r_min) < 1e-8:
        r_min -= 0.01
        r_max += 0.01

    target_returns = np.linspace(r_min, r_max, n_points)

    frontier_points: list[FrontierPoint] = []
    rng = np.random.default_rng(42)
    for target in target_returns:
        constraints = constraints_base + [
            {
                "type": "eq",
                "fun": lambda w, t=target: float(np.dot(w, mean_daily)) * days_per_year - t,
            }
        ]
        res = minimize(
            _port_var,
            w0,
            method="SLSQP",
            bounds=bounds,
            constraints=constraints,
            options={"ftol": 1e-9, "maxiter": 500},
        )
        if not res.success:
            w_try = rng.dirichlet(np.ones(n))
            res = minimize(
                _port_var,
                w_try,
                method="SLSQP",
                bounds=bounds,
                constraints=constraints,
                options={"ftol": 1e-8, "maxiter": 300},
            )
        w = np.clip(res.x, 0.0, 1.0)
        w_sum = w.sum()
        w = w / w_sum if w_sum > 1e-10 else w0.copy()
        vol, ret, sharpe = _portfolio_stats_from_daily(w, mean_daily, cov_daily, days_per_year, rf_rate)
        frontier_points.append(FrontierPoint(
            volatility=vol,
            expected_return=ret,
            sharpe=sharpe,
            weights=w.tolist(),
        ))

    # ── Max-Sharpe point via direct optimisation ───────────────────────────────
    def _neg_sharpe(w: np.ndarray) -> float:
        ann_ret = float(np.dot(w, mean_daily)) * days_per_year
        ann_vol_sq = float(w @ cov_daily @ w) * days_per_year
        if ann_vol_sq <= 0:
            return 0.0
        ann_vol = float(np.sqrt(ann_vol_sq))
        return -(ann_ret - rf_rate) / ann_vol

    res_sharpe = minimize(
        _neg_sharpe,
        w0,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints_base,
        options={"ftol": 1e-9, "maxiter": 500},
    )
    w_sharpe = np.clip(res_sharpe.x, 0.0, 1.0)
    w_sharpe /= w_sharpe.sum()
    vs, rs, ss = _portfolio_stats_from_daily(w_sharpe, mean_daily, cov_daily, days_per_year, rf_rate)
    direct_best = FrontierPoint(volatility=vs, expected_return=rs, sharpe=ss, weights=w_sharpe.tolist())

    # Compare with best from frontier sweep
    frontier_best = max(frontier_points, key=lambda p: p.sharpe)
    optimal_point = direct_best if direct_best.sharpe > frontier_best.sharpe else frontier_best

    # ── Equal-weight point ─────────────────────────────────────────────────────
    w_eq = np.full(n, 1.0 / n)
    ve, re, se = _portfolio_stats_from_daily(w_eq, mean_daily, cov_daily, days_per_year, rf_rate)
    equal_weight_point = FrontierPoint(
        volatility=ve,
        expected_return=re,
        sharpe=se,
        weights=w_eq.tolist(),
    )

    return FrontierResult(
        strategies=strategy_names,
        frontier_points=frontier_points,
        optimal_point=optimal_point,
        min_vol_point=min_vol_point,
        equal_weight_point=equal_weight_point,
        annual_rf_rate=rf_rate,
    )


def _compute_frontier_montecarlo(
    strategy_names: list[str],
    return_matrix: np.ndarray,
    rf_rate: float,
    n_simulations: int = 2000,
) -> FrontierResult:
    """Fallback: random weight vectors when scipy is unavailable."""
    n = return_matrix.shape[1]
    days_per_year = 252.0
    mean_daily = return_matrix.mean(axis=0)
    if n > 1:
        cov_daily = np.cov(return_matrix.T, ddof=1)
    else:
        cov_daily = np.array([[float(np.var(return_matrix[:, 0], ddof=1))]])
    if cov_daily.ndim == 0:
        cov_daily = cov_daily.reshape(1, 1)
    cov_daily = cov_daily + np.eye(n) * 1e-10

    rng = np.random.default_rng(42)
    all_points: list[FrontierPoint] = []

    for _ in range(n_simulations):
        w = rng.dirichlet(np.ones(n))
        ann_ret = float(np.dot(w, mean_daily)) * days_per_year
        ann_vol_sq = float(w @ cov_daily @ w) * days_per_year
        ann_vol = float(np.sqrt(max(ann_vol_sq, 0.0)))
        sharpe = (ann_ret - rf_rate) / ann_vol if ann_vol > 1e-12 else 0.0
        all_points.append(FrontierPoint(
            volatility=ann_vol,
            expected_return=ann_ret,
            sharpe=sharpe,
            weights=w.tolist(),
        ))

    # Sort by return and pick 50 spread-out points as the "frontier"
    sorted_by_ret = sorted(all_points, key=lambda p: p.expected_return)
    step = max(1, len(sorted_by_ret) // 50)
    frontier_points = sorted_by_ret[::step][:50]
    if len(frontier_points) < 50:
        frontier_points = sorted_by_ret[:50]

    optimal_point = max(all_points, key=lambda p: p.sharpe)
    min_vol_point = min(all_points, key=lambda p: p.volatility)

    w_eq = np.full(n, 1.0 / n)
    ann_ret_eq = float(np.dot(w_eq, mean_daily)) * days_per_year
    ann_vol_sq_eq = float(w_eq @ cov_daily @ w_eq) * days_per_year
    ann_vol_eq = float(np.sqrt(max(ann_vol_sq_eq, 0.0)))
    sharpe_eq = (ann_ret_eq - rf_rate) / ann_vol_eq if ann_vol_eq > 1e-12 else 0.0
    equal_weight_point = FrontierPoint(
        volatility=ann_vol_eq,
        expected_return=ann_ret_eq,
        sharpe=sharpe_eq,
        weights=w_eq.tolist(),
    )

    return FrontierResult(
        strategies=strategy_names,
        frontier_points=frontier_points,
        optimal_point=optimal_point,
        min_vol_point=min_vol_point,
        equal_weight_point=equal_weight_point,
        annual_rf_rate=rf_rate,
    )


def compute_frontier(
    strategy_names: list[str],
    equity_curves: list[list[float]],
    rf_rate: float = 0.05,
) -> FrontierResult:
    """
    Compute the Markowitz efficient frontier for the given strategies.

    Parameters
    ----------
    strategy_names:
        List of strategy identifier strings (length N).
    equity_curves:
        List of N equity-curve value lists (one per strategy). If curves differ
        in length the shortest is used (truncated from the end).
    rf_rate:
        Annual risk-free rate used for Sharpe calculation.

    Returns
    -------
    FrontierResult
    """
    n = len(strategy_names)
    if n < 2:
        raise ValueError(
            f"At least 2 strategies are required to compute the efficient frontier, got {n}."
        )
    if len(equity_curves) != n:
        raise ValueError(
            f"len(equity_curves)={len(equity_curves)} != len(strategy_names)={n}"
        )

    # Align curves to shortest length
    min_len = min(len(ec) for ec in equity_curves)
    aligned: list[list[float]] = [ec[:min_len] for ec in equity_curves]

    # Compute daily log returns
    return_cols: list[np.ndarray] = []
    for ec in aligned:
        arr = np.array(ec, dtype=float)
        # Guard against zeros / negatives
        arr = np.where(arr <= 0, 1e-8, arr)
        lr = np.diff(np.log(arr))
        return_cols.append(lr)

    ret_len = min(len(r) for r in return_cols)
    return_matrix = np.column_stack([r[:ret_len] for r in return_cols])  # (T, N)

    if return_matrix.shape[0] < 5:
        raise ValueError(
            "Equity curves are too short to compute meaningful statistics (need >5 bars)."
        )

    try:
        return _compute_frontier_scipy(strategy_names, return_matrix, rf_rate)
    except ImportError:
        return _compute_frontier_montecarlo(strategy_names, return_matrix, rf_rate)
    except Exception:
        # Fall back to Monte Carlo if scipy optimisation fails for any reason
        return _compute_frontier_montecarlo(strategy_names, return_matrix, rf_rate)
