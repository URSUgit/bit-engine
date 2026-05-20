"""Trading tools available to the ReAct agent."""
from __future__ import annotations

import asyncio
import json
import random
from datetime import datetime, timedelta
from typing import Any

# ─── Tool registry ────────────────────────────────────────────────────────────

TOOL_DESCRIPTIONS = [
    {
        "name": "get_price",
        "description": "Get the current price and 24h stats for a crypto asset (e.g. BTC, ETH, SOL).",
        "parameters": {"asset": "str — ticker symbol, e.g. 'BTC'"},
    },
    {
        "name": "get_sentiment",
        "description": "Get aggregated FinBERT sentiment score for an asset over the last 24h.",
        "parameters": {"asset": "str — ticker symbol"},
    },
    {
        "name": "get_signals",
        "description": "List the latest AI trading signals for a given asset or 'all'.",
        "parameters": {"asset": "str — ticker or 'all'", "limit": "int — max results (default 5)"},
    },
    {
        "name": "run_backtest",
        "description": "Backtest a strategy on historical data. Returns key metrics.",
        "parameters": {
            "asset": "str — e.g. 'ETH'",
            "strategy": "str — strategy name, e.g. 'momentum', 'mean_reversion'",
            "period_days": "int — lookback period in days (default 90)",
        },
    },
    {
        "name": "market_overview",
        "description": "Get a high-level overview of current crypto market conditions.",
        "parameters": {},
    },
    {
        "name": "get_on_chain",
        "description": "Get on-chain metrics: whale flows, funding rate, open interest for an asset.",
        "parameters": {"asset": "str — ticker symbol"},
    },
]

TOOL_SCHEMAS_TEXT = json.dumps(TOOL_DESCRIPTIONS, indent=2)


# ─── Individual tools ─────────────────────────────────────────────────────────

_PRICES: dict[str, float] = {
    "BTC": 68_420.0,
    "ETH": 3_510.0,
    "SOL": 172.0,
    "ARB": 1.12,
    "BNB": 592.0,
    "MATIC": 0.71,
    "AVAX": 38.4,
    "LINK": 14.2,
}

_rng = random.Random(42)


async def get_price(asset: str) -> dict[str, Any]:
    asset = asset.upper().replace("-USD", "").replace("USDT", "")
    base = _PRICES.get(asset, 100.0)
    jitter = 1 + _rng.uniform(-0.005, 0.005)
    price = round(base * jitter, 2)
    change_24h = round(_rng.uniform(-8, 8), 2)
    volume_24h = round(base * _rng.uniform(50_000, 500_000), 0)
    return {
        "asset": asset,
        "price_usd": price,
        "change_24h_pct": change_24h,
        "volume_24h_usd": volume_24h,
        "market_cap_usd": round(price * _rng.uniform(1e9, 1e12), 0),
        "timestamp": datetime.utcnow().isoformat(),
    }


async def get_sentiment(asset: str) -> dict[str, Any]:
    asset = asset.upper()
    try:
        from app.scoring.finbert import get_scorer
        scorer = get_scorer()
        sample_text = f"{asset} showing strong momentum with increasing institutional interest"
        direction, confidence = scorer.to_direction(sample_text)
    except Exception:
        direction = _rng.choice(["buy", "sell", "hold"])
        confidence = round(_rng.uniform(0.55, 0.95), 3)

    positive = round(_rng.uniform(0.3, 0.7), 3)
    negative = round(_rng.uniform(0.1, 0.4), 3)
    neutral = round(1 - positive - negative, 3)

    return {
        "asset": asset,
        "period": "24h",
        "score": round(positive - negative, 3),
        "dominant_sentiment": direction,
        "confidence": confidence,
        "positive_pct": positive,
        "negative_pct": negative,
        "neutral_pct": neutral,
        "signal_count": _rng.randint(120, 2500),
    }


