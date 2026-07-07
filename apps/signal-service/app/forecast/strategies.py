"""Composable price-forecast strategies.

Each strategy maps a recent tick series to a point-price prediction at
`now + horizon_s`. Ticks are (unix_ts, price) tuples in ascending time
order. Strategies return None when they don't have enough data yet.

Compositions combine strategies as a weighted average — the user-facing
"compose your own forecaster" primitive.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Sequence

Tick = tuple[float, float]  # (unix_ts, price)


def _window(ticks: Sequence[Tick], lookback_s: float) -> list[Tick]:
    if not ticks:
        return []
    cutoff = ticks[-1][0] - lookback_s
    return [t for t in ticks if t[0] >= cutoff]


class ForecastStrategy:
    name: str = "base"
    description: str = ""
    params_schema: dict = {}

    def __init__(self, **params) -> None:
        self.params = {k: v["default"] for k, v in self.params_schema.items()}
        for k, v in params.items():
            if k in self.params_schema:
                self.params[k] = v

    def predict(self, ticks: Sequence[Tick], horizon_s: float) -> float | None:
        raise NotImplementedError


class LastValueStrategy(ForecastStrategy):
    """Random-walk baseline: tomorrow looks like right now."""

    name = "last_value"
    description = "Baseline: predicts the current price (random walk). Every other strategy must beat this to be worth its weight."
    params_schema: dict = {}

    def predict(self, ticks: Sequence[Tick], horizon_s: float) -> float | None:
        return ticks[-1][1] if ticks else None


class DriftStrategy(ForecastStrategy):
    name = "drift"
    description = "Extrapolates the mean log-return per second over the lookback window."
    params_schema = {
        "lookback_s": {"type": "int", "default": 120, "min": 10, "max": 3600, "label": "Lookback (s)"},
    }

    def predict(self, ticks: Sequence[Tick], horizon_s: float) -> float | None:
        w = _window(ticks, float(self.params["lookback_s"]))
        if len(w) < 3:
            return None
        t0, p0 = w[0]
        t1, p1 = w[-1]
        if t1 <= t0 or p0 <= 0 or p1 <= 0:
            return None
        mu = math.log(p1 / p0) / (t1 - t0)  # log-return per second
        return p1 * math.exp(mu * horizon_s)


class LinRegStrategy(ForecastStrategy):
    name = "linreg"
    description = "Least-squares line through the lookback window, extrapolated to the horizon."
    params_schema = {
        "lookback_s": {"type": "int", "default": 90, "min": 10, "max": 3600, "label": "Lookback (s)"},
    }

    def predict(self, ticks: Sequence[Tick], horizon_s: float) -> float | None:
        w = _window(ticks, float(self.params["lookback_s"]))
        if len(w) < 3:
            return None
        now = w[-1][0]
        xs = [t - now for t, _ in w]  # seconds relative to now (<= 0)
        ys = [p for _, p in w]
        n = len(w)
        mx = sum(xs) / n
        my = sum(ys) / n
        var = sum((x - mx) ** 2 for x in xs)
        if var <= 0:
            return None
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / var
        intercept = my - slope * mx  # value of the fit at x=0 (now)
        return intercept + slope * horizon_s


class EmaMomentumStrategy(ForecastStrategy):
    name = "ema_momentum"
    description = "Trend velocity from the lag between a fast and slow time-constant EMA, extrapolated to the horizon."
    params_schema = {
        "fast_s": {"type": "int", "default": 20, "min": 2, "max": 600, "label": "Fast EMA tau (s)"},
        "slow_s": {"type": "int", "default": 60, "min": 5, "max": 1800, "label": "Slow EMA tau (s)"},
    }

    def predict(self, ticks: Sequence[Tick], horizon_s: float) -> float | None:
        fast_tau = float(self.params["fast_s"])
        slow_tau = float(self.params["slow_s"])
        if slow_tau <= fast_tau:
            return None
        w = _window(ticks, slow_tau * 3)
        if len(w) < 3:
            return None
        # Irregular-interval EMA: alpha = 1 - exp(-dt/tau)
        ema_f = ema_s = w[0][1]
        prev_t = w[0][0]
        for t, p in w[1:]:
            dt = max(t - prev_t, 1e-9)
            ema_f += (1 - math.exp(-dt / fast_tau)) * (p - ema_f)
            ema_s += (1 - math.exp(-dt / slow_tau)) * (p - ema_s)
            prev_t = t
        # For a linear trend v, an EMA with time constant tau lags by v*tau,
        # so v = (ema_fast - ema_slow) / (slow_tau - fast_tau).
        v = (ema_f - ema_s) / (slow_tau - fast_tau)
        return w[-1][1] + v * horizon_s


class MeanReversionStrategy(ForecastStrategy):
    name = "mean_reversion"
    description = "Price decays toward the lookback mean with a configurable half-life."
    params_schema = {
        "lookback_s": {"type": "int", "default": 300, "min": 30, "max": 3600, "label": "Lookback (s)"},
        "half_life_s": {"type": "int", "default": 120, "min": 5, "max": 3600, "label": "Reversion half-life (s)"},
    }

    def predict(self, ticks: Sequence[Tick], horizon_s: float) -> float | None:
        w = _window(ticks, float(self.params["lookback_s"]))
        if len(w) < 3:
            return None
        mean = sum(p for _, p in w) / len(w)
        last = w[-1][1]
        frac = 1 - 0.5 ** (horizon_s / float(self.params["half_life_s"]))
        return last + frac * (mean - last)


FORECAST_STRATEGIES: dict[str, type[ForecastStrategy]] = {
    cls.name: cls
    for cls in (
        LastValueStrategy,
        DriftStrategy,
        LinRegStrategy,
        EmaMomentumStrategy,
        MeanReversionStrategy,
    )
}


def strategy_catalog() -> list[dict]:
    return [
        {"name": cls.name, "description": cls.description, "params_schema": cls.params_schema}
        for cls in FORECAST_STRATEGIES.values()
    ]


@dataclass
class CompositionMember:
    strategy: str
    weight: float = 1.0
    params: dict = field(default_factory=dict)


@dataclass
class Composition:
    """A user-composed forecaster: weighted average of member strategies."""

    name: str
    members: list[CompositionMember]
    active: bool = True

    def __post_init__(self) -> None:
        if not self.members:
            raise ValueError("Composition needs at least one member strategy")
        self._instances: list[tuple[ForecastStrategy, float]] = []
        for m in self.members:
            cls = FORECAST_STRATEGIES.get(m.strategy)
            if cls is None:
                raise ValueError(f"Unknown forecast strategy '{m.strategy}'")
            if m.weight <= 0:
                raise ValueError(f"Member '{m.strategy}' needs a positive weight")
            self._instances.append((cls(**m.params), m.weight))

    def predict(self, ticks: Sequence[Tick], horizon_s: float) -> float | None:
        """Weighted average over members that produced a prediction."""
        acc = 0.0
        total_w = 0.0
        for inst, w in self._instances:
            p = inst.predict(ticks, horizon_s)
            if p is not None and math.isfinite(p) and p > 0:
                acc += p * w
                total_w += w
        if total_w <= 0:
            return None
        return acc / total_w

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "active": self.active,
            "members": [
                {"strategy": m.strategy, "weight": m.weight, "params": m.params}
                for m in self.members
            ],
        }
