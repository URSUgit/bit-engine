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

import math
from typing import Optional

from .base import Strategy, StrategyContext
from ..features import FEATURE_NAMES, compute_features_at, compute_feature_series
from ..models import Bar, EntryAnalysis, EntryDataPoint, FeatureStats, Signal

_SERIES_LENGTH = 20   # bars of history captured per entry


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
        self.entry_analysis: Optional[EntryAnalysis] = None

    # ── oracle hook ───────────────────────────────────────────────────────────

    def prepare(self, bars: list[Bar], progress_cb=None) -> None:
        entry_bars: list[int] = []
        if progress_cb:
            progress_cb("signals", 0, len(bars))
        self._signals = self._compute_oracle_signals(bars, entry_bars)
        self.entry_analysis = self._build_entry_analysis(bars, entry_bars, progress_cb)

    def on_bar(self, ctx: StrategyContext) -> Signal:
        return self._signals.get(len(ctx.history) - 1, "hold")

    # ── core computation ──────────────────────────────────────────────────────

    def _compute_oracle_signals(
        self,
        bars: list[Bar],
        entry_bars_out: list[int],
    ) -> dict[int, Signal]:
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

                if high > peak:
                    peak = high

                if high >= target_price:
                    reached_target = True

                if reached_target:
                    tp_activated  = True
                    trailing_stop = max(
                        entry_price * (1.0 + min_profit),
                        peak        * (1.0 - trail),
                    )

                # Hard stop: oracle avoids entries that would stop out
                if not tp_activated and low <= stop_price:
                    reached_target = False
                    exit_signal_bar = None
                    break

                # Trailing stop hit — exit here
                if tp_activated and low <= trailing_stop:
                    exit_signal_bar = max(i + 1, k - 1)
                    break

            if reached_target and exit_signal_bar is not None:
                signals[i]               = "buy"
                signals[exit_signal_bar] = "close"
                entry_bars_out.append(i)
                i = exit_signal_bar + 2
            else:
                i += 1

        return signals

    # ── feature / time-series analysis ───────────────────────────────────────

    def _build_entry_analysis(
        self,
        bars: list[Bar],
        entry_bar_indices: list[int],
        progress_cb=None,
    ) -> EntryAnalysis:
        """Build EntryAnalysis from all oracle entry bar indices."""
        entries: list[EntryDataPoint] = []
        n_entries = len(entry_bar_indices)
        report_every = max(1, n_entries // 20)

        for entry_k, idx in enumerate(entry_bar_indices):
            if progress_cb and entry_k % report_every == 0:
                progress_cb("features", entry_k, max(1, n_entries))
            snap   = compute_features_at(bars, idx)
            series = compute_feature_series(bars, idx, length=_SERIES_LENGTH)
            entries.append(EntryDataPoint(
                bar_index   = idx,
                timestamp   = bars[idx].timestamp.isoformat(),
                entry_price = bars[idx].close,
                features    = {feat: snap.get(feat) for feat in FEATURE_NAMES},
                series      = {feat: series.get(feat, [None] * _SERIES_LENGTH) for feat in FEATURE_NAMES},
            ))

        if progress_cb:
            progress_cb("features", n_entries, max(1, n_entries))

        feature_stats = self._aggregate_stats(entries)

        return EntryAnalysis(
            entry_count   = len(entries),
            series_length = _SERIES_LENGTH,
            feature_names = FEATURE_NAMES,
            entries       = entries,
            feature_stats = feature_stats,
        )

    @staticmethod
    def _aggregate_stats(entries: list[EntryDataPoint]) -> list[FeatureStats]:
        stats: list[FeatureStats] = []
        if not entries:
            return stats

        all_features = entries[0].features.keys()
        for feat in all_features:
            vals = [
                e.features[feat]
                for e in entries
                if e.features.get(feat) is not None
            ]
            if not vals:
                stats.append(FeatureStats(
                    feature=feat, count=0,
                    mean=None, std=None, min=None, max=None,
                ))
                continue

            n    = len(vals)
            mean = sum(vals) / n
            std  = math.sqrt(sum((v - mean) ** 2 for v in vals) / n) if n > 1 else 0.0
            stats.append(FeatureStats(
                feature = feat,
                count   = n,
                mean    = round(mean, 6),
                std     = round(std, 6),
                min     = round(min(vals), 6),
                max     = round(max(vals), 6),
            ))

        return stats