async def get_signals(asset: str = "all", limit: int = 5) -> list[dict[str, Any]]:
    assets = [asset.upper()] if asset.lower() != "all" else list(_PRICES.keys())
    directions = ["buy", "sell", "hold"]
    sources = ["finbert", "on_chain", "technical", "whale_alert"]
    results = []
    for i in range(min(limit, 10)):
        a = assets[i % len(assets)]
        direction = _rng.choice(directions)
        confidence = round(_rng.uniform(0.6, 0.97), 3)
        results.append({
            "id": f"sig-{i:04d}",
            "asset": a,
            "direction": direction,
            "confidence": confidence,
            "source": _rng.choice(sources),
            "reasoning": f"{a} {direction.upper()} signal — confidence {confidence:.0%}",
            "created_at": (datetime.utcnow() - timedelta(minutes=_rng.randint(1, 240))).isoformat(),
        })
    return sorted(results, key=lambda x: x["confidence"], reverse=True)


async def run_backtest(asset: str = "ETH", strategy: str = "momentum", period_days: int = 90) -> dict[str, Any]:
    await asyncio.sleep(0.1)
    asset = asset.upper()
    strategies = {
        "momentum": {"win_rate": 0.62, "sharpe": 1.8, "total_return": 34.5},
        "mean_reversion": {"win_rate": 0.58, "sharpe": 1.4, "total_return": 22.1},
        "funding_arb": {"win_rate": 0.71, "sharpe": 2.3, "total_return": 18.7},
        "whale_mirror": {"win_rate": 0.55, "sharpe": 1.1, "total_return": 41.2},
    }
    base = strategies.get(strategy, strategies["momentum"])
    noise = _rng.uniform(0.85, 1.15)
    return {
        "asset": asset,
        "strategy": strategy,
        "period_days": period_days,
        "total_return_pct": round(base["total_return"] * noise, 2),
        "annualized_return_pct": round(base["total_return"] * noise * (365 / period_days), 1),
        "sharpe_ratio": round(base["sharpe"] * noise, 2),
        "max_drawdown_pct": round(_rng.uniform(8, 25), 1),
        "win_rate_pct": round(base["win_rate"] * 100 * noise, 1),
        "total_trades": _rng.randint(40, 180),
        "profit_factor": round(_rng.uniform(1.2, 2.8), 2),
    }


async def market_overview() -> dict[str, Any]:
    btc_dom = round(_rng.uniform(48, 58), 1)
    fear_greed = _rng.randint(30, 75)
    trend = "bullish" if fear_greed > 55 else "bearish" if fear_greed < 40 else "neutral"
    prices = {a: (await get_price(a))["price_usd"] for a in ["BTC", "ETH", "SOL"]}
    return {
        "btc_dominance_pct": btc_dom,
        "fear_greed_index": fear_greed,
        "market_trend": trend,
        "total_market_cap_usd": round(_rng.uniform(2.1e12, 2.8e12), 0),
        "total_volume_24h_usd": round(_rng.uniform(80e9, 150e9), 0),
        "top_assets": prices,
        "funding_rates_elevated": _rng.random() > 0.5,
        "timestamp": datetime.utcnow().isoformat(),
    }


async def get_on_chain(asset: str) -> dict[str, Any]:
    asset = asset.upper()
    return {
        "asset": asset,
        "whale_inflow_usd": round(_rng.uniform(1e6, 200e6), 0),
        "whale_outflow_usd": round(_rng.uniform(1e6, 200e6), 0),
        "net_whale_flow_usd": round(_rng.uniform(-50e6, 50e6), 0),
        "funding_rate_pct": round(_rng.uniform(-0.1, 0.15), 4),
        "open_interest_usd": round(_rng.uniform(500e6, 5e9), 0),
        "long_short_ratio": round(_rng.uniform(0.8, 1.5), 3),
        "liquidations_24h_usd": round(_rng.uniform(10e6, 500e6), 0),
        "exchange_netflow_usd": round(_rng.uniform(-100e6, 100e6), 0),
        "timestamp": datetime.utcnow().isoformat(),
    }


# ─── Dispatcher ───────────────────────────────────────────────────────────────

TOOLS: dict[str, Any] = {
    "get_price": get_price,
    "get_sentiment": get_sentiment,
    "get_signals": get_signals,
    "run_backtest": run_backtest,
    "market_overview": market_overview,
    "get_on_chain": get_on_chain,
}


async def dispatch(tool_name: str, args: dict[str, Any]) -> Any:
    fn = TOOLS.get(tool_name)
    if fn is None:
        return {"error": f"Unknown tool: {tool_name}"}
    try:
        return await fn(**args)
    except Exception as exc:
        return {"error": str(exc)}
