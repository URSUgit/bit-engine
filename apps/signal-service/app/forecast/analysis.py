"""Forecast-stream analysis: rule-based narrator and Benford's-law digit test.

The narrator turns the live forecast state into plain-language commentary —
deterministic and instant (no LLM round-trip), so it can refresh continuously
beside the chart.

The Benford panel tests the distribution of the k-th significant digit of
tick-to-tick price moves against the (generalized) Benford expectation.
Price *changes* span orders of magnitude, which is what Benford's law needs;
raw price levels cluster around the current price and would trivially fail.
"""
from __future__ import annotations

import math
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from .service import ForecastService

# ── Benford ──────────────────────────────────────────────────────────────────

# Chi-square critical values at p=0.05 for df=8 (first digit) and df=9.
_CHI2_CRIT = {8: 15.507, 9: 16.919}


def benford_expected(position: int) -> dict[int, float]:
    """P(k-th significant digit = d). Position 1: d in 1..9; else d in 0..9."""
    if position < 1 or position > 4:
        raise ValueError("digit position must be 1..4")
    if position == 1:
        return {d: math.log10(1 + 1 / d) for d in range(1, 10)}
    lo = 10 ** (position - 2)
    hi = 10 ** (position - 1)
    return {
        d: sum(math.log10(1 + 1 / (10 * j + d)) for j in range(lo, hi))
        for d in range(0, 10)
    }


def kth_significant_digit(value: float, position: int) -> int | None:
    """The k-th significant digit of |value|, or None if it doesn't exist."""
    v = abs(value)
    if v == 0 or not math.isfinite(v):
        return None
    digits = f"{v:.15e}"  # d.ddddddddddddddde±xx — significant digits in order
    sig = digits[0] + digits[2:17]  # drop the decimal point
    sig = sig.rstrip("0")  # trailing zeros beyond precision aren't significant
    if position > len(sig):
        return None
    return int(sig[position - 1])


def benford_test(values: list[float], position: int = 1) -> dict:
    """Observed vs expected k-th-digit distribution + chi-square verdict."""
    expected = benford_expected(position)
    counts = {d: 0 for d in expected}
    n = 0
    for v in values:
        d = kth_significant_digit(v, position)
        if d is not None and d in counts:
            counts[d] += 1
            n += 1
    rows = []
    chi2 = 0.0
    for d, p in expected.items():
        obs = counts[d]
        exp = n * p
        if n > 0 and exp > 0:
            chi2 += (obs - exp) ** 2 / exp
        rows.append({
            "digit": d,
            "observed": obs,
            "observed_pct": (obs / n * 100) if n else 0.0,
            "expected_pct": p * 100,
        })
    df = len(expected) - 1
    crit = _CHI2_CRIT[df]
    return {
        "position": position,
        "n": n,
        "rows": rows,
        "chi2": chi2,
        "chi2_critical_p05": crit,
        # Only meaningful with a decent sample; below that, say so.
        "conforms": (chi2 <= crit) if n >= 100 else None,
    }


# Candidate sample windows (seconds) for auto-fit, shortest to longest.
BENFORD_WINDOWS_S: tuple[int, ...] = (60, 120, 300, 600, 900, 1200, 1800, 2400)


def _window_values(w: list[tuple[float, float]], source: str) -> list[float]:
    if source == "price":
        return [p for _, p in w]
    return [p2 - p1 for (_, p1), (_, p2) in zip(w, w[1:]) if p2 != p1]


def benford_best_window(
    ticks: list[tuple[float, float]],
    position: int = 1,
    min_n: int = 100,
    source: str = "delta",
) -> dict:
    """Try several trailing window lengths and keep the one whose tick-move
    digit distribution best fits Benford (lowest chi-square with n >= min_n).

    Returns the winning benford_test result, annotated with `window_s` and a
    `windows_tried` summary so the UI can show why this length was chosen.
    """
    tried: list[dict] = []
    best: dict | None = None
    last_t = ticks[-1][0] if ticks else 0.0
    for window_s in BENFORD_WINDOWS_S:
        cutoff = last_t - window_s
        w = [(t, p) for t, p in ticks if t >= cutoff]
        res = benford_test(_window_values(w, source), position)
        tried.append({"window_s": window_s, "n": res["n"], "chi2": round(res["chi2"], 2)})
        if res["n"] < min_n:
            continue
        if best is None or res["chi2"] < best["chi2"]:
            best = res
            best["window_s"] = window_s
    if best is None:  # not enough data anywhere: fall back to everything
        best = benford_test(_window_values(ticks, source), position)
        best["window_s"] = 0
    best["windows_tried"] = tried
    return best


# ── Narrator ─────────────────────────────────────────────────────────────────

def _pct(a: float, b: float) -> float:
    return (a - b) / b * 100 if b else 0.0


