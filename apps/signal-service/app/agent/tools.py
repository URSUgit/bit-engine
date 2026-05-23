"""Trading tools available to the ReAct agent — wired to real data feeds."""
from __future__ import annotations

import asyncio
import json
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
        "description": "Get aggregated sentiment (news + signal-based) for an asset.",
        "parameters": {"asset": "str — ticker symbol"},
    },
    {
        "name": "get_signals",
        "description": "List the latest AI trading signals for a given asset or 'all'.",
        "parameters": {"asset": "str — ticker or 'all'", "limit": "int — max results (default 5)"},
    },
    {
        "name": "run_backtest",
        "description": "Backtest a strategy on historical data. Strategies: rsi, ma_cross, momentum, bollinger, buy_and_hold.",
        "parameters": {
            "asset": "str — e.g. 'BTC'",
            "strategy": "str — strategy name",
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
        "description": "Get on-chain metrics: funding rate, open interest for an asset.",
        "parameters": {"asset": "str — ticker symbol"},
    },
    {
        "name": "polymarket_search",
        "description": "Search active Polymarket prediction markets by keyword.",
        "parameters": {"keyword": "str — search term", "limit": "int — max results (default 10)"},
    },
    {
        "name": "polymarket_start_bot",
        "description": "Start a Polymarket bot on a market. Always starts in dry_run mode.",
        "parameters": {
            "market_id": "str — condition_id from polymarket_search",
            "entry_threshold": "float — max price to pay (default 0.40)",
            "size_usdc": "float — bet size in USDC (default 10.0)",
        },
    },
    {
        "name": "polymarket_bot_status",
        "description": "Get status, P&L, and feed health of a running Polymarket bot.",
        "parameters": {"market_id": "str — condition_id"},
    },
    {
        "name": "polymarket_ledger",
        "description": "Get the trade ledger summary and recent trades for the Polymarket bot.",
        "parameters": {},
    },
]

TOOL_SCHEMAS_TEXT = json.dumps(TOOL_DESCRIPTIONS, indent=2)


# ─── Helpers to get real data ────────────────────────────────────────────────

def _get_price_cache():
    from app.feeds import price_cache
    return price_cache

def _get_signal_engine():
    from app.feeds import signal_engine
    return signal_engine


# ─── Individual tools — wired to real feeds ──────────────────────────────────

SYMBOL_MAP = {
    "BTC": "bitcoin", "ETH": "ethereum", "SOL": "solana", "BNB": "binancecoin",
    "XRP": "ripple", "ADA": "cardano", "DOGE": "dogecoin", "AVAX": "avalanche-2",
    "MATIC": "matic-network", "DOT": "polkadot", "LINK": "chainlink", "LTC": "litecoin",
    "ATOM": "cosmos", "UNI": "uniswap", "ARB": "arbitrum", "OP": "optimism",
}


async def get_price(asset: str) -> dict[str, Any]:
    asset = asset.upper().replace("-USD", "").replace("USDT", "")
    cache = _get_price_cache()
    record = cache.get(asset)
    if record:
        return {
            "asset": asset,
            "price_usd": record.price,
            "change_24h_pct": record.change_24h,
            "volume_24h_usd": record.volume_24h,
            "market_cap_usd": record.market_cap,
            "source": record.source,
            "timestamp": datetime.utcnow().isoformat(),
        }
    # Fallback: try CoinGecko directly
    try:
        import httpx
        cg_id = SYMBOL_MAP.get(asset)
        if cg_id:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(
                    f"https://api.coingecko.com/api/v3/simple/price?ids={cg_id}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true"
                )
                d = r.json().get(cg_id, {})
                return {
                    "asset": asset,
                    "price_usd": d.get("usd", 0),
                    "change_24h_pct": d.get("usd_24h_change", 0),
                    "volume_24h_usd": d.get("usd_24h_vol", 0),
                    "market_cap_usd": d.get("usd_market_cap", 0),
                    "source": "coingecko",
                    "timestamp": datetime.utcnow().isoformat(),
                }
    except Exception:
        pass
    return {"asset": asset, "error": "price not available"}


