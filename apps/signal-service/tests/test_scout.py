"""YouTube scout: extraction heuristics, RSS/URL parsing, service plumbing."""
import pytest

from app.scout.extract import (
    ASSET_ALIASES,
    INDICATOR_STRATEGIES,
    build_models,
    detect_guest,
    extract,
    extract_clues,
    extract_frame_findings,
    find_assets,
    join_transcript,
    parse_rss,
    parse_video_id,
    sentiment_score,
    strategy_label,
    suggest_strategies,
    timestamp_at,
)

@pytest.fixture(autouse=True)
def _isolate_strategies_store(tmp_path, monkeypatch):
    """analyze_video/analyze_video_live persist extracted models via the
    module-level `strategies_store` singleton — redirect it to a throwaway
    file so these tests never write into the real data/scout_strategies.json."""
    from app.scout import service as svc_mod
    from app.scout.strategies_store import StrategiesStore

    monkeypatch.setattr(svc_mod, "strategies_store", StrategiesStore.__new__(StrategiesStore))
    svc_mod.strategies_store.entries = []
    import itertools
    svc_mod.strategies_store._ids = itertools.count(1)
    monkeypatch.setattr(svc_mod.strategies_store, "_save", lambda: None)


CLUES_TEXT = """
I'm putting 5% of my portfolio into this trade, risking 1.5% per trade with a
3% stop loss and a 9% take profit target, using 10x leverage on the futures
position.
"""


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

    async def fake_transcript(video_id: str) -> list[dict]:
        return [{"text": BULLISH_BTC, "start": 42.0}]

    async def fake_title(video_id: str) -> dict:
        return {"title": "Bitcoin breakout", "channel": "TestTV"}

    async def fake_published_at(video_id: str) -> str:
        return "2026-07-01"

    monkeypatch.setattr(svc, "_fetch_transcript", fake_transcript)
    monkeypatch.setattr(svc, "_fetch_title", fake_title)
    monkeypatch.setattr(svc, "_fetch_published_at", fake_published_at)

    rec = await svc.analyze_video("abcdefghijk")
    assert rec["video_id"] == "abcdefghijk"
    assert rec["channel"] == "TestTV"
    assert rec["transcript_chars"] > 100
    assert rec["signals"], "expected at least one signal"
    assert list(svc.analyses)[0]["id"] == rec["id"]
    assert "abcdefghijk" in svc.seen
    assert rec["published_at"] == "2026-07-01"

    # duplicate protection at poll level relies on `seen`
    assert rec["engine"] in ("heuristic", "llm")

    if rec["engine"] == "heuristic":
        assert any(s.get("timestamp_s") == 42.0 for s in rec["signals"])


@pytest.mark.anyio
async def test_analyze_video_falls_back_to_ocr_when_no_transcript(monkeypatch):
    """No captions -> background analyze_video now tries chart/ticker OCR
    instead of giving up on a title-only guess (previously this path never
    touched vision.py at all — only the manual analyze_video_live did)."""
    from app.scout import service as svc_mod

    svc = svc_mod.ScoutService()

    async def fake_transcript(video_id: str) -> list[dict]:
        raise RuntimeError("no captions available")

    async def fake_title(video_id: str) -> dict:
        return {"title": "Live trading session", "channel": "TestTV"}

    async def fake_published_at(video_id: str) -> str:
        return "2026-07-01"

    async def fake_analyze_frames(video_id, n=None):
        yield {"stage": "frame", "index": 0, "total": 1, "text": "BTC/USDT 43200 breakout"}
        yield {
            "stage": "result",
            "skipped": False,
            "reason": None,
            "frame_texts": [BULLISH_BTC],
        }

    monkeypatch.setattr(svc, "_fetch_transcript", fake_transcript)
    monkeypatch.setattr(svc, "_fetch_title", fake_title)
    monkeypatch.setattr(svc, "_fetch_published_at", fake_published_at)
    monkeypatch.setattr(svc_mod.vision, "analyze_frames", fake_analyze_frames)

    async def fail_if_called(video_id: str) -> list[dict]:
        raise AssertionError("audio fallback should not run once OCR finds assets")

    monkeypatch.setattr(svc_mod.audio, "transcribe", fail_if_called)

    rec = await svc.analyze_video("abcdefghijk")
    assert rec["analysis_source"] == "vision"
    assert rec["transcript_error"] == "RuntimeError"
    assert rec["assets"], "expected OCR-derived assets"


