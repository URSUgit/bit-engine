"""API-level tests over the real FastAPI app (offline: seeded temp storage,
no lifespan tasks). Includes regressions for the three live-verified bugs
fixed in the backend audit."""
import asyncio

# Seeded fixture covers 2022-01-01 .. ~2023-02-04; stay inside it so the
# data loader serves from cache and never touches the network.
RUN_BODY = {
    "symbol": "BTCUSDT",
    "strategy": "rsi",
    "interval": "1d",
    "start_date": "2022-01-15",
    "end_date": "2022-12-15",
}


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_strategies_listed(client):
    r = client.get("/api/v1/backtest/strategies")
    assert r.status_code == 200
    names = {s["name"] for s in r.json()}
    assert {"rsi", "ma_cross", "buy_and_hold"} <= names


def test_symbols_listed(client):
    r = client.get("/api/v1/backtest/symbols")
    assert r.status_code == 200
    assert len(r.json()) > 0


def test_backtest_run_on_seeded_data(client):
    r = client.post("/api/v1/backtest/run", json=RUN_BODY)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["symbol"] == "BTCUSDT"
    assert body["metrics"]["total_trades"] >= 0
    assert body["metrics"]["initial_capital"] == 10000.0


def test_walk_forward_endpoint(client):
    """Regression: router passed symbol/interval as direct kwargs that
    run_walk_forward() doesn't accept — every call 500'd."""
    r = client.post(
        "/api/v1/backtest/walk_forward",
        json={**RUN_BODY, "n_splits": 3, "train_pct": 0.7},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["folds"], "walk-forward must return at least one fold"
    for fold in body["folds"]:
        assert "in_sample_return" in fold
        assert "out_sample_return" in fold


def test_unknown_strategy_rejected(client):
    r = client.post("/api/v1/backtest/run", json={**RUN_BODY, "strategy": "nope"})
    assert r.status_code in (400, 422)


def test_binance_symbols_param_has_no_whitespace(monkeypatch):
    """Regression: json.dumps' default ', ' separator made Binance reject the
    symbols param with 400, silently killing the CoinGecko fallback."""
    import app.feeds.crypto as crypto

    captured = {}

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return []

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, params=None, headers=None):
            captured.update(params or {})
            return _Resp()

    monkeypatch.setattr(crypto.httpx, "AsyncClient", _Client)
    asyncio.run(crypto.fetch_binance_tickers(["BTCUSDT", "ETHUSDT"]))
    assert captured["symbols"] == '["BTCUSDT","ETHUSDT"]'
