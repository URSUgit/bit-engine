"""Performance metrics computation — Sharpe, Sortino, drawdown, win rate, etc."""
from __future__ import annotations

import math
from datetime import datetime

from .models import Bar, EquityPoint, PerformanceMetrics, Trade


def _annualization_factor(interval: str, asset_class: str = "stock") -> float:
    """Trading periods per year for annualization."""
    if interval == "1d":
        # Crypto trades 365 days, stocks ~252
        return 365.0 if asset_class == "crypto" else 252.0
    if interval == "1h":
        return 24 * 365 if asset_class == "crypto" else 252 * 6.5
    if interval == "1wk":
        return 52.0
    return 252.0


def compute_returns(equity: list[float]) -> list[float]:
    if len(equity) < 2:
        return []
    return [(equity[i] - equity[i - 1]) / equity[i - 1] for i in range(1, len(equity)) if equity[i - 1] > 0]


def sharpe_ratio(returns: list[float], periods_per_year: float, rf: float = 0.0) -> float:
    if len(returns) < 2:
        return 0.0
    mean = sum(returns) / len(returns)
    var = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
    std = math.sqrt(var)
    if std == 0:
        return 0.0
    excess_per_period = mean - (rf / periods_per_year)
    return (excess_per_period / std) * math.sqrt(periods_per_year)


def sortino_ratio(returns: list[float], periods_per_year: float, rf: float = 0.0) -> float:
    if len(returns) < 2:
        return 0.0
    target = rf / periods_per_year
    downside = [min(0, r - target) ** 2 for r in returns]
    downside_var = sum(downside) / len(returns)
    downside_std = math.sqrt(downside_var)
    if downside_std == 0:
        return 0.0
    mean = sum(returns) / len(returns)
    return ((mean - target) / downside_std) * math.sqrt(periods_per_year)


def max_drawdown(equity: list[float]) -> tuple[float, int, int]:
    """Returns (max_drawdown_pct, peak_index, trough_index)."""
    if not equity:
        return 0.0, 0, 0
    peak = equity[0]
    peak_idx = 0
    max_dd = 0.0
    dd_peak_idx = 0
    dd_trough_idx = 0
    for i, value in enumerate(equity):
        if value > peak:
            peak = value
            peak_idx = i
        dd = (value - peak) / peak if peak > 0 else 0
        if dd < max_dd:
            max_dd = dd
            dd_peak_idx = peak_idx
            dd_trough_idx = i
    return abs(max_dd) * 100, dd_peak_idx, dd_trough_idx


def build_equity_curve(equity: list[tuple[datetime, float]]) -> list[EquityPoint]:
    """Annotate equity series with running drawdown."""
    if not equity:
        return []
    out: list[EquityPoint] = []
    peak = equity[0][1]
    for ts, eq in equity:
        if eq > peak:
            peak = eq
        dd_pct = abs((eq - peak) / peak) * 100 if peak > 0 else 0.0
        out.append(EquityPoint(t=int(ts.timestamp()), equity=round(eq, 2), drawdown_pct=round(dd_pct, 2)))
    return out


