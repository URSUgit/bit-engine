"""Bitget spot execution client.

Real money only moves when TWO independent gates both agree:
  1. The bot's own mode is "live" (per-bot, set via the mode endpoint —
     never the default; see CryptoBot / BotConfig).
  2. The server-wide BITGET_LIVE_TRADING env var is "true" (server operator
     opt-in — mirrors app/polymarket/clob.py's DRY_RUN flag).
A single flipped switch — a UI click or a stray env var — can never place a
real order alone. Whenever either gate is off, orders are simulated locally
using the live public price, no API key required and no request sent to
Bitget's signed trading endpoints.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import time
import uuid
from typing import Literal

import httpx

log = logging.getLogger(__name__)

BITGET_BASE = "https://api.bitget.com"
BITGET_API_KEY = os.getenv("BITGET_API_KEY", "")
BITGET_API_SECRET = os.getenv("BITGET_API_SECRET", "")
BITGET_API_PASSPHRASE = os.getenv("BITGET_API_PASSPHRASE", "")
LIVE_TRADING = os.getenv("BITGET_LIVE_TRADING", "false").lower() == "true"


def _sign(timestamp: str, method: str, request_path: str, body: str = "") -> str:
    message = f"{timestamp}{method.upper()}{request_path}{body}"
    mac = hmac.new(BITGET_API_SECRET.encode(), message.encode(), hashlib.sha256)
    return base64.b64encode(mac.digest()).decode()


def _auth_headers(method: str, request_path: str, body: str = "") -> dict:
    timestamp = str(int(time.time() * 1000))
    return {
        "ACCESS-KEY": BITGET_API_KEY,
        "ACCESS-SIGN": _sign(timestamp, method, request_path, body),
        "ACCESS-TIMESTAMP": timestamp,
        "ACCESS-PASSPHRASE": BITGET_API_PASSPHRASE,
        "Content-Type": "application/json",
        "locale": "en-US",
    }


async def get_price(symbol: str) -> float:
    """Public spot ticker price — no auth required."""
    async with httpx.AsyncClient(timeout=5) as client:
        r = await client.get(
            f"{BITGET_BASE}/api/v2/spot/market/tickers", params={"symbol": symbol}
        )
        r.raise_for_status()
        data = r.json()["data"]
        if not data:
            raise RuntimeError(f"No Bitget ticker for {symbol}")
        return float(data[0]["lastPr"])


async def _order_info(order_id: str) -> dict:
    request_path = f"/api/v2/spot/trade/orderInfo?orderId={order_id}"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{BITGET_BASE}{request_path}",
            headers=_auth_headers("GET", request_path),
        )
        resp.raise_for_status()
        rows = resp.json().get("data") or []
        return rows[0] if rows else {}


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
    Bitget. Otherwise this simulates a fill at the current public price.
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

    if not (BITGET_API_KEY and BITGET_API_SECRET and BITGET_API_PASSPHRASE):
        raise RuntimeError(
            "BITGET_LIVE_TRADING is enabled but BITGET_API_KEY / "
            "BITGET_API_SECRET / BITGET_API_PASSPHRASE are not set."
        )

    # Bitget market orders size in quote currency on BUY (spend this much
    # USDT) and in base currency on SELL (sell this many coins) — same
    # convention as Binance's quoteOrderQty/quantity split.
    body_obj = {
        "symbol": symbol,
        "side": side.lower(),
        "orderType": "market",
        "force": "gtc",
        "size": f"{quote_usd:.8f}" if side == "BUY" else f"{quantity:.8f}",
    }
    body = json.dumps(body_obj)
    request_path = "/api/v2/spot/trade/place-order"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{BITGET_BASE}{request_path}",
            content=body,
            headers=_auth_headers("POST", request_path, body),
        )
        resp.raise_for_status()
        payload = resp.json()
        if str(payload.get("code")) != "00000":
            raise RuntimeError(f"Bitget order rejected: {payload}")
        order_id = str(payload["data"]["orderId"])

    # Market orders fill near-instantly but the placement response carries no
    # fill data — poll orderInfo briefly for the actual average price/qty.
    info: dict = {}
    for _ in range(5):
        await asyncio.sleep(0.4)
        info = await _order_info(order_id)
        if info.get("status") == "filled":
            break

    filled_qty = float(info.get("baseVolume", 0) or 0)
    quote_spent = float(info.get("quoteVolume", 0) or 0)
    avg_price = float(info.get("priceAvg", 0) or 0) or (
        (quote_spent / filled_qty) if filled_qty else price
    )
    log.info("LIVE order filled: %s %s %s @ %.6f", side, filled_qty, symbol, avg_price)
    return {
        "order_id": order_id,
        "status": info.get("status", "filled"),
        "symbol": symbol,
        "side": side,
        "price": avg_price,
        "qty": filled_qty,
        "quote_usd": quote_spent,
        "dry_run": False,
    }