@pytest.mark.anyio
async def test_analyze_video_falls_back_to_audio_when_ocr_finds_nothing(monkeypatch):
    """No captions AND OCR finds nothing usable -> falls back further to
    audio transcription rather than settling for a title-only guess."""
    from app.scout import service as svc_mod

    svc = svc_mod.ScoutService()

    async def fake_transcript(video_id: str) -> list[dict]:
        raise RuntimeError("no captions available")

    async def fake_title(video_id: str) -> dict:
        return {"title": "Live trading session", "channel": "TestTV"}

    async def fake_published_at(video_id: str) -> str:
        return "2026-07-01"

    async def fake_analyze_frames(video_id, n=None):
        yield {"stage": "result", "skipped": True, "reason": "no_frames", "frame_texts": []}

    async def fake_audio_transcribe(video_id: str) -> list[dict]:
        return [{"text": BULLISH_BTC, "start": 5.0}]

    monkeypatch.setattr(svc, "_fetch_transcript", fake_transcript)
    monkeypatch.setattr(svc, "_fetch_title", fake_title)
    monkeypatch.setattr(svc, "_fetch_published_at", fake_published_at)
    monkeypatch.setattr(svc_mod.vision, "analyze_frames", fake_analyze_frames)
    monkeypatch.setattr(svc_mod.audio, "transcribe", fake_audio_transcribe)

    rec = await svc.analyze_video("abcdefghijk")
    assert rec["analysis_source"] == "audio"
    assert rec["assets"], "expected audio-derived assets"
    assert rec["transcript_chars"] > 100


@pytest.mark.anyio
async def test_analyze_video_stays_title_only_when_all_fallbacks_empty(monkeypatch):
    """No captions, OCR skipped, audio transcription empty -> still degrades
    to the pre-existing title-only heuristic rather than erroring."""
    from app.scout import service as svc_mod

    svc = svc_mod.ScoutService()

    async def fake_transcript(video_id: str) -> list[dict]:
        raise RuntimeError("no captions available")

    async def fake_title(video_id: str) -> dict:
        return {"title": "Bitcoin update", "channel": "TestTV"}

    async def fake_published_at(video_id: str) -> str:
        return "2026-07-01"

    async def fake_analyze_frames(video_id, n=None):
        yield {"stage": "result", "skipped": True, "reason": "no_frames", "frame_texts": []}

    async def fake_audio_transcribe(video_id: str) -> list[dict]:
        return []

    monkeypatch.setattr(svc, "_fetch_transcript", fake_transcript)
    monkeypatch.setattr(svc, "_fetch_title", fake_title)
    monkeypatch.setattr(svc, "_fetch_published_at", fake_published_at)
    monkeypatch.setattr(svc_mod.vision, "analyze_frames", fake_analyze_frames)
    monkeypatch.setattr(svc_mod.audio, "transcribe", fake_audio_transcribe)

    rec = await svc.analyze_video("abcdefghijk")
    assert rec["analysis_source"] == "title"
    assert rec["transcript_chars"] == 0


@pytest.mark.anyio
async def test_analyze_video_bg_watch_fallback_can_be_disabled(monkeypatch):
    """SCOUT_BG_WATCH_FALLBACK=0 keeps the old behavior: no captions ->
    straight to title-only, vision/audio never touched."""
    from app.scout import service as svc_mod

    monkeypatch.setattr(svc_mod, "BG_WATCH_FALLBACK", False)
    svc = svc_mod.ScoutService()

    async def fake_transcript(video_id: str) -> list[dict]:
        raise RuntimeError("no captions available")

    async def fake_title(video_id: str) -> dict:
        return {"title": "Bitcoin update", "channel": "TestTV"}

    async def fake_published_at(video_id: str) -> str:
        return "2026-07-01"

    async def fail_if_called(*args, **kwargs):
        raise AssertionError("vision/audio should not run when the fallback is disabled")

    monkeypatch.setattr(svc, "_fetch_transcript", fake_transcript)
    monkeypatch.setattr(svc, "_fetch_title", fake_title)
    monkeypatch.setattr(svc, "_fetch_published_at", fake_published_at)
    monkeypatch.setattr(svc_mod.vision, "analyze_frames", fail_if_called)
    monkeypatch.setattr(svc_mod.audio, "transcribe", fail_if_called)

    rec = await svc.analyze_video("abcdefghijk")
    assert rec["analysis_source"] == "title"