def narrate(svc: "ForecastService", symbol: str) -> list[dict]:
    """Plain-language commentary on the live forecast state. Rule-based."""
    symbol = symbol.upper()
    now = time.time()
    msgs: list[dict] = []

    def say(kind: str, text: str) -> None:
        msgs.append({"ts": now, "kind": kind, "text": text})

    ticks = list(svc.ticks.get(symbol, ()))
    if len(ticks) < 10:
        say("status", f"Warming up — only {len(ticks)} ticks for {symbol} so far.")
        return msgs

    last_t, last_p = ticks[-1]

    # Price action over 1m / 5m
    for window, label in ((60, "minute"), (300, "5 minutes")):
        past = [p for t, p in ticks if t <= last_t - window]
        if past:
            ref = past[-1]
            move = _pct(last_p, ref)
            verb = "up" if move > 0 else "down" if move < 0 else "flat"
            say(
                "price",
                f"{symbol} is {verb} {abs(move):.3f}% over the last {label} "
                f"({ref:,.2f} → {last_p:,.2f}).",
            )

    # Volatility: mean absolute 1s move, this 5m vs prior 5m
    def mean_abs_move(lo: float, hi: float) -> float | None:
        rets = [
            abs(_pct(p2, p1))
            for (t1, p1), (t2, p2) in zip(ticks, ticks[1:])
            if lo <= t2 <= hi and p1
        ]
        return sum(rets) / len(rets) if len(rets) >= 30 else None

    recent = mean_abs_move(last_t - 300, last_t)
    prior = mean_abs_move(last_t - 600, last_t - 300)
    if recent is not None and prior is not None and prior > 0:
        ratio = recent / prior
        if ratio > 1.5:
            say("volatility", f"Volatility is picking up: 1s moves average {recent:.4f}% vs {prior:.4f}% in the prior 5 minutes.")
        elif ratio < 0.67:
            say("volatility", f"Volatility is cooling: 1s moves average {recent:.4f}% vs {prior:.4f}% in the prior 5 minutes.")

    # Who's winning: best composition per horizon by MAPE (needs samples)
    acc = svc.accuracy(symbol=symbol)
    by_h: dict[int, list[dict]] = {}
    for row in acc:
        if row["n"] >= 20:
            by_h.setdefault(row["horizon_s"], []).append(row)
    for h in sorted(by_h):
        rows = sorted(by_h[h], key=lambda r: r["mape_pct"])
        best = rows[0]
        hit = best["direction_hit_rate"]
        hit_txt = f", direction {hit:.0%} of {best['direction_calls']} calls" if hit is not None else ""
        label = {5: "5s", 30: "30s", 60: "1m", 300: "5m", 600: "10m"}.get(h, f"{h}s")
        say(
            "leader",
            f"Most accurate {label} forecaster: {best['composition']} "
            f"(MAPE {best['mape_pct']:.4f}%{hit_txt}, n={best['n']}).",
        )
        # Is anyone actually beating the random-walk baseline?
        base = next((r for r in rows if r["composition"] == "baseline"), None)
        if base and best["composition"] != "baseline":
            edge = _pct(base["mape_pct"], best["mape_pct"])
            if edge > 5:
                say("leader", f"{best['composition']} beats the baseline by {edge:.0f}% on {label} MAPE — a real edge so far.")
        elif base and best["composition"] == "baseline":
            say("leader", f"Nothing beats the random-walk baseline at {label} yet — the market is efficient at this horizon so far.")

    # Recent resolutions: notable hit/miss streaks
    recent_recs = [r for r in list(svc.resolved)[-60:] if r.symbol == symbol and r.direction_hit is not None]
    if recent_recs:
        hits = sum(1 for r in recent_recs if r.direction_hit)
        say("event", f"Last {len(recent_recs)} scored direction calls: {hits} hits, {len(recent_recs) - hits} misses.")
        worst = max(recent_recs, key=lambda r: abs(r.pct_error or 0))
        if worst.pct_error is not None and abs(worst.pct_error) > 0.05:
            say(
                "event",
                f"Biggest recent miss: {worst.composition} predicted {worst.predicted_price:,.2f} "
                f"at {'+' if worst.horizon_s else ''}{worst.horizon_s}s but price hit {worst.realized_price:,.2f} "
                f"({worst.pct_error:+.3f}% error).",
            )

    # Outlook: what the ensemble expects next
    outlook = [
        r for r in svc.pending
        if r.symbol == symbol and r.composition != "baseline" and r.due_ts > now
    ]
    if outlook:
        longest = max(outlook, key=lambda r: r.due_ts)
        move = _pct(longest.predicted_price, last_p)
        mins = max(1, round((longest.due_ts - now) / 60))
        say(
            "outlook",
            f"{longest.composition} expects {symbol} at {longest.predicted_price:,.2f} "
            f"in ~{mins} min ({move:+.3f}% from here).",
        )

    return msgs