async def get_sentiment(asset: str) -> dict[str, Any]:
    asset = asset.upper()
    cache = _get_price_cache()
    sentiment_data = cache.get_sentiment(asset)

    score = 0.0
    label = "neutral"
    if sentiment_data:
        score = sentiment_data.get("score", 0)
        label = sentiment_data.get("label", "neutral")

    engine = _get_signal_engine()
    signals = engine.get_signals(asset=asset)
    buy_count = sum(1 for s in signals if s.get("direction") == "buy")
    sell_count = sum(1 for s in signals if s.get("direction") == "sell")
    signal_bias = (buy_count - sell_count) / max(len(signals), 1)

    combined = round((score + signal_bias) / 2, 3) if sentiment_data else round(signal_bias, 3)

    return {
        "asset": asset,
        "period": "24h",
        "score": combined,
        "dominant_sentiment": "bullish" if combined > 0.1 else "bearish" if combined < -0.1 else "neutral",
        "news_sentiment_score": score,
        "news_sentiment_label": label,
        "signal_count": len(signals),
        "signal_buy_count": buy_count,
        "signal_sell_count": sell_count,
    }


async def get_signals(asset: str = "all", limit: int = 5) -> list[dict[str, Any]]:
    engine = _get_signal_engine()
    asset_filter = None if asset.lower() == "all" else asset.upper()
    signals = engine.get_signals(asset=asset_filter, limit=limit)
    return [
        {
            "id": s.get("id", f"sig-{i}"),
            "asset": s.get("asset", ""),
            "direction": s.get("direction", "hold"),
            "confidence": s.get("confidence", 0),
            "source": s.get("source", "engine"),
            "reasoning": s.get("reasoning", ""),
            "tier": s.get("metadata", {}).get("tier", "strong"),
            "created_at": s.get("created_at", datetime.utcnow().isoformat()),
        }
        for i, s in enumerate(signals[:limit])
    ]


async def run_backtest(asset: str = "BTC", strategy: str = "rsi", period_days: int = 90) -> dict[str, Any]:
    asset = asset.upper()
    try:
        from app.backtest.engine import run_backtest as _run_backtest
        from app.backtest.models import BacktestParams
        from datetime import date

        end = date.today()
        start = end - timedelta(days=period_days)

        strategy_map = {"rsi": "rsi", "ma_cross": "ma_cross", "momentum": "momentum",
                        "bollinger": "bollinger", "buy_and_hold": "buy_and_hold",
                        "mean_reversion": "bollinger"}
        strat = strategy_map.get(strategy.lower(), "rsi")

        suffix = "-USD" if asset in SYMBOL_MAP else ""
        params = BacktestParams(
            symbol=f"{asset}{suffix}",
            strategy=strat,
            start_date=start.isoformat(),
            end_date=end.isoformat(),
            interval="1d",
            initial_capital=10000,
            commission_pct=0.1,
            slippage_pct=0.05,
            position_size_pct=95,
            strategy_params={},
        )
        result = await _run_backtest(params)
        m = result.metrics
        return {
            "asset": asset,
            "strategy": strat,
            "period_days": period_days,
            "total_return_pct": round(m.total_return_pct, 2),
            "cagr_pct": round(m.cagr_pct, 2),
            "sharpe_ratio": round(m.sharpe_ratio, 2),
            "sortino_ratio": round(m.sortino_ratio, 2),
            "max_drawdown_pct": round(m.max_drawdown_pct, 1),
            "win_rate_pct": round(m.win_rate_pct, 1),
            "total_trades": m.total_trades,
            "profit_factor": round(m.profit_factor, 2),
            "calmar_ratio": round(m.calmar_ratio, 2),
            "final_equity": round(m.final_equity, 2),
        }
    except Exception as exc:
        return {"asset": asset, "strategy": strategy, "error": str(exc)}


