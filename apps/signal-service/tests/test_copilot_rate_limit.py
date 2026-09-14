"""The copilot's /ask endpoint is the only one in this service that spends
money per call (up to 6 model round-trips per question), so its rate limit is
a cost control, not a politeness measure. These tests prove the limit is
actually wired up — a decorator that silently no-ops would be worse than none,
since it reads as protection that isn't there.
"""
from __future__ import annotations

import pytest

from app.limiter import SLOWAPI_AVAILABLE
from app.routers.cryptobot import COPILOT_ASK_RATE_LIMIT

pytestmark = pytest.mark.skipif(
    not SLOWAPI_AVAILABLE,
    reason="slowapi is an optional dependency; without it the limiter is a no-op by design",
)

BOT_ID = "ratelimit-test-bot"


def _limit_count(spec: str) -> int:
    """'10/minute' -> 10"""
    return int(spec.split("/")[0])


@pytest.fixture
def bot(monkeypatch):
    """Register a bot directly in the in-memory registry.

    Going through POST /bots would need a strategies_store entry; the rate
    limiter runs before the handler either way, so a minimal bot is enough.
    """
    from app.cryptobot.bot import BotConfig, CryptoBot, _bots

    cfg = BotConfig(
        bot_id=BOT_ID, trader="tester", strategy_id=1, strategy_key="cci",
        strategy_params={}, symbol="BTC-USD", mode="dry_run",
    )
    _bots[BOT_ID] = CryptoBot(cfg)
    yield BOT_ID
    _bots.pop(BOT_ID, None)


def test_ask_is_rate_limited(client, bot):
    """Past the limit the endpoint must return 429.

    Note the requests before the limit return 503 here (no ANTHROPIC_API_KEY in
    tests) — that's the point: the limiter sits in front of the handler, so it
    caps the billable path regardless of how the handler would have finished.

    Sends 2*limit + 1 requests rather than limit + 1. slowapi uses a fixed
    window, so a burst that straddles the minute boundary can be split across
    two windows (e.g. 5 then 6 against a limit of 10) and never trip — rare,
    but a flaky cost-control test is worse than none. At 2*limit + 1, one
    window must contain at least limit + 1 requests however the split falls.
    """
    limit = _limit_count(COPILOT_ASK_RATE_LIMIT)
    codes = [
        client.post(f"/api/v1/cryptobot/bots/{bot}/copilot/ask", json={"message": "hi"}).status_code
        for _ in range(2 * limit + 1)
    ]

    assert 429 in codes, f"expected a 429 within {2 * limit + 1} requests, got {codes}"
    allowed = sum(1 for c in codes if c != 429)
    assert allowed <= 2 * limit, (
        f"limit is {COPILOT_ASK_RATE_LIMIT} but {allowed} requests got through; "
        f"got {codes}"
    )
    assert 200 not in codes, "no request should have reached the model without an API key"


def test_read_only_config_endpoint_is_not_limited_alongside_ask(client, bot):
    """The cheap read must stay usable — sharing /ask's budget would make the
    panel unable to render its controls once someone hit the ask limit."""
    codes = [
        client.get(f"/api/v1/cryptobot/bots/{bot}/copilot/config").status_code
        for _ in range(2 * _limit_count(COPILOT_ASK_RATE_LIMIT) + 2)
    ]

    assert all(c == 200 for c in codes), f"config should never be rate limited here: {codes}"
