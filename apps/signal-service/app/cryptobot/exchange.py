"""Binance spot execution client.

Real money only moves when TWO independent gates both agree:
  1. The bot's own mode is "live" (per-bot, set via the mode endpoint —
     never the default; see CryptoBot / BotConfig).
  2. The server-wide BINANCE_LIVE_TRADING env var is "true" (server operator
     opt-in — mirrors app/polymarket/clob.py's DRY_RUN flag).
A single flipped switch — a UI click or a stray env var — can never place a
real order alone. Whenever either gate is off, orders are simulated locally
using the live public price, no API key required and no request sent to
Binance's signed trading endpoints.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import time
import uuid
from typing import Literal
from urllib.parse import urlencode

import httpx

log = logging.getLogger(__name__)

BINANCE_BASE = "https://api.binance.com/api/v3"
BINANCE_API_KEY = os.getenv("BINANCE_API_KEY", "")
BINANCE_API_SECRET = os.getenv("BINANCE_API_SECRET", "")
LIVE_TRADING = os.getenv("BINANCE_LIVE_TRADING", "false").lower() == "true"


def _signed_params(params: dict) -> dict:
    signed = {**params, "timestamp": int(time.time() * 1000), "recvWindow": 5000}
    query = urlencode(signed)
    sig = hmac.new(BINANCE_API_SECRET.encode(), query.encode(), hashlib.sha256).hexdigest()
    signed["signature"] = sig
    return signed


async def get_price(symbol: str) -> float:
    """Public spot ticker price — no auth required."""
    async with httpx.AsyncClient(timeout=5) as client:
        r = await client.get(f"{BINANCE_BASE}/ticker/price", params={"symbol": symbol})
        r.raise_for_status()
        return float(r.json()["price"])


async def place_market_order(
    symbol: str,
    side: Literal["BUY", "SELL"],
    *,
    live: bool,
    quote_usd: float | None = None,
    quantity: float | None = None,
) -> dict:
    """Execute a spot market order.

    `live` is the bot's own mode flag; combined with the server-wide
    LIVE_TRADING switch above, both must be true for a real order to reach
    Binance. Otherwise this simulates a fill at the current public price.
    """
    price = await get_price(symbol)
    if not (live and LIVE_TRADING):
        qty = quantity if quantity is not None else (quote_usd / price if price else 0.0)
        quote = quote_usd if quote_usd is not None else qty * price
        return {
            "order_id": f"dry-{uuid.uuid4().hex[:12]}",
            "status": "dry_run",
            "symbol": symbol,
            "side": side,
            "price": price,
            "qty": qty,
            "quote_usd": quote,
            "dry_run": True,
        }

    if not (BINANCE_API_KEY and BINANCE_API_SECRET):
        raise RuntimeError(
            "BINANCE_LIVE_TRADING is enabled but BINANCE_API_KEY / "
            "BINANCE_API_SECRET are not set."
        )

    params: dict = {"symbol": symbol, "side": side, "type": "MARKET"}
    if side == "BUY":
        params["quoteOrderQty"] = f"{quote_usd:.8f}"
    else:
        params["quantity"] = f"{quantity:.8f}"

    signed = _signed_params(params)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{BINANCE_BASE}/order",
            params=signed,
            headers={"X-MBX-APIKEY": BINANCE_API_KEY},
        )
        resp.raise_for_status()
        data = resp.json()

    filled_qty = float(data.get("executedQty", 0) or 0)
    quote_spent = float(data.get("cummulativeQuoteQty", 0) or 0)
    avg_price = (quote_spent / filled_qty) if filled_qty else price
    log.info("LIVE order filled: %s %s %s @ %.6f", side, filled_qty, symbol, avg_price)
    return {
        "order_id": str(data.get("orderId", "")),
        "status": data.get("status", "FILLED"),
        "symbol": symbol,
        "side": side,
        "price": avg_price,
        "qty": filled_qty,
        "quote_usd": quote_spent,
        "dry_run": False,
    }
