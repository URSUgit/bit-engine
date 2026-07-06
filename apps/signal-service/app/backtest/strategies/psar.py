"""Parabolic SAR — trend-following with accelerating stop."""
from __future__ import annotations

from .base import Strategy, StrategyContext
from ..models import Signal


def _compute_psar(bars, af_start: float, af_step: float, af_max: float) -> list[tuple[float, bool]]:
    """
    Compute Parabolic SAR for all bars.

    Returns a list of (sar_value, is_uptrend) tuples, one per bar.
    """
    if len(bars) < 2:
        return [(bars[0].low, True)] if bars else []

    # Initialise: determine initial trend direction from first two bars
    results: list[tuple[float, bool]] = []
    if bars[1].close > bars[0].close:
        trend_up = True
        sar = bars[0].low
        ep  = bars[0].high
    else:
        trend_up = False
        sar = bars[0].high
        ep  = bars[0].low
    af = af_start

    results.append((sar, trend_up))

    for i in range(1, len(bars)):
        prev_bar = bars[i - 1]
        curr_bar = bars[i]

        if trend_up:
            # Adjust SAR: cannot be above the previous two lows
            new_sar = sar + af * (ep - sar)
            if i >= 2:
                new_sar = min(new_sar, bars[i - 1].low, bars[i - 2].low)
            else:
                new_sar = min(new_sar, bars[i - 1].low)

            if curr_bar.close < new_sar:
                # Flip to downtrend
                trend_up = False
                new_sar  = ep  # SAR flips to the extreme point
                ep       = curr_bar.low
                af       = af_start
            else:
                sar = new_sar
                if curr_bar.high > ep:
                    ep = curr_bar.high
                    af = min(af + af_step, af_max)
        else:
            # Downtrend: SAR cannot be below the previous two highs
            new_sar = sar + af * (ep - sar)
            if i >= 2:
                new_sar = max(new_sar, bars[i - 1].high, bars[i - 2].high)
            else:
                new_sar = max(new_sar, bars[i - 1].high)

            if curr_bar.close > new_sar:
                # Flip to uptrend
                trend_up = True
                new_sar  = ep
                ep       = curr_bar.high
                af       = af_start
            else:
                sar = new_sar
                if curr_bar.low < ep:
                    ep = curr_bar.low
                    af = min(af + af_step, af_max)

        results.append((new_sar, trend_up))

    return results


class ParabolicSARStrategy(Strategy):
    name = "psar"
    description = (
        "Parabolic SAR: a classic trend-following indicator that places an "
        "accelerating stop-and-reverse level below price in uptrends. "
        "Enters long when SAR flips below price, exits when SAR flips above."
    )
    params_schema = {
        "af_start":  {"type": "float", "default": 0.02, "min": 0.01, "max": 0.1,  "label": "AF Start",       "step": 0.01},
        "af_step":   {"type": "float", "default": 0.02, "min": 0.01, "max": 0.1,  "label": "AF Step",        "step": 0.01},
        "af_max":    {"type": "float", "default": 0.2,  "min": 0.1,  "max": 0.5,  "label": "AF Max",         "step": 0.05},
        "min_trend": {"type": "int",   "default": 3,    "min": 1,    "max": 10,   "label": "Min trend bars"},
    }

    def on_bar(self, ctx: StrategyContext) -> Signal:
        bars      = ctx.history
        af_start  = float(self.params["af_start"])
        af_step   = float(self.params["af_step"])
        af_max    = float(self.params["af_max"])
        min_trend = int(self.params["min_trend"])

        if len(bars) < 3:
            return "hold"

        psar_series = _compute_psar(bars, af_start, af_step, af_max)
        if len(psar_series) < min_trend + 1:
            return "hold"

        _, trend_now  = psar_series[-1]
        _, trend_prev = psar_series[-2]

        # Count consecutive uptrend bars at the tail of the series
        consecutive_up = 0
        for _, is_up in reversed(psar_series):
            if is_up:
                consecutive_up += 1
            else:
                break

        flipped_to_up   = trend_now and not trend_prev
        flipped_to_down = not trend_now and trend_prev

        if ctx.position is None:
            # BUY: SAR has been in uptrend for at least min_trend bars
            # (the flip happened min_trend or more bars ago, confirming the trend)
            if trend_now and consecutive_up == min_trend:
                return "buy"
        else:
            # EXIT: SAR flipped from UP to DOWN
            if flipped_to_down:
                return "close"

        return "hold"
