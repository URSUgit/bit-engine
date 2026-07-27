"""Heuristic extraction: turn a video transcript into assets, sentiment,
signals and strategy suggestions.

Pure functions, no I/O — the LLM path (service.py) produces the same shape
and falls back to this when no API key is configured or the call fails.
"""
from __future__ import annotations

import re
from collections import Counter

# Spoken names -> catalog symbols (crypto natively, big stocks via Yahoo).
ASSET_ALIASES: dict[str, str] = {
    "bitcoin": "BTC-USD", "btc": "BTC-USD",
    "ethereum": "ETH-USD", "eth": "ETH-USD", "ether": "ETH-USD",
    "solana": "SOL-USD", "sol": "SOL-USD",
    "xrp": "XRP-USD", "ripple": "XRP-USD",
    "cardano": "ADA-USD", "ada": "ADA-USD",
    "dogecoin": "DOGE-USD", "doge": "DOGE-USD",
    "avalanche": "AVAX-USD", "avax": "AVAX-USD",
    "polkadot": "DOT-USD",
    "chainlink": "LINK-USD",
    "litecoin": "LTC-USD",
    "bnb": "BNB-USD", "binance coin": "BNB-USD",
    "polygon": "MATIC-USD", "matic": "MATIC-USD",
    "apple": "AAPL", "aapl": "AAPL",
    "tesla": "TSLA", "tsla": "TSLA",
    "nvidia": "NVDA", "nvda": "NVDA",
    "microsoft": "MSFT",
    "amazon": "AMZN",
    "meta": "META",
    "s&p": "SPY", "spx": "SPY", "spy": "SPY",
    "nasdaq": "QQQ", "qqq": "QQQ",
    "gold": "GC=F",
    "silver": "SI=F",
    "oil": "CL=F", "crude": "CL=F",
}

BULLISH = {
    "bullish", "buy", "buying", "long", "longs", "accumulate", "accumulating",
    "breakout", "moon", "mooning", "pump", "pumping", "rally", "rallying",
    "uptrend", "upside", "support held", "higher high", "golden cross",
    "undervalued", "dip buy", "bounce", "bounced", "reversal up",
}
BEARISH = {
    "bearish", "sell", "selling", "short", "shorts", "dump", "dumping",
    "crash", "crashing", "correction", "breakdown", "downtrend", "downside",
    "lower low", "death cross", "overvalued", "resistance rejected",
    "rejection", "capitulation", "top is in",
}

# Indicator talk -> backtest strategy registry keys (must exist in STRATEGIES).
INDICATOR_STRATEGIES: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"\brsi\b.*\bdivergen|divergen.*\brsi\b", re.S), "rsi_divergence", "RSI divergence called out"),
    (re.compile(r"\brsi\b"), "rsi", "RSI levels discussed"),
    (re.compile(r"\bmacd\b"), "macd", "MACD crossover discussed"),
    (re.compile(r"\bbollinger\b"), "bollinger", "Bollinger bands discussed"),
    (re.compile(r"\bichimoku\b|\bcloud\b.{0,20}\b(kumo|span)\b"), "ichimoku", "Ichimoku cloud discussed"),
    (re.compile(r"\bsupertrend\b"), "supertrend", "Supertrend discussed"),
    (re.compile(r"\bstochastic\b"), "stoch_rsi", "Stochastic momentum discussed"),
    (re.compile(r"\bvwap\b"), "vwap_reversion", "VWAP levels discussed"),
    (re.compile(r"\bheikin\b"), "heikin_ashi", "Heikin-Ashi candles discussed"),
    (re.compile(r"\bwilliams\b"), "williams_r", "Williams %R discussed"),
    (re.compile(r"\baroon\b"), "aroon", "Aroon discussed"),
    (re.compile(r"\bcci\b|commodity channel"), "cci", "CCI discussed"),
    (re.compile(r"\bkeltner\b"), "keltner_channel", "Keltner channel discussed"),
    (re.compile(r"\bparabolic\b|\bpsar\b|\bsar\b"), "psar", "Parabolic SAR discussed"),
    (re.compile(r"\belder\b"), "elder_impulse", "Elder impulse discussed"),
    (re.compile(r"\bdonchian\b"), "donchian_channel", "Donchian channel discussed"),
    (re.compile(r"golden cross|death cross|\bma cross|moving average cross"), "ma_cross", "MA cross discussed"),
    (re.compile(r"\btriple ema\b|\btema\b"), "triple_ema", "Triple EMA discussed"),
    (re.compile(r"\bdema\b|double ema"), "dema_cross", "DEMA cross discussed"),
    (re.compile(r"\bema\b|moving average"), "scalp_ema", "EMA/moving averages discussed"),
    (re.compile(r"\bbreakout\b|\bresistance\b|\bsupport\b"), "breakout_scalp", "Support/resistance breakout discussed"),
    (re.compile(r"\bmomentum\b"), "momentum", "Momentum discussed"),
    (re.compile(r"\bfunding rate\b|\bfunding\b.{0,12}\barb"), "funding_arb", "Funding rates discussed"),
    (re.compile(r"\bhodl\b|\bhold\b.{0,20}\blong term\b|dollar.cost", re.S), "buy_and_hold", "Long-term holding discussed"),
]