def compute_metrics(
    initial_capital: float,
    equity: list[tuple[datetime, float]],
    trades: list[Trade],
    interval: str,
    asset_class: str = "stock",
) -> PerformanceMetrics:
    """Compile full performance metric suite from an equity curve + trade log."""
    if not equity:
        return _empty_metrics(initial_capital)

    final_equity = equity[-1][1]
    equity_values = [e[1] for e in equity]
    returns = compute_returns(equity_values)
    ppy = _annualization_factor(interval, asset_class)

    total_return_pct = (final_equity - initial_capital) / initial_capital * 100

    # CAGR
    start_ts = equity[0][0].timestamp()
    end_ts = equity[-1][0].timestamp()
    years = max((end_ts - start_ts) / (365.25 * 86400), 1e-6)
    if final_equity > 0 and initial_capital > 0:
        cagr_pct = ((final_equity / initial_capital) ** (1 / years) - 1) * 100
    else:
        cagr_pct = -100.0

    max_dd_pct, _, _ = max_drawdown(equity_values)
    sharpe = sharpe_ratio(returns, ppy)
    sortino = sortino_ratio(returns, ppy)
    calmar = (cagr_pct / max_dd_pct) if max_dd_pct > 0 else 0.0

    # Trade-level
    if trades:
        wins = [t for t in trades if t.is_win]
        losses = [t for t in trades if not t.is_win]
        win_rate = len(wins) / len(trades) * 100
        gross_wins = sum(t.pnl for t in wins)
        gross_losses = abs(sum(t.pnl for t in losses))
        profit_factor = (gross_wins / gross_losses) if gross_losses > 0 else (math.inf if gross_wins > 0 else 0)
        if math.isinf(profit_factor):
            profit_factor = 999.99
        avg_pct = sum(t.pnl_pct for t in trades) / len(trades)
        best = max((t.pnl_pct for t in trades), default=0.0)
        worst = min((t.pnl_pct for t in trades), default=0.0)
        avg_duration = sum(t.duration_bars for t in trades) / len(trades)
        # exposure: fraction of bars spent in a position
        in_trade_bars = sum(t.duration_bars for t in trades)
        exposure = in_trade_bars / max(len(equity) - 1, 1) * 100

        # Extended metrics
        avg_win_pct  = sum(t.pnl_pct for t in wins)   / len(wins)   if wins   else 0.0
        avg_loss_pct = sum(t.pnl_pct for t in losses) / len(losses) if losses else 0.0
        avg_win_loss = abs(avg_win_pct / avg_loss_pct) if avg_loss_pct != 0 else 0.0

        pnl_pcts = [t.pnl_pct for t in trades]
        n = len(pnl_pcts)
        mean_pnl = avg_pct
        if n >= 2:
            var_pnl = sum((p - mean_pnl) ** 2 for p in pnl_pcts) / (n - 1)
            std_pnl = math.sqrt(var_pnl)
            sqn = (math.sqrt(n) * mean_pnl / std_pnl) if std_pnl > 0 else 0.0
        else:
            sqn = 0.0

        recovery_factor = (total_return_pct / max_dd_pct) if max_dd_pct > 0 else 0.0

        # Consecutive wins / losses
        max_consec_wins = max_consec_losses = 0
        cur_w = cur_l = 0
        for t in trades:
            if t.is_win:
                cur_w += 1; cur_l = 0
                max_consec_wins = max(max_consec_wins, cur_w)
            else:
                cur_l += 1; cur_w = 0
                max_consec_losses = max(max_consec_losses, cur_l)
    else:
        win_rate = profit_factor = avg_pct = best = worst = avg_duration = exposure = 0.0
        wins, losses = [], []
        avg_win_pct = avg_loss_pct = avg_win_loss = sqn = recovery_factor = 0.0
        max_consec_wins = max_consec_losses = 0

    return PerformanceMetrics(
        total_return_pct=round(total_return_pct, 2),
        cagr_pct=round(cagr_pct, 2),
        sharpe_ratio=round(sharpe, 2),
        sortino_ratio=round(sortino, 2),
        max_drawdown_pct=round(max_dd_pct, 2),
        calmar_ratio=round(calmar, 2),
        win_rate_pct=round(win_rate, 2),
        profit_factor=round(profit_factor, 2),
        total_trades=len(trades),
        winning_trades=len(wins),
        losing_trades=len(losses),
        avg_trade_pnl_pct=round(avg_pct, 2),
        best_trade_pct=round(best, 2),
        worst_trade_pct=round(worst, 2),
        avg_trade_duration_bars=round(avg_duration, 1),
        exposure_pct=round(min(exposure, 100), 2),
        final_equity=round(final_equity, 2),
        initial_capital=round(initial_capital, 2),
        recovery_factor=round(recovery_factor, 2),
        sqn=round(sqn, 2),
        avg_win_pct=round(avg_win_pct, 2),
        avg_loss_pct=round(avg_loss_pct, 2),
        avg_win_loss_ratio=round(avg_win_loss, 2),
        max_consecutive_wins=max_consec_wins,
        max_consecutive_losses=max_consec_losses,
    )


def _empty_metrics(initial_capital: float) -> PerformanceMetrics:
    return PerformanceMetrics(
        total_return_pct=0, cagr_pct=0, sharpe_ratio=0, sortino_ratio=0,
        max_drawdown_pct=0, calmar_ratio=0, win_rate_pct=0, profit_factor=0,
        total_trades=0, winning_trades=0, losing_trades=0,
        avg_trade_pnl_pct=0, best_trade_pct=0, worst_trade_pct=0,
        avg_trade_duration_bars=0, exposure_pct=0,
        final_equity=initial_capital, initial_capital=initial_capital,
        recovery_factor=0, sqn=0, avg_win_pct=0, avg_loss_pct=0,
        avg_win_loss_ratio=0, max_consecutive_wins=0, max_consecutive_losses=0,
    )
