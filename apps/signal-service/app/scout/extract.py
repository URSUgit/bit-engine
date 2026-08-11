"""Heuristic extraction: turn a video transcript into assets, sentiment,
signals and strategy suggestions.

Pure functions, no I/O — the LLM path (service.py) produces the same shape
and falls back to this when no API key is configured or the call fails.
"""
from __future__ import annotations

import bisect
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

# Registry key -> human strategy label, used to build a named "strategy model"
# per video (trader + label + pair).
STRATEGY_LABELS: dict[str, str] = {
    "rsi_divergence": "RSI Divergence",
    "rsi": "RSI Reversal",
    "macd": "MACD Crossover",
    "bollinger": "Bollinger Band Squeeze",
    "ichimoku": "Ichimoku Cloud",
    "supertrend": "Supertrend Follow",
    "stoch_rsi": "Stochastic RSI",
    "vwap_reversion": "VWAP Reversion",
    "heikin_ashi": "Heikin-Ashi Trend",
    "williams_r": "Williams %R",
    "aroon": "Aroon Trend",
    "cci": "CCI Extremes",
    "keltner_channel": "Keltner Channel Breakout",
    "psar": "Parabolic SAR Trail",
    "elder_impulse": "Elder Impulse System",
    "donchian_channel": "Donchian Breakout",
    "ma_cross": "Moving Average Cross",
    "triple_ema": "Triple EMA Trend",
    "dema_cross": "DEMA Cross",
    "scalp_ema": "EMA Scalp",
    "breakout_scalp": "Breakout Scalp",
    "momentum": "Momentum Run",
    "funding_arb": "Funding Rate Arb",
    "buy_and_hold": "Long-Term Hold",
}


def strategy_label(key: str) -> str:
    return STRATEGY_LABELS.get(key, key.replace("_", " ").title())


# Position-sizing / risk-management language -> the "significant clues" a
# trader drops about how they'd actually run the strategy.
_CLUE_PATTERNS: dict[str, re.Pattern[str]] = {
    "position_pct": re.compile(
        r"(\d{1,3}(?:\.\d+)?)\s?%\s*(?:of\s+(?:my|your|the|their)?\s*"
        r"(?:portfolio|account|capital|balance)|position\s*siz\w*|allocat\w*)"
    ),
    "risk_pct": re.compile(r"risk(?:ing)?\s*(?:only\s*)?(\d{1,3}(?:\.\d+)?)\s?%"),
    "stop_loss_pct": re.compile(
        r"stop[\s-]?loss\D{0,12}?(\d{1,3}(?:\.\d+)?)\s?%"
        r"|(\d{1,3}(?:\.\d+)?)\s?%\D{0,12}?stop[\s-]?loss"
    ),
    "take_profit_pct": re.compile(
        r"take[\s-]?profit\D{0,12}?(\d{1,3}(?:\.\d+)?)\s?%"
        r"|(\d{1,3}(?:\.\d+)?)\s?%\D{0,12}?take[\s-]?profit"
    ),
    "leverage": re.compile(r"(\d{1,3}(?:\.\d+)?)\s?x\s*leverage"),
}
_CLUE_LABELS = {
    "position_pct": ("position size", "%"),
    "risk_pct": ("risk per trade", "%"),
    "stop_loss_pct": ("stop loss", "%"),
    "take_profit_pct": ("take profit", "%"),
    "leverage": ("leverage", "x"),
}


_GUEST_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bft\.\s*\w"),
    re.compile(r"\bfeat\.\s*\w"),
    re.compile(r"\bw/\s*\w"),
    re.compile(r"\binterview\b"),
    re.compile(r"\bguest\b"),
    re.compile(r"\bco-?host\b"),
    re.compile(r"\bvs\b"),
]


