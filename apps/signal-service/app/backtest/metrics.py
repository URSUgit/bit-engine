"""Performance metrics computation — Sharpe, Sortino, drawdown, win rate, etc."""
from __future__ import annotations

import math
from datetime import datetime

from .models import Bar, EquityPoint, PerformanceMetrics, Trade


# Bar duration in seconds for every interval the data layer can serve
# (Binance: 1s–1M; Yahoo/Stooq/Kraken: 1h–1mo). Keys mirror data.py maps.
_INTERVAL_SECONDS = {
    "1s": 1, "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1_800,
    "1h": 3_600, "2h": 7_200, "4h": 14_400, "6h": 21_600, "8h": 28_800,
    "12h": 43_200, "1d": 86_400, "3d": 259_200, "1wk": 604_800,
    "1w": 604_800, "1mo": 2_629_800,
}

_STOCK_SESSION_SECONDS = 6.5 * 3_600  # NYSE/Nasdaq regular session


def _annualization_factor(interval: str, asset_class: str = "stock") -> float:
    """Trading periods per year for annualization.

    Crypto trades 24/7 (365 days/year); stocks ~252 sessions of 6.5 hours.
    """
    sec = _INTERVAL_SECONDS.get(interval)
    if sec is None:
        # Unknown interval: assume daily bars rather than mis-scaling wildly.
        return 365.0 if asset_class == "crypto" else 252.0
    if sec < 86_400:  # intraday
        if asset_class == "crypto":
            return 365.0 * 86_400 / sec
        return 252.0 * _STOCK_SESSION_SECONDS / sec
    days = sec / 86_400
    if asset_class == "crypto":
        return 365.0 / days
    # Stocks: 252 tradable daily bars; coarser bars follow the calendar
    # (1wk ~52.2, 1mo = 12).
    return 252.0 if days <= 1 else 365.25 / days


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


def _percentile(sorted_vals: list[float], pct: float) -> float:
    """Simple linear-interpolation percentile on a pre-sorted list."""
    n = len(sorted_vals)
    if n == 0:
        return 0.0
    idx = pct / 100 * (n - 1)
    lo = int(idx)
    hi = min(lo + 1, n - 1)
    return sorted_vals[lo] + (idx - lo) * (sorted_vals[hi] - sorted_vals[lo])


def _downsample(vals: list[float], target: int = 100) -> list[float]:
    """Evenly-spaced downsample to at most `target` points."""
    n = len(vals)
    if n <= target:
        return [round(v, 6) for v in vals]
    step = n / target
    return [round(vals[int(i * step)], 6) for i in range(target)]


def _compute_drawdown_series(equity_values: list[float]) -> list[float]:
    """Return non-negative drawdown at each point (fraction, not %)."""
    peak = equity_values[0] if equity_values else 1.0
    dd_series = []
    for v in equity_values:
        if v > peak:
            peak = v
        dd = abs((v - peak) / peak) if peak > 0 else 0.0
        dd_series.append(dd)
    return dd_series


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

    # ── Risk analytics from equity curve ─────────────────────────────────────
    # Filter out non-finite returns
    clean_returns = [r for r in returns if math.isfinite(r)]
    if len(clean_returns) >= 2:
        sorted_returns = sorted(clean_returns)
        var_95 = _percentile(sorted_returns, 5)    # 5th percentile (negative = loss)
        var_99 = _percentile(sorted_returns, 1)    # 1st percentile
        below_var95 = [r for r in sorted_returns if r <= var_95]
        cvar_95 = sum(below_var95) / len(below_var95) if below_var95 else var_95

        pos_excess = sum(max(r, 0.0) for r in clean_returns)
        neg_excess = sum(max(-r, 0.0) for r in clean_returns)
        omega = (pos_excess / neg_excess) if neg_excess > 0 else (999.0 if pos_excess > 0 else 0.0)

        dd_series = _compute_drawdown_series(equity_values)
        mean_sq_dd = sum(d * d for d in dd_series) / len(dd_series)
        ulcer = math.sqrt(mean_sq_dd) * 100   # express as %
        pain = (sum(dd_series) / len(dd_series)) * 100  # express as %

        daily_ret_downsampled = _downsample(clean_returns, 100)
    else:
        var_95 = var_99 = cvar_95 = 0.0
        omega = 0.0
        ulcer = pain = 0.0
        daily_ret_downsampled = []

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

        # Time in market & avg bars between trades
        total_bars = max(len(equity) - 1, 1)
        time_in_market = in_trade_bars / total_bars * 100

        # Avg bars between trades: gap from one exit to next entry
        # Use duration_bars proxy: total_bars - in_trade_bars spread over (n-1) gaps
        out_of_market_bars = max(total_bars - in_trade_bars, 0)
        avg_bars_between = out_of_market_bars / max(len(trades) - 1, 1) if len(trades) > 1 else 0.0
    else:
        win_rate = profit_factor = avg_pct = best = worst = avg_duration = exposure = 0.0
        wins, losses = [], []
        avg_win_pct = avg_loss_pct = avg_win_loss = sqn = recovery_factor = 0.0
        max_consec_wins = max_consec_losses = 0
        time_in_market = 0.0
        avg_bars_between = 0.0

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
        # Risk analytics
        var_95=round(var_95 * 100, 4),
        var_99=round(var_99 * 100, 4),
        cvar_95=round(cvar_95 * 100, 4),
        omega_ratio=round(min(omega, 999.0), 4),
        ulcer_index=round(ulcer, 4),
        pain_index=round(pain, 4),
        avg_bars_between_trades=round(avg_bars_between, 1),
        time_in_market_pct=round(time_in_market, 2),
        daily_returns=daily_ret_downsampled,
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
