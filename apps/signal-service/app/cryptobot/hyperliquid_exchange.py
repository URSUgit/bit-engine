"""Hyperliquid TESTNET execution client — perpetuals, demo funds only.

This module only ever talks to Hyperliquid's public TESTNET
(https://api.hyperliquid-testnet.xyz) — there is no mainnet base URL
anywhere in this file. Testnet USDC has no real value (free from
Hyperliquid's own testnet faucet), so unlike exchange.py's Bitget client
this can never move real money no matter how it's misconfigured.

It still mirrors exchange.py's two-gate dry_run/live pattern so a bot's
mode and this module's own env switch both have to agree before an order
actually reaches Hyperliquid's testnet — keeps behavior predictable and
stops a stray click from spamming testnet orders:
  1. The bot's own mode is "live" (never the default; see CryptoBot).
  2. The server-wide HYPERLIQUID_TESTNET_TRADING env var is "true".
Otherwise this simulates a fill locally using the live testnet mid price.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from typing import Literal

log = logging.getLogger(__name__)

TESTNET_PRIVATE_KEY = os.getenv("HYPERLIQUID_TESTNET_PRIVATE_KEY", "")
TESTNET_TRADING = os.getenv("HYPERLIQUID_TESTNET_TRADING", "false").lower() == "true"

_info = None
_exchange = None


def hyperliquid_coin(symbol: str) -> str:
    """Catalog symbol ("BTC-USD", "ETHUSDT", ...) -> Hyperliquid perp coin ("BTC", "ETH")."""
    s = symbol.upper().replace("-", "")
    for suffix in ("USDT", "USDC", "USD"):
        if s.endswith(suffix) and len(s) > len(suffix):
            return s[: -len(suffix)]
    return s


def _get_info():
    global _info
    if _info is None:
        from hyperliquid.info import Info
        from hyperliquid.utils import constants
        _info = Info(constants.TESTNET_API_URL, skip_ws=True)
    return _info


def _get_exchange():
    global _exchange
    if _exchange is None:
        from eth_account import Account
        from hyperliquid.exchange import Exchange
        from hyperliquid.utils import constants
        wallet = Account.from_key(TESTNET_PRIVATE_KEY)
        _exchange = Exchange(wallet, base_url=constants.TESTNET_API_URL)
    return _exchange


async def get_price(coin: str) -> float:
    """Public testnet mid price — no auth required."""
    info = _get_info()
    mids = await asyncio.to_thread(info.all_mids)
    price = mids.get(coin)
    if price is None:
        raise RuntimeError(f"No Hyperliquid testnet mid price for {coin!r}")
    return float(price)


async def place_market_order(
    coin: str,
    side: Literal["BUY", "SELL"],
    *,
    live: bool,
    quote_usd: float | None = None,
    quantity: float | None = None,
) -> dict:
    """Execute a perp market order on Hyperliquid TESTNET.

    `live` is the bot's own mode flag; combined with the server-wide
    TESTNET_TRADING switch above, both must be true for a real testnet
    order to fire. Otherwise this simulates a fill at the current public
    testnet mid price — same shape as exchange.py's Bitget client so
    CryptoBot can treat either exchange identically.
    """
    price = await get_price(coin)
    if not (live and TESTNET_TRADING):
        qty = quantity if quantity is not None else (quote_usd / price if price else 0.0)
        quote = quote_usd if quote_usd is not None else qty * price
        return {
            "order_id": f"dry-{uuid.uuid4().hex[:12]}",
            "status": "dry_run",
            "symbol": coin,
            "side": side,
            "price": price,
            "qty": qty,
            "quote_usd": quote,
            "dry_run": True,
        }

    if not TESTNET_PRIVATE_KEY:
        raise RuntimeError(
            "HYPERLIQUID_TESTNET_TRADING is enabled but "
            "HYPERLIQUID_TESTNET_PRIVATE_KEY is not set. Generate a fresh "
            "testnet-only key and fund it from Hyperliquid's testnet faucet — "
            "never reuse a mainnet key here."
        )

    exchange = _get_exchange()
    is_buy = side == "BUY"
    sz = quantity if quantity is not None else (quote_usd / price if price else 0.0)
    sz = round(sz, 5)

    # An opposite-side market_open of the same size nets against (and closes)
    # an existing position under Hyperliquid's default one-way position mode —
    # matches CryptoBot's single-position bookkeeping, so BUY/SELL both route
    # through the same call.
    result = await asyncio.to_thread(exchange.market_open, coin, is_buy, sz)

    statuses = result.get("response", {}).get("data", {}).get("statuses", [])
    filled = next((s.get("filled") for s in statuses if s.get("filled")), None)
    if filled is None:
        raise RuntimeError(f"Hyperliquid testnet order rejected: {result}")

    avg_price = float(filled.get("avgPx", price))
    filled_qty = float(filled.get("totalSz", sz))
    log.info("HL-TESTNET order filled: %s %s %s @ %.6f", side, filled_qty, coin, avg_price)
    return {
        "order_id": str(filled.get("oid", uuid.uuid4().hex[:12])),
        "status": "filled",
        "symbol": coin,
        "side": side,
        "price": avg_price,
        "qty": filled_qty,
        "quote_usd": filled_qty * avg_price,
        "dry_run": False,
    }
