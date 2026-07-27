"""YouTube scout: extraction heuristics, RSS/URL parsing, service plumbing."""
import pytest

from app.scout.extract import (
    ASSET_ALIASES,
    INDICATOR_STRATEGIES,
    extract,
    find_assets,
    parse_rss,
    parse_video_id,
    sentiment_score,
    suggest_strategies,
)


BULLISH_BTC = """
Welcome back everyone. Bitcoin is looking incredibly bullish right now — we just
had a breakout above resistance and the RSI reset from oversold. I'm buying this
dip and going long. The MACD is about to cross bullish on the daily. Ethereum
also looks strong, higher high after higher high, definite uptrend. If BTC holds
support I think we rally to new highs. Golden cross forming on the moving averages.
"""

BEARISH_SOL = """
Solana just got rejected at resistance again — this is a breakdown, a clear
downtrend. I'm selling my sol and might even short it. The chart is bearish,
death cross on the daily, momentum is gone. This looks like a correction at best
and a crash at worst. Dump incoming.
"""


def test_every_indicator_maps_to_a_real_strategy():
    from app.backtest.strategies import STRATEGIES

    for _, strategy, _ in INDICATOR_STRATEGIES:
        assert strategy in STRATEGIES, strategy


def test_find_assets_counts_and_ranks():
    assets = find_assets(BULLISH_BTC)
    symbols = [a["symbol"] for a in assets]
    assert symbols[0] == "BTC-USD"  # most mentioned
    assert "ETH-USD" in symbols
    top = assets[0]
    assert top["mentions"] >= 2  # "Bitcoin" + "BTC"


def test_sentiment_direction():
    assert sentiment_score(BULLISH_BTC) > 0.4
    assert sentiment_score(BEARISH_SOL) < -0.4
    assert sentiment_score("the weather is nice today") == 0.0


def test_extract_produces_buy_signal_for_bullish_btc():
    res = extract("BITCOIN BREAKOUT IMMINENT", BULLISH_BTC)
    assert res["engine"] == "heuristic"
    assert res["sentiment"] > 0
    btc = next((s for s in res["signals"] if s["asset"] == "BTC-USD"), None)
    assert btc is not None
    assert btc["direction"] == "buy"
    assert 0 < btc["confidence"] <= 0.9
    names = {s["strategy"] for s in res["strategies"]}
    assert "rsi" in names
    assert "macd" in names


def test_extract_produces_sell_signal_for_bearish_sol():
    res = extract("SOL crash warning", BEARISH_SOL)
    sol = next((s for s in res["signals"] if s["asset"] == "SOL-USD"), None)
    assert sol is not None
    assert sol["direction"] == "sell"


def test_suggest_strategies_dedupes_and_caps():
    text = "rsi rsi macd bollinger ichimoku supertrend vwap aroon cci"
    out = suggest_strategies(text, max_n=5)
    assert len(out) == 5
    assert len({s["strategy"] for s in out}) == 5


def test_parse_video_id_variants():
    vid = "dQw4w9WgXcQ"
    for form in (
        vid,
        f"https://www.youtube.com/watch?v={vid}",
        f"https://www.youtube.com/watch?feature=share&v={vid}",
        f"https://youtu.be/{vid}",
        f"https://www.youtube.com/shorts/{vid}",
        f"https://www.youtube.com/live/{vid}",
        f"https://www.youtube.com/embed/{vid}",
    ):
        assert parse_video_id(form) == vid, form
    assert parse_video_id("https://example.com/nope") is None
    assert parse_video_id("short") is None


def test_parse_rss_extracts_entries():
    xml = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <title>Test Channel</title>
  <entry>
    <yt:videoId>abcdefghijk</yt:videoId>
    <title>BTC to 100k?</title>
    <published>2026-07-09T00:00:00+00:00</published>
  </entry>
  <entry>
    <yt:videoId>lmnopqrstuv</yt:videoId>
    <title>ETH analysis</title>
    <published>2026-07-08T00:00:00+00:00</published>
  </entry>
</feed>"""
    entries = parse_rss(xml)
    assert [e["video_id"] for e in entries] == ["abcdefghijk", "lmnopqrstuv"]
    assert entries[0]["title"] == "BTC to 100k?"
    assert entries[0]["published"].startswith("2026-07-09")


def test_asset_aliases_map_to_known_symbol_styles():
    for symbol in set(ASSET_ALIASES.values()):
        assert symbol.isupper() or "=" in symbol


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_service_analyze_records_feed_without_network(monkeypatch):
    from app.scout import service as svc_mod

    svc = svc_mod.ScoutService()

    async def fake_transcript(video_id: str) -> str:
        return BULLISH_BTC

    async def fake_title(video_id: str) -> dict:
        return {"title": "Bitcoin breakout", "channel": "TestTV"}

    monkeypatch.setattr(svc, "_fetch_transcript", fake_transcript)
    monkeypatch.setattr(svc, "_fetch_title", fake_title)

    rec = await svc.analyze_video("abcdefghijk")
    assert rec["video_id"] == "abcdefghijk"
    assert rec["channel"] == "TestTV"
    assert rec["transcript_chars"] > 100
    assert rec["signals"], "expected at least one signal"
    assert list(svc.analyses)[0]["id"] == rec["id"]
    assert "abcdefghijk" in svc.seen

    # duplicate protection at poll level relies on `seen`
    assert rec["engine"] in ("heuristic", "llm")
