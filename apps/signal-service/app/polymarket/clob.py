"""
Polymarket CLOB REST client.
Handles market lookup, order placement, and position tracking.
All order calls are gated by a DRY_RUN flag — no real money moves
until you explicitly disable it.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

BASE = os.getenv("POLYMARKET_API_URL", "https://clob.polymarket.com")
API_KEY = os.getenv("POLYMARKET_API_KEY", "")
API_SECRET = os.getenv("POLYMARKET_API_SECRET", "")
DRY_RUN = os.getenv("POLYMARKET_DRY_RUN", "true").lower() != "false"


@dataclass
class Market:
    condition_id: str
    question: str
    yes_token_id: str
    no_token_id: str
    end_date_iso: str
    active: bool
    volume: float


@dataclass
class OrderResult:
    order_id: str
    status: str        # "live" | "filled" | "cancelled" | "dry_run"
    side: str          # "YES" | "NO"
    price: float
    size: float
    market_id: str
    dry_run: bool


def _sign(method: str, path: str, body: str = "") -> dict[str, str]:
    ts = str(int(time.time() * 1000))
    msg = ts + method.upper() + path + body
    sig = hmac.new(API_SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest()
    return {
        "POLY-API-KEY": API_KEY,
        "POLY-TIMESTAMP": ts,
        "POLY-SIGNATURE": sig,
        "Content-Type": "application/json",
    }


async def get_markets(keyword: str = "", limit: int = 20) -> list[Market]:
    params: dict[str, Any] = {"limit": limit, "active": "true"}
    if keyword:
        params["search"] = keyword
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{BASE}/markets", params=params)
        resp.raise_for_status()
        raw = resp.json()
    results = raw.get("data", raw) if isinstance(raw, dict) else raw
    markets = []
    for m in results[:limit]:
        try:
            tokens = m.get("tokens", [])
            yes_tok = next((t["token_id"] for t in tokens if t.get("outcome") == "Yes"), "")
            no_tok = next((t["token_id"] for t in tokens if t.get("outcome") == "No"), "")
            markets.append(Market(
                condition_id=m.get("condition_id", m.get("id", "")),
                question=m.get("question", ""),
                yes_token_id=yes_tok,
                no_token_id=no_tok,
                end_date_iso=m.get("end_date_iso", ""),
                active=m.get("active", True),
                volume=float(m.get("volume", 0)),
            ))
        except Exception:
            continue
    return markets


async def get_market(condition_id: str) -> Market | None:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{BASE}/markets/{condition_id}")
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        m = resp.json()
    tokens = m.get("tokens", [])
    yes_tok = next((t["token_id"] for t in tokens if t.get("outcome") == "Yes"), "")
    no_tok = next((t["token_id"] for t in tokens if t.get("outcome") == "No"), "")
    return Market(
        condition_id=m.get("condition_id", m.get("id", "")),
        question=m.get("question", ""),
        yes_token_id=yes_tok,
        no_token_id=no_tok,
        end_date_iso=m.get("end_date_iso", ""),
        active=m.get("active", True),
        volume=float(m.get("volume", 0)),
    )


async def get_orderbook(condition_id: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(f"{BASE}/book", params={"token_id": condition_id})
        if not resp.is_success:
            return {}
        return resp.json()


async def place_order(
    market: Market,
    side: str,          # "YES" | "NO"
    price: float,       # 0-1
    size_usdc: float,   # USDC amount to spend
) -> OrderResult:
    token_id = market.yes_token_id if side == "YES" else market.no_token_id
    body = {
        "token_id": token_id,
        "price": round(price, 4),
        "size": round(size_usdc, 2),
        "side": "BUY",
        "type": "LIMIT",
    }
    body_str = json.dumps(body)

    if DRY_RUN:
        return OrderResult(
            order_id=f"dry-{int(time.time())}",
            status="dry_run",
            side=side,
            price=price,
            size=size_usdc,
            market_id=market.condition_id,
            dry_run=True,
        )

    headers = _sign("POST", "/order", body_str)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(f"{BASE}/order", headers=headers, content=body_str)
        resp.raise_for_status()
        data = resp.json()

    return OrderResult(
        order_id=data.get("orderID", ""),
        status=data.get("status", "live"),
        side=side,
        price=price,
        size=size_usdc,
        market_id=market.condition_id,
        dry_run=False,
    )


async def cancel_order(order_id: str) -> bool:
    if DRY_RUN:
        return True
    headers = _sign("DELETE", f"/order/{order_id}")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.delete(f"{BASE}/order/{order_id}", headers=headers)
        return resp.is_success