def test_extract_clues_parses_sizing_language():
    clues = extract_clues(CLUES_TEXT)
    assert clues["position_pct"] == 5.0
    assert clues["risk_pct"] == 1.5
    assert clues["stop_loss_pct"] == 3.0
    assert clues["take_profit_pct"] == 9.0
    assert clues["leverage"] == 10.0
    assert len(clues["notes"]) == 5


def test_extract_clues_empty_when_no_sizing_language():
    clues = extract_clues(BULLISH_BTC)
    assert clues["position_pct"] is None
    assert clues["notes"] == []


def test_build_models_names_strategy_after_trader_and_label():
    strategies = suggest_strategies("rsi macd")
    assets = find_assets(BULLISH_BTC)
    clues = extract_clues(CLUES_TEXT)
    models = build_models(strategies, assets, clues, "Crypto Trader Joe")
    assert models
    m = models[0]
    assert m["name"].startswith("Crypto Trader Joe · ")
    assert m["trader"] == "Crypto Trader Joe"
    assert m["label"] == strategy_label(strategies[0]["strategy"])
    assert m["pairs"] == [a["symbol"] for a in assets[:3]]
    assert m["position_pct"] == 5.0
    assert m["leverage"] == 10.0


def test_extract_includes_named_models_with_trader():
    res = extract("BITCOIN BREAKOUT IMMINENT", BULLISH_BTC + CLUES_TEXT, channel="Crypto Trader Joe")
    assert res["models"]
    assert all(m["trader"] == "Crypto Trader Joe" for m in res["models"])
    assert all(m["name"].startswith("Crypto Trader Joe · ") for m in res["models"])
    assert res["clues"]["position_pct"] == 5.0


def test_strategy_label_falls_back_to_title_case_for_unknown_key():
    assert strategy_label("rsi") == "RSI Reversal"
    assert strategy_label("totally_new_key") == "Totally New Key"


SEARCH_HTML_FIXTURE = (
    '{"videoRenderer":{"ownerText":{"runs":[{"text":"Crypto Trader Joe",'
    '"navigationEndpoint":{"commandMetadata":{"webCommandMetadata":{"url":'
    '"/@cryptotraderjoe"}},"browseEndpoint":{"browseId":"UC1234567890123456789012"}}]}}},'
    '{"videoRenderer":{"ownerText":{"runs":[{"text":"Swing Sarah",'
    '"navigationEndpoint":{"commandMetadata":{"webCommandMetadata":{"url":'
    '"/@swingsarah"}},"browseEndpoint":{"browseId":"UC9876543210987654321098"}}]}}}'
)


@pytest.mark.anyio
async def test_discover_channels_parses_search_html(monkeypatch):
    from app.scout import service as svc_mod

    svc = svc_mod.ScoutService()
    svc.channels = {}

    class FakeResponse:
        text = SEARCH_HTML_FIXTURE

        def raise_for_status(self):
            return None

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url):
            return FakeResponse()

    monkeypatch.setattr(svc_mod.httpx, "AsyncClient", lambda *a, **k: FakeClient())

    candidates = await svc.discover_channels("crypto day trading strategy")
    ids = {c["id"] for c in candidates}
    assert "UC1234567890123456789012" in ids
    assert "UC9876543210987654321098" in ids
    assert svc.discovery_log[0]["query"] == "crypto day trading strategy"
    assert svc.discovery_log[0]["found"] == len(candidates)
    assert len(svc.discovered) == len(candidates)


