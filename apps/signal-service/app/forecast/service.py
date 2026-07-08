"""Live forecast tracker and error-validation engine.

Samples prices ~1/s per tracked symbol, emits forecasts for every active
composition at the 5s/30s/1m/5m/10m horizons every EMIT_INTERVAL_S, and
resolves each forecast against the realized price when its horizon
expires — building rolling accuracy stats per (composition, horizon).

All state is in-memory and derived from ticks; the class is fully
deterministic when driven through record_tick/emit/resolve with explicit
timestamps, which is how the tests exercise it.
"""
from __future__ import annotations

import asyncio
import itertools
import json
import logging
import math
import time
from collections import deque
from dataclasses import asdict, dataclass

import httpx

from .strategies import Composition, CompositionMember, Tick

log = logging.getLogger(__name__)

HORIZONS_S: tuple[int, ...] = (5, 30, 60, 300, 600)
EMIT_INTERVAL_S = 5.0
TICK_MAXLEN = 2_400          # ~40 min of 1/s ticks
RESOLVED_MAXLEN = 5_000
# A forecast resolves against the tick nearest its due time; if the gap is
# larger than this, the forecast is voided (data outage) instead of scored.
RESOLVE_TOLERANCE_S = 10.0

BINANCE_PRICE_URL = "https://api.binance.com/api/v3/ticker/price"


@dataclass
class ForecastRecord:
    id: int
    symbol: str
    composition: str
    horizon_s: int
    created_ts: float
    due_ts: float
    base_price: float
    predicted_price: float
    realized_price: float | None = None
    resolved_ts: float | None = None
    abs_error: float | None = None
    pct_error: float | None = None       # signed: (pred - realized) / realized * 100
    direction_hit: bool | None = None    # None when no direction was called

    def to_dict(self) -> dict:
        return asdict(self)


