"""Real historical data loader sourced from public GitHub-hosted datasets.

Why this exists
---------------
Some execution environments (e.g. the hosted Claude Code sandbox) sit behind an
egress policy that blocks exchange and market-data hosts (Binance, Coinbase,
Kraken, Yahoo, Stooq, data.binance.vision, ...) — every one returns a 403 at the
proxy. In those environments the only reachable data hosts are package
registries and ``raw.githubusercontent.com``.

This module pulls **real** market data from reputable datasets committed to
public GitHub repositories and writes it into the same ``BarStorage`` DuckDB
cache the rest of the backtester reads from. The flagship source is the
**Coin Metrics community network dataset** (https://github.com/coinmetrics/data),
which publishes a daily reference-rate price series (and on-chain/volume columns)
for BTC, ETH and many other assets, going back to each asset's genesis.

Honest limitations
------------------
* **Granularity is daily.** Coin Metrics community data is one reference price
  per day. Real per-second / tick BTC only lives on the (blocked) exchange and
  dump hosts; it is not obtainable from a GitHub raw file. Use the Binance
  ``1s`` / ``aggTrades`` path in ``data.py`` / ``datasources.py`` when running
  somewhere those hosts are reachable.
* **OHLC is reconstructed from consecutive real closes**, not true intraday
  extremes. Crypto trades continuously, so each bar's ``open`` is set to the
  prior day's reference close and ``high``/``low`` to the max/min of that
  (open, close) pair. This uses only real data points and never fabricates a
  wider range than two real prices imply — but it understates true intraday
  range, so high/low-sensitive strategies (breakouts, ATR stops) will read
  conservative. ``close`` is the real Coin Metrics reference rate and is exact.
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timezone

import httpx

from .models import Bar
from .storage import bar_storage

log = logging.getLogger(__name__)

COINMETRICS_BASE = "https://raw.githubusercontent.com/coinmetrics/data/master/csv"

# Map the store symbol (what the UI/backtester queries) → Coin Metrics asset id.
# Coin Metrics community files exist for many assets; these are the ones the UI
# surfaces by default. Extend freely — the file name is "<asset>.csv".
COINMETRICS_ASSETS: dict[str, str] = {
    "BTCUSDT": "btc", "BTC-USD": "btc", "BTCUSD": "btc",
    "ETHUSDT": "eth", "ETH-USD": "eth", "ETHUSD": "eth",
    "LTCUSDT": "ltc", "BCHUSDT": "bch",
    "DOGEUSDT": "doge", "ADAUSDT": "ada",
    "XRPUSDT": "xrp", "LINKUSDT": "link",
    "DOTUSDT": "dot", "UNIUSDT": "uni", "AAVEUSDT": "aave",
    # Mapped but thin in the community tier (only recent rows) — guarded below.
    "SOLUSDT": "sol", "AVAXUSDT": "avax",
}

# Provenance label written to the bar cache for data from this module.
SOURCE_LABEL = "coinmetrics"

# Reject imports with too little real history so a near-empty community file
# (e.g. SOL/AVAX, which only carry a handful of recent rows) doesn't masquerade
# as a usable dataset.
_MIN_PRICED_ROWS = 60

# Preferred price columns, in priority order. ReferenceRateUSD is Coin Metrics'
# flagship cleaned reference price; PriceUSD is the legacy equivalent.
_PRICE_COLUMNS = ("ReferenceRateUSD", "PriceUSD")
_VOLUME_COLUMNS = ("volume_reported_spot_usd_1d",)


def supported_symbols() -> list[str]:
    return sorted(COINMETRICS_ASSETS.keys())


def _pick(row: dict[str, str], columns: tuple[str, ...]) -> float | None:
    for col in columns:
        raw = row.get(col)
        if raw:
            try:
                val = float(raw)
                if val > 0:
                    return val
            except ValueError:
                continue
    return None


def _parse_coinmetrics_csv(text: str) -> list[tuple[datetime, float, float]]:
    """Return [(date, close_price, volume_usd)] for rows with a real price."""
    out: list[tuple[datetime, float, float]] = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        date_raw = row.get("time")
        if not date_raw:
            continue
        price = _pick(row, _PRICE_COLUMNS)
        if price is None:
            continue
        try:
            dt = datetime.strptime(date_raw[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        volume = _pick(row, _VOLUME_COLUMNS) or 0.0
        out.append((dt, price, volume))
    return out


def _build_daily_bars(points: list[tuple[datetime, float, float]]) -> list[Bar]:
    """Reconstruct daily OHLCV bars from a real daily close series.

    open  = previous real close (continuous market) — first bar opens at its own close
    close = real Coin Metrics reference rate (exact)
    high  = max(open, close)   low = min(open, close)   — real, conservative range
    """
    bars: list[Bar] = []
    prev_close: float | None = None
    for dt, close, volume in points:
        open_ = prev_close if prev_close is not None else close
        high = max(open_, close)
        low = min(open_, close)
        bars.append(Bar(timestamp=dt, open=open_, high=high, low=low, close=close, volume=volume))
        prev_close = close
    return bars


def fetch_coinmetrics_asset(asset: str, *, timeout: float = 60.0) -> list[tuple[datetime, float, float]]:
    url = f"{COINMETRICS_BASE}/{asset}.csv"
    log.info("Fetching real Coin Metrics data: %s", url)
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        resp = client.get(url)
        resp.raise_for_status()
        return _parse_coinmetrics_csv(resp.text)


def load_real_daily(symbol: str, *, interval: str = "1d") -> dict:
    """Fetch real daily data for ``symbol`` and upsert it into the bar cache.

    Returns a summary dict. Raises ValueError for unsupported symbols and
    httpx errors for network/policy failures (so callers can surface a 403).
    """
    asset = COINMETRICS_ASSETS.get(symbol.upper())
    if asset is None:
        raise ValueError(
            f"No real GitHub dataset mapped for {symbol!r}. "
            f"Supported: {', '.join(supported_symbols())}"
        )
    points = fetch_coinmetrics_asset(asset)
    if len(points) < _MIN_PRICED_ROWS:
        raise ValueError(
            f"{symbol} ({asset}) has only {len(points)} priced rows in the Coin Metrics "
            f"community dataset (need ≥{_MIN_PRICED_ROWS}). Its history isn't available on "
            f"this free tier — use a symbol with deeper coverage."
        )
    bars = _build_daily_bars(points)
    written = bar_storage.upsert_bars(symbol.upper(), interval, bars, source=SOURCE_LABEL)
    return {
        "symbol": symbol.upper(),
        "asset": asset,
        "interval": interval,
        "source": "coinmetrics/data (GitHub)",
        "bars_written": written,
        "earliest": bars[0].timestamp.date().isoformat(),
        "latest": bars[-1].timestamp.date().isoformat(),
        "real": True,
        "granularity_note": "daily reference rate; OHLC reconstructed from consecutive real closes",
    }