async def market_overview() -> dict[str, Any]:
    cache = _get_price_cache()
    crypto_prices = cache.by_asset_class("crypto")

    top_assets = {}
    total_mcap = 0.0
    total_vol = 0.0
    for r in crypto_prices:
        top_assets[r.symbol] = r.price
        total_mcap += r.market_cap
        total_vol += r.volume_24h

    btc_mcap = next((r.market_cap for r in crypto_prices if r.symbol == "BTC"), 0)
    btc_dom = round(btc_mcap / total_mcap * 100, 1) if total_mcap > 0 else 0

    # Get Fear & Greed if available
    fear_greed = None
    try:
        from app.backtest.metadata import metadata_loader
        fng = await metadata_loader.fetch_fear_greed_index()
        if fng:
            fear_greed = fng.get("value", None)
    except Exception:
        pass

    trend = "neutral"
    if fear_greed is not None:
        trend = "bullish" if fear_greed > 55 else "bearish" if fear_greed < 40 else "neutral"

    return {
        "btc_dominance_pct": btc_dom,
        "fear_greed_index": fear_greed,
        "market_trend": trend,
        "total_market_cap_usd": round(total_mcap, 0),
        "total_volume_24h_usd": round(total_vol, 0),
        "top_assets": {k: v for k, v in list(top_assets.items())[:6]},
        "asset_count": len(crypto_prices),
        "timestamp": datetime.utcnow().isoformat(),
    }


async def get_on_chain(asset: str) -> dict[str, Any]:
    asset = asset.upper()
    try:
        from app.feeds.crypto import fetch_binance_funding_rate, fetch_binance_open_interest
        funding, oi = await asyncio.gather(
            fetch_binance_funding_rate(asset),
            fetch_binance_open_interest(asset),
        )
        return {
            "asset": asset,
            "funding_rate_pct": funding.get("funding_rate", 0) if funding else 0,
            "next_funding_time": funding.get("next_funding_time") if funding else None,
            "open_interest_usd": oi.get("open_interest_usd", 0) if oi else 0,
            "source": "binance",
            "timestamp": datetime.utcnow().isoformat(),
        }
    except Exception as exc:
        return {"asset": asset, "error": str(exc)}


# ─── Polymarket tools (already real) ─────────────────────────────────────────

async def polymarket_search(keyword: str = "", limit: int = 10) -> list[dict[str, Any]]:
    try:
        from app.polymarket.clob import get_markets
        markets = await get_markets(keyword=keyword, limit=limit)
        return [{"condition_id": m.condition_id, "question": m.question,
                 "volume": m.volume, "end_date": m.end_date_iso} for m in markets]
    except Exception as exc:
        return [{"error": str(exc)}]


async def polymarket_start_bot(market_id: str, entry_threshold: float = 0.40,
                                size_usdc: float = 10.0) -> dict[str, Any]:
    try:
        from app.polymarket.bot import BotConfig, create_bot
        config = BotConfig(market_id=market_id, entry_threshold=entry_threshold,
                           size_usdc=size_usdc, mode="dry_run")
        bot = await create_bot(config)
        s = bot.status()
        return {"started": True, "market_id": market_id, "mode": "dry_run",
                "question": s.market_question}
    except Exception as exc:
        return {"error": str(exc)}


async def polymarket_bot_status(market_id: str) -> dict[str, Any]:
    from app.polymarket.bot import get_bot
    bot = get_bot(market_id)
    if not bot:
        return {"error": "No bot running for this market"}
    s = bot.status()
    return {"mode": s.mode, "ticks": s.ticks_processed, "trades": s.trades_attempted,
            "last_price": s.last_tick_price, "last_decision": s.last_decision,
            "feeds": s.feed_stats, "uptime_s": round(s.uptime_seconds, 1)}


async def polymarket_ledger() -> dict[str, Any]:
    from app.polymarket.ledger import get_ledger
    ledger = get_ledger()
    return {"summary": ledger.summary(), "recent_trades": ledger.recent(10)}


TOOLS: dict[str, Any] = {
    "get_price": get_price,
    "get_sentiment": get_sentiment,
    "get_signals": get_signals,
    "run_backtest": run_backtest,
    "market_overview": market_overview,
    "get_on_chain": get_on_chain,
    "polymarket_search": polymarket_search,
    "polymarket_start_bot": polymarket_start_bot,
    "polymarket_bot_status": polymarket_bot_status,
    "polymarket_ledger": polymarket_ledger,
}


async def dispatch(tool_name: str, args: dict[str, Any]) -> Any:
    fn = TOOLS.get(tool_name)
    if fn is None:
        return {"error": f"Unknown tool: {tool_name}"}
    try:
        return await fn(**args)
    except Exception as exc:
        return {"error": str(exc)}