_WORD = re.compile(r"[a-z][a-z&%]+")


def find_assets(text: str) -> list[dict]:
    """Mentioned assets ranked by mention count."""
    low = text.lower()
    counts: Counter[str] = Counter()
    for alias, symbol in ASSET_ALIASES.items():
        n = len(re.findall(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", low))
        if n:
            counts[symbol] += n
    return [{"symbol": s, "mentions": c} for s, c in counts.most_common(8)]


def _direction_hits(text: str, vocab: set[str]) -> int:
    low = text.lower()
    return sum(len(re.findall(rf"(?<![a-z]){re.escape(term)}(?![a-z])", low)) for term in vocab)


def sentiment_score(text: str) -> float:
    """[-1, 1]: net bullish/bearish language density."""
    bull = _direction_hits(text, BULLISH)
    bear = _direction_hits(text, BEARISH)
    total = bull + bear
    if total == 0:
        return 0.0
    return (bull - bear) / total


def asset_direction(text: str, alias_symbols: dict[str, str], symbol: str, window: int = 220) -> float:
    """Sentiment in windows around each mention of `symbol`'s aliases."""
    low = text.lower()
    scores: list[float] = []
    for alias, sym in alias_symbols.items():
        if sym != symbol:
            continue
        for m in re.finditer(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", low):
            chunk = low[max(0, m.start() - window): m.end() + window]
            s = sentiment_score(chunk)
            if s != 0.0:
                scores.append(s)
    if not scores:
        return 0.0
    return sum(scores) / len(scores)


def suggest_strategies(text: str, max_n: int = 5) -> list[dict]:
    low = text.lower()
    out: list[dict] = []
    seen: set[str] = set()
    for pattern, strategy, why in INDICATOR_STRATEGIES:
        if strategy in seen:
            continue
        if pattern.search(low):
            seen.add(strategy)
            out.append({"strategy": strategy, "why": why, "params": {}})
            if len(out) >= max_n:
                break
    return out


def extract(title: str, transcript: str) -> dict:
    """Full heuristic analysis of one video."""
    text = f"{title}\n{transcript}"
    assets = find_assets(text)
    overall = sentiment_score(text)
    signals: list[dict] = []
    for a in assets[:5]:
        local = asset_direction(text, ASSET_ALIASES, a["symbol"])
        score = local if local != 0.0 else overall
        if abs(score) < 0.15:
            continue
        direction = "buy" if score > 0 else "sell"
        confidence = round(min(0.9, 0.35 + 0.4 * abs(score) + 0.03 * min(a["mentions"], 8)), 2)
        signals.append({
            "asset": a["symbol"],
            "direction": direction,
            "confidence": confidence,
            "reasoning": f"{a['mentions']} mentions; {'bullish' if score > 0 else 'bearish'} language near them (score {score:+.2f})",
        })
    return {
        "engine": "heuristic",
        "assets": assets,
        "sentiment": round(overall, 3),
        "signals": signals,
        "strategies": suggest_strategies(text),
    }


VIDEO_ID_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/|embed/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)


def parse_video_id(url_or_id: str) -> str | None:
    s = url_or_id.strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", s):
        return s
    m = VIDEO_ID_RE.search(s)
    return m.group(1) if m else None


def parse_rss(xml_text: str) -> list[dict]:
    """Entries from a YouTube channel RSS feed: video_id, title, published."""
    import xml.etree.ElementTree as ET

    ns = {
        "a": "http://www.w3.org/2005/Atom",
        "yt": "http://www.youtube.com/xml/schemas/2015",
    }
    root = ET.fromstring(xml_text)
    out = []
    for entry in root.findall("a:entry", ns):
        vid = entry.findtext("yt:videoId", default="", namespaces=ns)
        title = entry.findtext("a:title", default="", namespaces=ns)
        published = entry.findtext("a:published", default="", namespaces=ns)
        if vid:
            out.append({"video_id": vid, "title": title, "published": published})
    return out