def detect_guest(title: str, description: str = "") -> dict:
    """Lightweight guest/co-host detection from title/description text only
    (no audio diarization) — flags likely multi-speaker videos so a strategy
    claim isn't blindly attributed to the channel owner."""
    text = f"{title}\n{description}".lower()
    for pattern in _GUEST_PATTERNS:
        m = pattern.search(text)
        if m:
            return {"multi_speaker": True, "note": m.group(0).strip()}
    return {"multi_speaker": False, "note": None}


def extract_frame_findings(ocr_text: str) -> dict:
    """Assets/clues read off on-screen charts/tickers via OCR, reusing the
    same text heuristics as spoken transcript analysis."""
    return {
        "assets": find_assets(ocr_text),
        "clues": extract_clues(ocr_text),
    }


def join_transcript(segments: list[dict]) -> tuple[str, list[tuple[int, float]]]:
    """Join timestamped transcript chunks ([{text, start}, ...]) into the
    flat string every heuristic here operates on, plus a parallel
    (char_offset, start_seconds) index so a later regex match's position
    can be mapped back to the moment it was actually said — the anchor a
    real backtest replays from."""
    parts: list[str] = []
    offset_index: list[tuple[int, float]] = []
    pos = 0
    for seg in segments:
        chunk = (seg.get("text") or "").strip()
        if not chunk:
            continue
        if parts:
            pos += 1  # the join(" ") separator
        offset_index.append((pos, float(seg.get("start") or 0.0)))
        parts.append(chunk)
        pos += len(chunk)
    return " ".join(parts), offset_index


def timestamp_at(offset_index: list[tuple[int, float]] | None, char_pos: int) -> float | None:
    """Video second the transcript character at `char_pos` was spoken,
    per an index built by `join_transcript`."""
    if not offset_index or char_pos < 0:
        return None
    i = bisect.bisect_right(offset_index, (char_pos, float("inf"))) - 1
    if i < 0:
        return None
    return offset_index[i][1]


def extract_clues(text: str, offset_index: list[tuple[int, float]] | None = None, base_offset: int = 0) -> dict:
    """Position-sizing / risk clues a trader lets slip: % of portfolio,
    risk per trade, stop-loss/take-profit distance, leverage. When
    `offset_index` (from `join_transcript`) is given, also records the
    video timestamp each clue was said at."""
    low = text.lower()
    values: dict[str, float | None] = {}
    notes: list[str] = []
    timestamps: dict[str, float | None] = {}
    for key, pattern in _CLUE_PATTERNS.items():
        m = pattern.search(low)
        val = None
        if m:
            group = next((g for g in m.groups() if g is not None), None)
            val = float(group) if group is not None else None
        values[key] = val
        if val is not None:
            label, unit = _CLUE_LABELS[key]
            notes.append(f"{label} {val:g}{unit}")
            timestamps[key] = timestamp_at(offset_index, m.start() + base_offset)
    values["notes"] = notes
    values["timestamps"] = timestamps
    return values


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