@pytest.mark.anyio
async def test_latest_video_returns_most_recent_rss_entry(monkeypatch):
    from app.scout import service as svc_mod

    svc = svc_mod.ScoutService()

    class FakeResponse:
        text = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">'
            "<entry><yt:videoId>abcdefghijk</yt:videoId><title>BTC to 100k?</title>"
            "<published>2026-07-09T00:00:00+00:00</published></entry>"
            "<entry><yt:videoId>lmnopqrstuv</yt:videoId><title>ETH analysis</title>"
            "<published>2026-07-08T00:00:00+00:00</published></entry>"
            "</feed>"
        )

        def raise_for_status(self):
            return None

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url):
            return FakeResponse()

    monkeypatch.setattr(svc_mod.httpx, "AsyncClient", lambda *a, **k: FakeClient())

    video = await svc.latest_video("UC1234567890123456789012")

    assert video == {
        "video_id": "abcdefghijk",
        "title": "BTC to 100k?",
        "url": "https://www.youtube.com/watch?v=abcdefghijk",
    }


@pytest.mark.anyio
async def test_latest_video_returns_none_when_feed_empty(monkeypatch):
    from app.scout import service as svc_mod

    svc = svc_mod.ScoutService()

    class FakeResponse:
        text = '<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom"></feed>'

        def raise_for_status(self):
            return None

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url):
            return FakeResponse()

    monkeypatch.setattr(svc_mod.httpx, "AsyncClient", lambda *a, **k: FakeClient())

    video = await svc.latest_video("UC1234567890123456789012")

    assert video is None


@pytest.mark.anyio
async def test_quick_backtest_returns_win_rate(monkeypatch):
    """Regression: quick_backtest used to read PerformanceMetrics.win_rate,
    which doesn't exist (the field is win_rate_pct) and raised AttributeError
    on every single backtest-now click."""
    from app.scout import service as svc_mod

    svc = svc_mod.ScoutService()
    svc.channels = {}
    svc.analyses.appendleft({
        "id": 1,
        "video_id": "abc123",
        "assets": [{"symbol": "BTC-USD", "mentions": 3}],
        "strategies": [{"strategy": "buy_and_hold", "why": "test", "params": {}}],
    })

    result = await svc.quick_backtest(1, 0)
    assert result["strategy"] == "buy_and_hold"
    assert result["symbol"] == "BTC-USD"
    assert isinstance(result["win_rate"], float)


@pytest.mark.anyio
async def test_auto_discover_and_watch_respects_cap(monkeypatch):
    from app.scout import service as svc_mod

    svc = svc_mod.ScoutService()
    svc.channels = {}
    monkeypatch.setattr(svc_mod, "MAX_AUTO_CHANNELS", 1)

    async def fake_discover(query, limit=4):
        return [
            {"id": "UC1234567890123456789012", "name": "Crypto Trader Joe", "query": query},
            {"id": "UC9876543210987654321098", "name": "Swing Sarah", "query": query},
        ]

    async def fake_watch(ref, auto=False, query=None):
        ch = {"id": ref, "name": ref, "auto": auto, "found_via": query}
        svc.channels[ref] = ch
        return ch

    monkeypatch.setattr(svc, "discover_channels", fake_discover)
    monkeypatch.setattr(svc, "watch", fake_watch)

    watched = await svc.auto_discover_and_watch()
    assert len(watched) == 1
    assert svc.channels[watched[0]["id"]]["auto"] is True

    # cap already reached: a second cycle watches nothing more
    watched2 = await svc.auto_discover_and_watch()
    assert watched2 == []


@pytest.mark.parametrize("title", [
    "Interview with a pro trader",
    "BTC talk ft. Jane",
    "Trading w/ my co-host",
    "Bull vs Bear: crypto outlook",
])
def test_detect_guest_flags_multi_speaker_titles(title):
    result = detect_guest(title)
    assert result["multi_speaker"] is True
    assert result["note"]


def test_detect_guest_false_for_solo_title():
    result = detect_guest("Bitcoin technical analysis this week")
    assert result["multi_speaker"] is False
    assert result["note"] is None


def test_extract_frame_findings_reuses_asset_and_clue_heuristics():
    ocr_text = "BTC/USDT 43,200 stop loss 2%"
    findings = extract_frame_findings(ocr_text)
    symbols = {a["symbol"] for a in findings["assets"]}
    assert "BTC-USD" in symbols
    assert findings["clues"]["stop_loss_pct"] == 2.0


