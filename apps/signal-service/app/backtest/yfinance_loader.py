"""Real historical data via yfinance — free, no API key required."""
from __future__ import annotations
import logging
from datetime import datetime, timezone, timedelta

log = logging.getLogger(__name__)

# Map our interval strings to yfinance period strings
_YF_INTERVAL_MAP = {
    "1d":  "1d",
    "4h":  "1h",   # yfinance max for 4h is 1h; we'll resample (or just use 1h)
    "1h":  "1h",
    "1w":  "1wk",
    "1wk": "1wk",
}

# Symbols that yfinance understands — map our names to yfinance tickers
_YF_TICKER_MAP = {
    # Crypto (via yfinance crypto tickers)
    "BTCUSDT": "BTC-USD",
    "ETHUSDT": "ETH-USD",
    "SOLUSDT": "SOL-USD",
    "BNBUSDT": "BNB-USD",
    # Stocks
    "AAPL": "AAPL",
    "MSFT": "MSFT",
    "GOOGL": "GOOGL",
    "AMZN": "AMZN",
    "NVDA": "NVDA",
    "TSLA": "TSLA",
    "META": "META",
    "SPY": "SPY",   # S&P 500 ETF
    "QQQ": "QQQ",   # Nasdaq ETF
    "GLD": "GLD",   # Gold ETF
    # Forex (via yfinance forex pairs)
    "EURUSD": "EURUSD=X",
    "GBPUSD": "GBPUSD=X",
    "USDJPY": "JPY=X",
}


def fetch_bars(
    symbol: str,
    interval: str,
    start_date: str,  # ISO "YYYY-MM-DD"
    end_date: str,    # ISO "YYYY-MM-DD"
) -> list[dict]:
    """
    Fetch OHLCV bars from yfinance. Returns list of dicts:
    {"timestamp": int_unix, "open": float, "high": float, "low": float, "close": float, "volume": float}

    Returns empty list if symbol not supported or download fails.
    """
    import yfinance as yf
    import pandas as pd

    ticker = _YF_TICKER_MAP.get(symbol)
    if ticker is None:
        # Try the symbol directly (may work for stocks)
        ticker = symbol

    yf_interval = _YF_INTERVAL_MAP.get(interval, "1d")

    try:
        data = yf.download(
            ticker,
            start=start_date,
            end=end_date,
            interval=yf_interval,
            auto_adjust=True,
            progress=False,
            show_errors=False,
        )
    except Exception as e:
        log.warning(f"yfinance download failed for {symbol}: {e}")
        return []

    if data is None or data.empty:
        log.warning(f"yfinance returned no data for {symbol} ({ticker}) {interval} {start_date}to{end_date}")
        return []

    bars = []
    for ts, row in data.iterrows():
        try:
            # Handle both single-level and MultiIndex columns
            if hasattr(ts, 'timestamp'):
                unix_ts = int(ts.timestamp())
            else:
                unix_ts = int(pd.Timestamp(ts).timestamp())

            def _get(col):
                if col in data.columns:
                    val = row[col]
                    # Handle MultiIndex columns — row[col] may be a Series for multi-ticker downloads
                    if hasattr(val, 'iloc'):
                        val = val.iloc[0]
                    return float(val)
                # MultiIndex: (col, ticker)
                for c in data.columns:
                    if (isinstance(c, tuple) and c[0] == col) or c == col:
                        val = row[c]
                        if hasattr(val, 'iloc'):
                            val = val.iloc[0]
                        return float(val)
                return None

            o = _get("Open")
            h = _get("High")
            l = _get("Low")
            c = _get("Close")
            v = _get("Volume")

            if any(x is None or (isinstance(x, float) and x != x) for x in [o, h, l, c]):
                continue

            bars.append({
                "timestamp": unix_ts,
                "open": o,
                "high": h,
                "low": l,
                "close": c,
                "volume": v if v is not None else 0.0,
            })
        except Exception:
            continue

    log.info(f"yfinance: fetched {len(bars)} bars for {symbol} ({ticker}) {interval}")
    return bars


def supported_symbols() -> list[dict]:
    """Return list of symbols that can be fetched via yfinance."""
    return [
        {"symbol": sym, "yf_ticker": ticker, "category": _category(sym)}
        for sym, ticker in _YF_TICKER_MAP.items()
    ]


def _category(symbol: str) -> str:
    crypto = {"BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"}
    forex = {"EURUSD", "GBPUSD", "USDJPY"}
    if symbol in crypto:
        return "crypto"
    if symbol in forex:
        return "forex"
    return "stocks"