def _asset_mentions(text: str, alias_symbols: dict[str, str], symbol: str, window: int = 220) -> list[tuple[float, int]]:
    """(sentiment_score, match_start) for every mention window of
    `symbol`'s aliases — the position lets a caller anchor the mention to
    a video timestamp via `timestamp_at`."""
    low = text.lower()
    hits: list[tuple[float, int]] = []
    for alias, sym in alias_symbols.items():
        if sym != symbol:
            continue
        for m in re.finditer(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", low):
            chunk = low[max(0, m.start() - window): m.end() + window]
            hits.append((sentiment_score(chunk), m.start()))
    return hits


def asset_direction(text: str, alias_symbols: dict[str, str], symbol: str, window: int = 220) -> float:
    """Sentiment in windows around each mention of `symbol`'s aliases."""
    scores = [s for s, _ in _asset_mentions(text, alias_symbols, symbol, window) if s != 0.0]
    if not scores:
        return 0.0
    return sum(scores) / len(scores)


def suggest_strategies(
    text: str,
    offset_index: list[tuple[int, float]] | None = None,
    base_offset: int = 0,
    max_n: int = 5,
) -> list[dict]:
    low = text.lower()
    out: list[dict] = []
    seen: set[str] = set()
    for pattern, strategy, why in INDICATOR_STRATEGIES:
        if strategy in seen:
            continue
        m = pattern.search(low)
        if m:
            seen.add(strategy)
            ts = timestamp_at(offset_index, m.start() + base_offset)
            out.append({"strategy": strategy, "why": why, "params": {}, "timestamp_s": ts})
            if len(out) >= max_n:
                break
    return out


def build_models(strategies: list[dict], assets: list[dict], clues: dict, trader: str) -> list[dict]:
    """Turn raw strategy suggestions into named, presentable trading models:
    "<Trader> · <Strategy Label>" with its traded pairs and sizing clues.
    Each model carries the video timestamp (`timestamp_s`) it was said at —
    the strategy's own mention if known, else the earliest sizing clue —
    so a real backtest can be anchored to that exact moment."""
    pairs = [a["symbol"] for a in assets[:3]]
    clue_timestamps = [t for t in (clues.get("timestamps") or {}).values() if t is not None]
    fallback_ts = min(clue_timestamps) if clue_timestamps else None
    models = []
    for s in strategies:
        label = strategy_label(s["strategy"])
        name = f"{trader} · {label}" if trader else label
        models.append({
            "name": name,
            "trader": trader or "Unknown trader",
            "strategy": s["strategy"],
            "label": label,
            "why": s["why"],
            "params": s.get("params") or {},
            "pairs": pairs,
            "position_pct": clues.get("position_pct"),
            "risk_pct": clues.get("risk_pct"),
            "stop_loss_pct": clues.get("stop_loss_pct"),
            "take_profit_pct": clues.get("take_profit_pct"),
            "leverage": clues.get("leverage"),
            "timestamp_s": s.get("timestamp_s") if s.get("timestamp_s") is not None else fallback_ts,
        })
    return models


def extract(
    title: str,
    transcript: str,
    channel: str = "",
    segments: list[dict] | None = None,
) -> dict:
    """Full heuristic analysis of one video. `segments` (optional
    timestamped transcript chunks from `join_transcript`/`_fetch_transcript`
    — [{text, start}]) let every extracted signal/strategy/clue carry the
    video timestamp it came from, so a real backtest can be anchored to the
    trader's exact stated moment."""
    text = f"{title}\n{transcript}"
    base_offset = len(title) + 1
    offset_index = join_transcript(segments)[1] if segments else None
    assets = find_assets(text)
    overall = sentiment_score(text)
    signals: list[dict] = []
    for a in assets[:5]:
        hits = _asset_mentions(text, ASSET_ALIASES, a["symbol"])
        nonzero = [s for s, _ in hits if s != 0.0]
        local = sum(nonzero) / len(nonzero) if nonzero else 0.0
        score = local if local != 0.0 else overall
        if abs(score) < 0.15:
            continue
        direction = "buy" if score > 0 else "sell"
        confidence = round(min(0.9, 0.35 + 0.4 * abs(score) + 0.03 * min(a["mentions"], 8)), 2)
        ts = None
        if offset_index is not None and hits:
            pos = max(hits, key=lambda h: abs(h[0]))[1]
            ts = timestamp_at(offset_index, pos + base_offset)
        signals.append({
            "asset": a["symbol"],
            "direction": direction,
            "confidence": confidence,
            "reasoning": f"{a['mentions']} mentions; {'bullish' if score > 0 else 'bearish'} language near them (score {score:+.2f})",
            "timestamp_s": ts,
        })
    strategies = suggest_strategies(text, offset_index, base_offset)
    clues = extract_clues(text, offset_index, base_offset)
    return {
        "engine": "heuristic",
        "assets": assets,
        "sentiment": round(overall, 3),
        "signals": signals,
        "strategies": strategies,
        "clues": clues,
        "models": build_models(strategies, assets, clues, channel),
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