@pytest.mark.anyio
async def test_service_analyze_video_live_yields_stages_and_records(monkeypatch):
    from app.scout import service as svc_mod

    svc = svc_mod.ScoutService()
    svc.channels = {}

    async def fake_transcript(video_id: str) -> list[dict]:
        return [{"text": BULLISH_BTC, "start": 10.0}]

    async def fake_title(video_id: str) -> dict:
        return {"title": "Bitcoin breakout", "channel": "TestTV"}

    async def fake_published_at(video_id: str) -> str:
        return "2026-07-01"

    async def fake_analyze_frames(video_id, n=None):
        yield {"stage": "frame", "index": 0, "total": 1, "text": "BTC/USDT 43200 stop loss 2%"}
        yield {
            "stage": "result",
            "skipped": False,
            "reason": None,
            "frame_texts": ["BTC/USDT 43200 stop loss 2%"],
        }

    monkeypatch.setattr(svc, "_fetch_transcript", fake_transcript)
    monkeypatch.setattr(svc, "_fetch_title", fake_title)
    monkeypatch.setattr(svc, "_fetch_published_at", fake_published_at)
    monkeypatch.setattr(svc_mod.vision, "analyze_frames", fake_analyze_frames)

    events = [e async for e in svc.analyze_video_live("abcdefghijk")]
    stages = [e["stage"] for e in events]
    for expected in (
        "resolving", "fetching_title", "fetching_transcript",
        "extracting_signals", "checking_guest", "ocr_frame",
        "merging_frame_findings", "done",
    ):
        assert expected in stages, (expected, stages)

    done = next(e for e in events if e["stage"] == "done")
    record = done["record"]
    assert record["multi_speaker"] is False
    assert record["published_at"] == "2026-07-01"
    assert record["frame_findings"]["clues"]["stop_loss_pct"] == 2.0
    assert record["clues"]["stop_loss_pct"] == 2.0  # filled from frame, transcript had none
    assert list(svc.analyses)[0]["id"] == record["id"]
    assert "abcdefghijk" in svc.seen


@pytest.mark.anyio
async def test_service_analyze_video_live_skips_frames_gracefully(monkeypatch):
    from app.scout import service as svc_mod

    svc = svc_mod.ScoutService()
    svc.channels = {}

    async def fake_transcript(video_id: str) -> list[dict]:
        return [{"text": BULLISH_BTC, "start": 10.0}]

    async def fake_title(video_id: str) -> dict:
        return {"title": "Bitcoin breakout", "channel": "TestTV"}

    async def fake_published_at(video_id: str) -> str:
        return "2026-07-01"

    async def fake_analyze_frames(video_id, n=None):
        yield {"stage": "result", "skipped": True, "reason": "too_long", "frame_texts": []}

    monkeypatch.setattr(svc, "_fetch_transcript", fake_transcript)
    monkeypatch.setattr(svc, "_fetch_title", fake_title)
    monkeypatch.setattr(svc, "_fetch_published_at", fake_published_at)
    monkeypatch.setattr(svc_mod.vision, "analyze_frames", fake_analyze_frames)

    events = [e async for e in svc.analyze_video_live("abcdefghijk")]
    stages = [e["stage"] for e in events]
    assert "frames_skipped" in stages
    done = next(e for e in events if e["stage"] == "done")
    assert done["record"]["frame_findings"] is None


# ─── transcript timestamp anchoring ────────────────────────────────────────


def test_join_transcript_builds_char_offset_to_timestamp_index():
    segments = [{"text": "hello world", "start": 1.0}, {"text": "bitcoin is bullish", "start": 5.5}]
    text, offset_index = join_transcript(segments)
    assert text == "hello world bitcoin is bullish"
    assert timestamp_at(offset_index, 0) == 1.0
    assert timestamp_at(offset_index, 6) == 1.0  # "world" still in the first chunk
    assert timestamp_at(offset_index, text.index("bitcoin")) == 5.5


def test_timestamp_at_returns_none_without_index_or_negative_pos():
    assert timestamp_at(None, 5) is None
    assert timestamp_at([(0, 1.0)], -1) is None


def test_extract_attaches_timestamps_when_segments_given():
    segments = [{"text": "intro chit chat", "start": 0.0}, {"text": BULLISH_BTC, "start": 30.0}]
    transcript, _ = join_transcript(segments)
    res = extract("BITCOIN BREAKOUT IMMINENT", transcript, segments=segments)
    assert res["signals"], "expected at least one signal"
    btc_signal = next(s for s in res["signals"] if s["asset"] == "BTC-USD")
    assert btc_signal["timestamp_s"] == 30.0
    for strat in res["strategies"]:
        assert strat["timestamp_s"] == 30.0
    assert res["clues"]["timestamps"] == {}  # BULLISH_BTC has no sizing clues


