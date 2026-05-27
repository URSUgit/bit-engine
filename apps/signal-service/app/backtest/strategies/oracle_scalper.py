"""
Oracle Scalper — theoretical upper-bound scalping strategy with perfect price foresight.

Uses the full OHLCV series (look-ahead via prepare()) to:
  • Only enter trades that are GUARANTEED to reach min_profit_pct.
  • Apply a trailing take-profit once the profit target is hit.
  • Trailing stop locks in the minimum profit floor, then trails 2% below the peak.
  • Hard stop-loss exits before target is reached (prevents loss, but oracle skips these).

This is NOT a tradeable strategy. It represents the theoretical performance ceiling
for a scalping approach on a given symbol and period — useful as a benchmark.

Trailing stop rules:
  - Before +min_profit% is reached: hard stop at entry − hard_stop_pct (skipped by oracle)
  - Once peak ≥ entry × (1 + min_profit%):
      trailing_stop = max(entry × (1 + min_profit%), peak × (1 − trail_pct%))
  - Profit floor ensures the stop never drops below the initial profit target.
"""
from __future__ import annotations

from .base import Strategy, StrategyContext
from ..models import Bar, Signal


class OracleScalperStrategy(Strategy):
    name = "oracle_scalper"
    description = (
        "⚡ Ideal Oracle Scalper — perfect foresight, theoretical maximum. "
        "Only enters scalps guaranteed to profit ≥ min_profit_pct. "
        "Trailing stop activates at the profit target and trails trail_pct% below the peak."
    )
    params_schema = {
        "min_profit_pct": {
            "type": "float", "default": 2.0, "min": 0.5, "max": 20.0,
        },
        "trail_pct": {
            "type": "float", "default": 2.0, "min": 0.5, "max": 10.0,
        },
        "hard_stop_pct": {
            "type": "float", "default": 2.0, "min": 0.5, "max": 20.0,
        },
    }

    def __init__(self, **params) -> None:
        super().__init__(**params)
        self._signals: dict[int, Signal] = {}

    # ── oracle hook ───────────────────────────────────────────────────────────

    def prepare(self, bars: list[Bar]) -> None:
        self._signals = self._compute_oracle_signals(bars)

    def on_bar(self, ctx: StrategyContext) -> Signal:
        return self._signals.get(len(ctx.history) - 1, "hold")

    # ── core computation ──────────────────────────────────────────────────────

    def _compute_oracle_signals(self, bars: list[Bar]) -> dict[int, Signal]:
        """
        Scan all bars with full look-ahead and precompute buy/close signals.

        Signal timeline (engine fills at NEXT bar's open):
          • signals[i] = "buy"   → engine fills at bars[i+1].open
          • signals[j] = "close" → engine fills at bars[j+1].open
        """
        n = len(bars)
        signals: dict[int, Signal] = {}

        min_profit = float(self.params["min_profit_pct"]) / 100
        trail      = float(self.params["trail_pct"])       / 100
        hard_stop  = float(self.params["hard_stop_pct"])   / 100

        i = 0  # signal bar index (buy signal emitted here)

        while i < n - 2:
            # Approximate entry price: next bar's open (matches engine execution)
            entry_price = bars[i + 1].open
            if entry_price <= 0:
                i += 1
                continue

            target_price = entry_price * (1.0 + min_profit)
            stop_price   = entry_price * (1.0 - hard_stop)

            # ── Simulate forward using future OHLCV ───────────────────────────
            peak             = entry_price
            trailing_stop    = 0.0
            tp_activated     = False
            reached_target   = False
            exit_signal_bar  = n - 2   # fallback: last valid signal bar

            for k in range(i + 1, n):
                bar  = bars[k]
                high = bar.high
                low  = bar.low

                # Update running peak
                if high > peak:
                    peak = high

                # Check if minimum profit target reached
                if high >= target_price:
                    reached_target = True

                # Compute trailing stop once target is activated
                if reached_target:
                    tp_activated  = True
                    # Floor at min_profit, trails 2% below peak above that
                    trailing_stop = max(
                        entry_price * (1.0 + min_profit),  # minimum profit floor
                        peak        * (1.0 - trail),        # 2% below running peak
                    )

                # Hard stop: exit for loss before target — oracle avoids this entry
                if not tp_activated and low <= stop_price:
                    reached_target = False
                    exit_signal_bar = None  # sentinel: do not trade
                    break

                # Trailing stop hit — exit here
                if tp_activated and low <= trailing_stop:
                    # Signal "close" one bar before so engine fills at this bar's open
                    exit_signal_bar = max(i + 1, k - 1)
                    break

            # Only place the trade if it reached the profit target
            if reached_target and exit_signal_bar is not None:
                signals[i]              = "buy"
                signals[exit_signal_bar] = "close"
                # Advance past the exit fill bar to avoid overlapping positions
                i = exit_signal_bar + 2
            else:
                i += 1

        return signals
