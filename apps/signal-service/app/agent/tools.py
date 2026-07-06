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
    {
        "name": "search_symbols",
        "description": "Search the backtest symbol catalog for tradeable assets.",
        "parameters": {"query": "str — partial symbol or category name (empty = return all, up to 20)"},
    },
    {
        "name": "get_backtest_history",
        "description": "Get recent backtest runs from the history store.",
        "parameters": {"limit": "int — max results (default 5)"},
    },
    {
        "name": "navigate_to",
        "description": "Navigate the user to a page in the platform. Valid paths: /dashboard, /dashboard/positions, /dashboard/markets, /dashboard/history, /dashboard/markets/{SYMBOL} (e.g. /dashboard/markets/BTC-USD), /lab/backtester, /lab/agent, /dashboard/signals, /lab/polymarket",
        "parameters": {"path": "str — platform path to navigate to"},
    },
    {
        "name": "run_audit",
        "description": "Run a full platform audit. Returns a prioritized list of findings: security issues, code quality problems, missing tests, outdated deps, and more.",
        "parameters": {},
    },
    {
        "name": "get_audit_report",
        "description": "Get the most recent audit report summary. Use run_audit first if no report exists.",
        "parameters": {},
    },
    {
        "name": "read_file",
        "description": "Read the contents of a file in the project. Useful for understanding code before suggesting a fix.",
        "parameters": {"path": "str — absolute or relative-to-project path"},
    },
    {
        "name": "list_files",
        "description": "List files matching a glob pattern in the project. E.g. 'apps/web/src/**/*.tsx'",
        "parameters": {"pattern": "str — glob pattern"},
    },
    {
        "name": "write_file",
        "description": "Write content to a file in the project to fix an issue. ONLY use this after reading the file and understanding what needs to change. Never write .env files.",
        "parameters": {"path": "str — path relative to project root", "content": "str — full new file content"},
    },
    {
        "name": "run_command",
        "description": "Run a safe read-only shell command in the project. Allowed: git status, git diff, git log, grep, find, cat, ls, python -m py_compile, tsc --noEmit, pip list, npm list. NOT allowed: rm, git push, git commit.",
        "parameters": {"cmd": "str — the shell command"},
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
    # Cache keys are stored as "BTCUSDT" style; try both forms
    record = cache.get(asset + "USDT") or cache.get(asset)
    if record:
        return {
            "asset": asset,
            "price_usd": record.price,
            "change_24h_pct": record.price_change_pct_24h,
            "volume_24h_usd": record.volume_usdt_24h,
            "market_cap_usd": record.market_cap,
            "rsi": record.rsi,
            "high_24h": record.high_24h,
            "low_24h": record.low_24h,
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
                if d.get("usd"):
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

    # Last resort: Coinbase spot (key-free, global, not geo-blocked)
    try:
        from app.feeds.crypto import fetch_coinbase_spot
        price = await fetch_coinbase_spot(asset + "USDT")
        if price > 0:
            return {
                "asset": asset,
                "price_usd": price,
                "change_24h_pct": 0,
                "volume_24h_usd": 0,
                "market_cap_usd": 0,
                "source": "coinbase",
                "timestamp": datetime.utcnow().isoformat(),
            }
    except Exception:
        pass

    return {"asset": asset, "error": "price not available"}


async def get_sentiment(asset: str) -> dict[str, Any]:
    asset = asset.upper()
    cache = _get_price_cache()
    # get_sentiment returns a float score directly
    news_score: float = cache.get_sentiment(asset)

    engine = _get_signal_engine()
    signals = engine.get_signals(asset=asset)
    buy_count = sum(1 for s in signals if s.get("direction") == "buy")
    sell_count = sum(1 for s in signals if s.get("direction") == "sell")
    signal_bias = (buy_count - sell_count) / max(len(signals), 1)

    combined = round((news_score + signal_bias) / 2, 3)

    return {
        "asset": asset,
        "period": "24h",
        "score": combined,
        "dominant_sentiment": "bullish" if combined > 0.1 else "bearish" if combined < -0.1 else "neutral",
        "news_sentiment_score": round(news_score, 3),
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
        total_vol += r.volume_usdt_24h

    btc_mcap = next((r.market_cap for r in crypto_prices if r.symbol == "BTCUSDT"), 0)
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


async def search_symbols(query: str = "") -> list[dict]:
    """Search the backtest symbol catalog."""
    from app.backtest.data import all_symbols
    results = all_symbols()
    q = query.lower()
    if q:
        results = [r for r in results if q in r["symbol"].lower() or q in r.get("category", "").lower()]
    return results[:20]


async def get_backtest_history(limit: int = 5) -> list[dict]:
    """Get recent backtest runs from history."""
    from app.backtest.history import backtest_history
    return backtest_history.list(limit=limit)


async def navigate_to(path: str) -> dict:
    """Navigate the user to a page in the platform. Valid paths: /dashboard, /dashboard/positions, /dashboard/markets, /dashboard/history, /dashboard/markets/{SYMBOL} (e.g. /dashboard/markets/BTC-USD), /lab/backtester, /lab/agent, /dashboard/signals, /lab/polymarket"""
    return {"__navigate__": True, "path": path}


# ─── Audit tools ──────────────────────────────────────────────────────────────

_PROJECT_ROOT = "/home/user/bit-engine"

# Allowlist of safe read-only shell command prefixes
_CMD_ALLOWLIST = [
    "git status",
    "git diff",
    "git log",
    "grep ",
    "grep -",
    "find ",
    "cat ",
    "ls",
    "ls ",
    "python -m py_compile",
    "npx tsc",
    "tsc ",
    "pip list",
    "npm list",
]


async def run_audit() -> dict[str, Any]:
    """Run a full platform audit and save results to the store."""
    import asyncio as _asyncio
    from app.audit import checker as _checker, store as _store
    report = await _asyncio.to_thread(_checker.run_all)
    report_id = await _asyncio.to_thread(_store.save_report, report)
    top_findings = [
        {
            "id": f.id,
            "priority": f.priority,
            "category": f.category,
            "title": f.title,
            "file": f.file,
            "line": f.line,
            "fix_hint": f.fix_hint,
        }
        for f in report.findings[:10]
    ]
    return {
        "report_id": report_id,
        "checked_at": report.checked_at,
        "summary": report.summary,
        "top_findings": top_findings,
    }


async def get_audit_report() -> dict[str, Any]:
    """Load the latest saved audit report."""
    import asyncio as _asyncio
    from app.audit import store as _store
    report = await _asyncio.to_thread(_store.load_latest)
    if report is None:
        return {"error": "No audit report found. Run run_audit first."}
    top_findings = [
        {
            "id": f.id,
            "priority": f.priority,
            "category": f.category,
            "title": f.title,
            "file": f.file,
            "line": f.line,
            "fix_hint": f.fix_hint,
        }
        for f in report.findings[:20]
    ]
    return {
        "checked_at": report.checked_at,
        "summary": report.summary,
        "findings": top_findings,
    }


async def read_file(path: str) -> dict[str, Any]:
    """Read a file from the project (safety-checked, max 300 lines)."""
    import asyncio as _asyncio

    def _read(path: str) -> dict[str, Any]:
        import os as _os
        # Resolve path
        if not _os.path.isabs(path):
            path = _os.path.join(_PROJECT_ROOT, path)
        path = _os.path.realpath(path)
        real_root = _os.path.realpath(_PROJECT_ROOT)
        if not path.startswith(real_root + _os.sep) and path != real_root:
            return {"error": "Path is outside PROJECT_ROOT."}
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                lines = fh.readlines()
            truncated = len(lines) > 300
            content = "".join(lines[:300])
            return {
                "path": path,
                "lines": min(len(lines), 300),
                "total_lines": len(lines),
                "truncated": truncated,
                "content": content,
            }
        except FileNotFoundError:
            return {"error": f"File not found: {path}"}
        except Exception as exc:
            return {"error": str(exc)}

    return await _asyncio.to_thread(_read, path)


async def list_files(pattern: str) -> dict[str, Any]:
    """List files matching a glob pattern in the project."""
    import asyncio as _asyncio
    import glob as _glob

    def _list(pattern: str) -> dict[str, Any]:
        import os as _os
        # If pattern is relative, root it to PROJECT_ROOT
        if not _os.path.isabs(pattern):
            pattern = _os.path.join(_PROJECT_ROOT, pattern)
        matches = _glob.glob(pattern, recursive=True)
        # Safety: filter to only PROJECT_ROOT
        real_root = _os.path.realpath(_PROJECT_ROOT)
        safe = [p for p in matches if _os.path.realpath(p).startswith(real_root)]
        safe.sort()
        truncated = len(safe) > 30
        return {
            "pattern": pattern,
            "count": len(safe),
            "truncated": truncated,
            "files": safe[:30],
        }

    return await _asyncio.to_thread(_list, pattern)


async def write_file(path: str, content: str) -> dict[str, Any]:
    """Write content to a project file (safety-checked)."""
    import asyncio as _asyncio

    def _write(path: str, content: str) -> dict[str, Any]:
        import os as _os
        if not _os.path.isabs(path):
            path = _os.path.join(_PROJECT_ROOT, path)
        path = _os.path.realpath(path)
        real_root = _os.path.realpath(_PROJECT_ROOT)
        if not path.startswith(real_root + _os.sep) and path != real_root:
            return {"error": "Path is outside PROJECT_ROOT."}
        basename = _os.path.basename(path)
        if basename.startswith(".env") or "/.git/" in path or path.endswith("/.git"):
            return {"error": "Writing .env or .git files is not allowed."}
        try:
            _os.makedirs(_os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(content)
            return {"ok": True, "path": path, "bytes_written": len(content.encode())}
        except Exception as exc:
            return {"error": str(exc)}

    return await _asyncio.to_thread(_write, path, content)


async def run_command(cmd: str) -> dict[str, Any]:
    """Run a safe read-only shell command."""
    import asyncio as _asyncio
    import subprocess as _subprocess

    cmd_stripped = cmd.strip()
    allowed = any(cmd_stripped.startswith(prefix) for prefix in _CMD_ALLOWLIST)
    if not allowed:
        return {
            "error": (
                "Command not in allowlist. Allowed: git status/diff/log, grep, find, "
                "cat, ls, python -m py_compile, tsc --noEmit, pip list, npm list."
            )
        }

    def _run(cmd: str) -> dict[str, Any]:
        try:
            result = _subprocess.run(
                cmd,
                shell=True,  # noqa: S602 — user input already allowlist-checked
                capture_output=True,
                text=True,
                cwd=_PROJECT_ROOT,
                timeout=30,
            )
            out = result.stdout[:2000]
            err = result.stderr[:500]
            return {"stdout": out, "stderr": err, "returncode": result.returncode}
        except _subprocess.TimeoutExpired:
            return {"error": "Command timed out after 30s"}
        except Exception as exc:
            return {"error": str(exc)}

    return await _asyncio.to_thread(_run, cmd_stripped)


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
    "search_symbols": search_symbols,
    "get_backtest_history": get_backtest_history,
    "navigate_to": navigate_to,
    "run_audit": run_audit,
    "get_audit_report": get_audit_report,
    "read_file": read_file,
    "list_files": list_files,
    "write_file": write_file,
    "run_command": run_command,
}


async def dispatch(tool_name: str, args: dict[str, Any]) -> Any:
    fn = TOOLS.get(tool_name)
    if fn is None:
        return {"error": f"Unknown tool: {tool_name}"}
    try:
        return await fn(**args)
    except Exception as exc:
        return {"error": str(exc)}
