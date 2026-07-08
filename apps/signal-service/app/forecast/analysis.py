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


_EXPECTED_CACHE: dict[int, dict[int, float]] = {}


def benford_expected(position: int) -> dict[int, float]:
    """P(k-th significant digit = d). Position 1: d in 1..9; else d in 0..9.

    Exact generalized Benford up to position 5; from position 6 the exact
    distribution is uniform to within <1e-5, so uniform is returned.
    Results are cached — position 5 alone sums 90k log terms.
    """
    if position < 1 or position > 8:
        raise ValueError("digit position must be 1..8")
    cached = _EXPECTED_CACHE.get(position)
    if cached is not None:
        return cached
    if position == 1:
        probs = {d: math.log10(1 + 1 / d) for d in range(1, 10)}
    elif position >= 6:
        probs = {d: 0.1 for d in range(0, 10)}
    else:
        lo = 10 ** (position - 2)
        hi = 10 ** (position - 1)
        probs = {
            d: sum(math.log10(1 + 1 / (10 * j + d)) for j in range(lo, hi))
            for d in range(0, 10)
        }
    _EXPECTED_CACHE[position] = probs
    return probs


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


def kth_literal_digit(value: float, position: int) -> int | None:
    """The k-th digit of |value| as written (decimal point skipped), keeping
    leading zeros — so 0.53 reads 0,5,3 and 0 CAN lead. Non-classic Benford."""
    v = abs(value)
    if v == 0 or not math.isfinite(v):
        return None
    s = f"{v:.12f}".rstrip("0").rstrip(".")
    if not s:
        return None
    s = s.replace(".", "")
    if position > len(s):
        return None
    return int(s[position - 1])


def benford_test(values: list[float], position: int = 1, digit_mode: str = "significant") -> dict:
    """Observed vs expected k-th-digit distribution + chi-square verdict.

    digit_mode='significant' is classic Benford (0.53 reads 5,3 — a leading
    digit is 1..9). digit_mode='literal' reads the number as written
    (0.53 reads 0,5,3), so 0 is a real leading bin; the classic Benford
    expectation stays as the 1..9 reference, scaled to the share of samples
    that don't lead with 0, and chi-square is computed on that subset.
    """
    expected = benford_expected(position)
    counts = {d: 0 for d in range(0, 10)}
    n = 0
    extract = kth_literal_digit if digit_mode == "literal" else kth_significant_digit
    for v in values:
        d = extract(v, position)
        if d is not None and (d in expected or digit_mode == "literal"):
            counts[d] += 1
            n += 1
    # Chi-square runs on the bins that HAVE a Benford expectation.
    n_ref = sum(counts[d] for d in expected)
    scale = (n_ref / n) if n else 0.0  # reference share of all samples
    rows = []
    chi2 = 0.0
    for d, p in expected.items():
        obs = counts[d]
        exp = n_ref * p
        if n_ref > 0 and exp > 0:
            chi2 += (obs - exp) ** 2 / exp
        rows.append({
            "digit": d,
            "observed": obs,
            "observed_pct": (obs / n * 100) if n else 0.0,
            "expected_pct": p * 100 * (scale if digit_mode == "literal" else 1.0),
        })
    df = len(expected) - 1
    crit = _CHI2_CRIT[df]
    if position == 1:
        # Digit 0: a real bin in literal mode (0.53 leads with 0); shown at
        # zero for observation in classic mode. Never part of chi-square —
        # Benford has no expectation for a leading 0.
        rows.insert(0, {
            "digit": 0,
            "observed": counts[0],
            "observed_pct": (counts[0] / n * 100) if n else 0.0,
            "expected_pct": 0.0,
        })
    return {
        "position": position,
        "digit_mode": digit_mode,
        "n": n,
        "rows": rows,
        "chi2": chi2,
        "chi2_critical_p05": crit,
        # Only meaningful with a decent sample; below that, say so.
        "conforms": (chi2 <= crit) if n_ref >= 100 else None,
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
    digit_mode: str = "significant",
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
        res = benford_test(_window_values(w, source), position, digit_mode)
        tried.append({"window_s": window_s, "n": res["n"], "chi2": round(res["chi2"], 2)})
        if res["n"] < min_n:
            continue
        if best is None or res["chi2"] < best["chi2"]:
            best = res
            best["window_s"] = window_s
    if best is None:  # not enough data anywhere: fall back to everything
        best = benford_test(_window_values(ticks, source), position, digit_mode)
        best["window_s"] = 0
    best["windows_tried"] = tried
    return best


# Sample-count windows tried by the historical Benford backtest.
BENFORD_BT_WINDOWS: tuple[int, ...] = (100, 250, 500, 1000, 2000, 5000)


def benford_backtest(
    closes: list[float],
    positions: tuple[int, ...] = (1, 2, 3, 4, 5, 6),
    sources: tuple[str, ...] = ("delta", "price"),
    digit_mode: str = "significant",
) -> dict:
    """Scan historical closes for the configuration that best fits Benford.

    Tries every (source, digit position, trailing sample-count window)
    combination, ranks by chi-square (n >= 100), and returns the winner's
    full digit distribution plus a rolling chi-square series so the UI can
    chart how conformity evolved across the history.
    """
    series: dict[str, list[float]] = {}
    if "delta" in sources:
        series["delta"] = [b - a for a, b in zip(closes, closes[1:]) if b != a]
    if "price" in sources:
        series["price"] = list(closes)

    results: list[dict] = []
    for source, values in series.items():
        for position in positions:
            for win in BENFORD_BT_WINDOWS:
                if win > len(values):
                    continue
                res = benford_test(values[-win:], position, digit_mode)
                results.append({
                    "source": source,
                    "position": position,
                    "window_n": win,
                    "n": res["n"],
                    "chi2": round(res["chi2"], 2),
                    "chi2_critical_p05": res["chi2_critical_p05"],
                    "conforms": res["conforms"],
                })
    scored = [r for r in results if r["n"] >= 100]
    scored.sort(key=lambda r: r["chi2"])
    results.sort(key=lambda r: (r["chi2"] if r["n"] >= 100 else float("inf")))

    best_detail = None
    rolling: list[dict] = []
    if scored:
        b = scored[0]
        values = series[b["source"]]
        best_detail = benford_test(values[-b["window_n"]:], b["position"], digit_mode)
        best_detail.update({k: b[k] for k in ("source", "position", "window_n")})
        # Rolling chi2 across history: same window, stepped so the series
        # stays a manageable size.
        win = b["window_n"]
        step = max(1, (len(values) - win) // 60) if len(values) > win else 1
        for end in range(win, len(values) + 1, step):
            r = benford_test(values[end - win: end], b["position"], digit_mode)
            rolling.append({"index": end, "chi2": round(r["chi2"], 2)})

    return {
        "combos_tested": len(results),
        "results": results[:20],
        "best": best_detail,
        "rolling": rolling,
        "n_closes": len(closes),
    }


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