def test_extract_without_segments_leaves_timestamps_none():
    res = extract("BITCOIN BREAKOUT IMMINENT", BULLISH_BTC)
    for s in res["signals"]:
        assert s["timestamp_s"] is None
    for strat in res["strategies"]:
        assert strat["timestamp_s"] is None


def test_build_models_uses_clue_timestamp_as_fallback():
    segments = [{"text": CLUES_TEXT, "start": 77.0}]
    _, offset_index = join_transcript(segments)
    clues = extract_clues(CLUES_TEXT, offset_index, base_offset=0)
    assert clues["timestamps"]["stop_loss_pct"] == 77.0
    strategies = [{"strategy": "rsi", "why": "rsi discussed", "params": {}, "timestamp_s": None}]
    models = build_models(strategies, [{"symbol": "BTC-USD", "mentions": 3}], clues, "Trader Joe")
    assert models[0]["timestamp_s"] == 77.0


# ─── anchored (timestamp-real) backtest ────────────────────────────────────


class _FakeBar:
    def __init__(self, ts, o, h, l, c):
        from datetime import datetime, timezone

        self.timestamp = datetime.fromtimestamp(ts, tz=timezone.utc)
        self.open = o
        self.high = h
        self.low = l
        self.close = c
        self.volume = 1.0


@pytest.mark.anyio
async def test_anchored_backtest_hits_target(monkeypatch):
    from datetime import datetime, timedelta, timezone

    from app.scout import service as svc_mod

    svc = svc_mod.ScoutService()
    published = datetime(2026, 6, 1, tzinfo=timezone.utc)
    entry_dt = published + timedelta(seconds=120)
    bars = [
        _FakeBar(int((entry_dt - timedelta(hours=1)).timestamp()), 100, 100, 99, 100),
        _FakeBar(int(entry_dt.timestamp()), 100, 101, 100, 100),
        _FakeBar(int((entry_dt + timedelta(hours=1)).timestamp()), 100, 115, 99, 112),  # target hit
        _FakeBar(int((entry_dt + timedelta(hours=2)).timestamp()), 112, 112, 60, 60),  # would-be stop, ignored
    ]

    class FakeLoader:
        async def load(self, symbol, start, end, interval):
            return bars

    import app.backtest.data as data_mod
    monkeypatch.setattr(data_mod, "HistoricalDataLoader", lambda: FakeLoader())

    svc.analyses.appendleft({
        "id": 1,
        "published_at": published.isoformat(),
        "signals": [{"asset": "BTC-USD", "direction": "buy", "confidence": 0.8, "reasoning": "x", "timestamp_s": 120.0}],
        "clues": {"stop_loss_pct": 5.0, "take_profit_pct": 10.0, "timestamps": {}},
    })

    result = await svc.anchored_backtest(1, 0)
    assert result["symbol"] == "BTC-USD"
    assert result["direction"] == "buy"
    assert result["outcome"] == "target_hit"
    assert result["entry_price"] == 100
    assert result["exit_price"] == 110.0  # 100 * 1.10
    assert result["pnl_pct"] == 10.0
    assert result["defaulted_risk_params"] is False


@pytest.mark.anyio
async def test_anchored_backtest_raises_without_published_at():
    from app.scout import service as svc_mod

    svc = svc_mod.ScoutService()
    svc.analyses.appendleft({
        "id": 2,
        "published_at": None,
        "signals": [{"asset": "BTC-USD", "direction": "buy", "confidence": 0.8, "reasoning": "x", "timestamp_s": None}],
        "clues": {},
    })
    with pytest.raises(ValueError, match="publish date"):
        await svc.anchored_backtest(2, 0)


@pytest.mark.anyio
async def test_anchored_backtest_unknown_analysis_raises():
    from app.scout import service as svc_mod

    svc = svc_mod.ScoutService()
    with pytest.raises(ValueError, match="Unknown analysis id"):
        await svc.anchored_backtest(999, 0)