class ForecastService:
    def __init__(self, symbols: list[str] | None = None) -> None:
        self.symbols: list[str] = list(symbols or ["BTCUSDT", "ETHUSDT"])
        self.ticks: dict[str, deque[Tick]] = {s: deque(maxlen=TICK_MAXLEN) for s in self.symbols}
        self.pending: deque[ForecastRecord] = deque()
        self.resolved: deque[ForecastRecord] = deque(maxlen=RESOLVED_MAXLEN)
        self.voided = 0
        self._ids = itertools.count(1)
        self._last_emit = 0.0
        self._running = False
        self.compositions: dict[str, Composition] = {}
        for comp in _default_compositions():
            self.compositions[comp.name] = comp

    # ── tracking ─────────────────────────────────────────────────────────

    def track(self, symbol: str) -> None:
        symbol = symbol.upper()
        if symbol not in self.ticks:
            self.symbols.append(symbol)
            self.ticks[symbol] = deque(maxlen=TICK_MAXLEN)

    def record_tick(self, symbol: str, price: float, ts: float | None = None) -> None:
        if price <= 0 or not math.isfinite(price):
            return
        self.ticks.setdefault(symbol, deque(maxlen=TICK_MAXLEN)).append(
            (ts if ts is not None else time.time(), float(price))
        )

    # ── compositions ─────────────────────────────────────────────────────

    def add_composition(self, name: str, members: list[dict], active: bool = True) -> Composition:
        comp = Composition(
            name=name,
            members=[
                CompositionMember(
                    strategy=m["strategy"],
                    weight=float(m.get("weight", 1.0)),
                    params=m.get("params") or {},
                )
                for m in members
            ],
            active=active,
        )
        self.compositions[name] = comp
        return comp

    def remove_composition(self, name: str) -> bool:
        return self.compositions.pop(name, None) is not None

    def set_active(self, name: str, active: bool) -> bool:
        comp = self.compositions.get(name)
        if comp is None:
            return False
        comp.active = active
        return True

    # ── forecast lifecycle ───────────────────────────────────────────────

    def emit(self, now: float | None = None) -> list[ForecastRecord]:
        """Emit one forecast per (symbol, active composition, horizon)."""
        now = now if now is not None else time.time()
        out: list[ForecastRecord] = []
        for symbol, ticks in self.ticks.items():
            if len(ticks) < 3:
                continue
            series = list(ticks)
            base = series[-1][1]
            for comp in self.compositions.values():
                if not comp.active:
                    continue
                for h in HORIZONS_S:
                    pred = comp.predict(series, h)
                    if pred is None or not math.isfinite(pred) or pred <= 0:
                        continue
                    rec = ForecastRecord(
                        id=next(self._ids),
                        symbol=symbol,
                        composition=comp.name,
                        horizon_s=h,
                        created_ts=now,
                        due_ts=now + h,
                        base_price=base,
                        predicted_price=pred,
                    )
                    self.pending.append(rec)
                    out.append(rec)
        return out

    def resolve(self, now: float | None = None) -> list[ForecastRecord]:
        """Score every pending forecast whose horizon has expired."""
        now = now if now is not None else time.time()
        done: list[ForecastRecord] = []
        still_pending: deque[ForecastRecord] = deque()
        for rec in self.pending:
            if rec.due_ts > now:
                still_pending.append(rec)
                continue
            realized = self._price_at(rec.symbol, rec.due_ts)
            if realized is None:
                if now - rec.due_ts < RESOLVE_TOLERANCE_S:
                    still_pending.append(rec)  # tick may still arrive
                else:
                    self.voided += 1
                continue
            rec.realized_price = realized
            rec.resolved_ts = now
            rec.abs_error = abs(rec.predicted_price - realized)
            rec.pct_error = (rec.predicted_price - realized) / realized * 100.0
            called = rec.predicted_price - rec.base_price
            moved = realized - rec.base_price
            rec.direction_hit = (called * moved > 0) if called != 0 else None
            self.resolved.append(rec)
            done.append(rec)
        self.pending = still_pending
        return done

    def _price_at(self, symbol: str, ts: float) -> float | None:
        """Tick price nearest ts, or None if the closest tick is too far."""
        ticks = self.ticks.get(symbol)
        if not ticks:
            return None
        best_t, best_p = min(ticks, key=lambda t: abs(t[0] - ts))
        if abs(best_t - ts) > RESOLVE_TOLERANCE_S:
            return None
        return best_p

    # ── error validation / accuracy ──────────────────────────────────────

    def accuracy(
        self,
        symbol: str | None = None,
        composition: str | None = None,
        horizon_s: int | None = None,
    ) -> list[dict]:
        """Rolling error stats grouped by (symbol, composition, horizon).

        Grouping by symbol matters: pooling BTC (~$60k) with ETH (~$3k)
        would make dollar-scale stats like MAE/RMSE meaningless.
        """
        groups: dict[tuple[str, str, int], list[ForecastRecord]] = {}
        for rec in self.resolved:
            if symbol and rec.symbol != symbol.upper():
                continue
            if composition and rec.composition != composition:
                continue
            if horizon_s and rec.horizon_s != horizon_s:
                continue
            groups.setdefault((rec.symbol, rec.composition, rec.horizon_s), []).append(rec)

        out = []
        for (sym, comp, h), recs in sorted(groups.items()):
            n = len(recs)
            abs_errs = [r.abs_error for r in recs]
            pct_errs = [r.pct_error for r in recs]
            calls = [r for r in recs if r.direction_hit is not None]
            hits = sum(1 for r in calls if r.direction_hit)
            out.append({
                "symbol": sym,
                "composition": comp,
                "horizon_s": h,
                "n": n,
                "mae": sum(abs_errs) / n,
                "rmse": math.sqrt(sum(e * e for e in abs_errs) / n),
                "mape_pct": sum(abs(e) for e in pct_errs) / n,
                "bias_pct": sum(pct_errs) / n,
                "direction_calls": len(calls),
                "direction_hit_rate": (hits / len(calls)) if calls else None,
            })
        return out

    def live(self, symbol: str, tick_tail: int = 600) -> dict:
        symbol = symbol.upper()
        ticks = list(self.ticks.get(symbol, ()))[-tick_tail:]
        pending = [r.to_dict() for r in self.pending if r.symbol == symbol]
        recent = [r.to_dict() for r in list(self.resolved)[-200:] if r.symbol == symbol]
        # Latest forecast per (composition, horizon) for the chart's cone
        latest: dict[str, dict] = {}
        for r in self.pending:
            if r.symbol == symbol:
                latest[f"{r.composition}:{r.horizon_s}"] = r.to_dict()
        return {
            "symbol": symbol,
            "ticks": [{"ts": t, "price": p} for t, p in ticks],
            "pending": pending,
            "latest": latest,
            "resolved_recent": recent,
            "horizons_s": list(HORIZONS_S),
            "voided": self.voided,
        }

    # ── live loop ────────────────────────────────────────────────────────

    async def _sample_prices(self, client: httpx.AsyncClient) -> None:
        params = {"symbols": json.dumps(self.symbols, separators=(",", ":"))}
        r = await client.get(BINANCE_PRICE_URL, params=params)
        r.raise_for_status()
        now = time.time()
        for item in r.json():
            try:
                self.record_tick(item["symbol"], float(item["price"]), now)
            except (KeyError, ValueError, TypeError):
                continue

    async def run(self, sample_interval_s: float = 1.0) -> None:
        """Sample → emit (every EMIT_INTERVAL_S) → resolve, forever."""
        self._running = True
        log.info("Forecast service started: symbols=%s horizons=%s", self.symbols, HORIZONS_S)
        async with httpx.AsyncClient(timeout=5) as client:
            while self._running:
                t0 = time.time()
                try:
                    await self._sample_prices(client)
                except Exception as exc:
                    log.warning("Forecast price sample failed: %r", exc)
                now = time.time()
                if now - self._last_emit >= EMIT_INTERVAL_S:
                    self._last_emit = now
                    self.emit(now)
                self.resolve(now)
                await asyncio.sleep(max(0.0, sample_interval_s - (time.time() - t0)))

    def stop(self) -> None:
        self._running = False


def _default_compositions() -> list[Composition]:
    return [
        Composition("baseline", [CompositionMember("last_value")]),
        Composition("trend", [
            CompositionMember("drift", weight=0.5),
            CompositionMember("linreg", weight=0.5),
        ]),
        Composition("ensemble", [
            CompositionMember("drift", weight=0.25),
            CompositionMember("linreg", weight=0.25),
            CompositionMember("ema_momentum", weight=0.25),
            CompositionMember("mean_reversion", weight=0.25),
        ]),
    ]


forecast_service = ForecastService()
