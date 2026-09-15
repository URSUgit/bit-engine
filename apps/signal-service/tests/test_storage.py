"""DuckDB bar storage: round-trips, idempotency, and the concurrent-writer
regression that crashed startup auto-seed (PK violation on plain INSERT)."""
from conftest import make_bars


def test_upsert_and_read_back(seeded_storage, bars_400):
    got = seeded_storage.get_bars("BTCUSDT", "1d", 0, 2**33)
    assert len(got) == len(bars_400)
    assert got[0].close == bars_400[0].close
    assert got[-1].ts == bars_400[-1].ts


def test_reupsert_is_idempotent(seeded_storage, bars_400):
    seeded_storage.upsert_bars("BTCUSDT", "1d", bars_400, "test_fixture")
    assert len(seeded_storage.get_bars("BTCUSDT", "1d", 0, 2**33)) == len(bars_400)


def test_duplicate_ts_within_batch_does_not_raise(seeded_storage):
    """Regression: a batch containing the same timestamp twice used to hit
    'PRIMARY KEY constraint violated' via the plain INSERT path."""
    bars = make_bars(10, seed=7)
    batch = bars + [bars[-1]]  # duplicate final timestamp
    seeded_storage.upsert_bars("DUPTEST", "1h", batch, "test_fixture")
    got = seeded_storage.get_bars("DUPTEST", "1h", 0, 2**33)
    assert len(got) == 10  # duplicate collapsed, not doubled


def test_provenance_preserved_on_sourceless_topup(seeded_storage):
    bars = make_bars(20, seed=11)
    seeded_storage.upsert_bars("PROVTEST", "1d", bars, "coinmetrics")
    # Incremental top-up without a source must not clobber provenance.
    seeded_storage.upsert_bars("PROVTEST", "1d", bars[-5:], None)
    meta = seeded_storage.get_meta("PROVTEST", "1d")
    assert meta["source"] == "coinmetrics"


def test_delete_bars(seeded_storage):
    seeded_storage.upsert_bars("DELTEST", "1d", make_bars(5, seed=3), "test_fixture")
    seeded_storage.delete_bars("DELTEST", "1d")
    assert seeded_storage.get_bars("DELTEST", "1d", 0, 2**33) == []


# ── trim_bars_outside ─────────────────────────────────────────────────────────
# A full-history importer replaces its source's whole range each run. Since
# upsert only ever writes, a range that shrinks (or a corrected import that
# drops a bogus trailing bar) would otherwise leave orphans cached forever.

def test_trim_removes_bars_outside_the_imported_range(seeded_storage):
    bars = make_bars(30, seed=21)
    seeded_storage.upsert_bars("TRIMTEST", "1d", bars, "coinmetrics")
    keep = bars[5:-5]

    removed = seeded_storage.trim_bars_outside(
        "TRIMTEST", "1d", keep[0].ts, keep[-1].ts, "coinmetrics",
    )

    assert removed == 10
    got = seeded_storage.get_bars("TRIMTEST", "1d", 0, 2**33)
    assert [b.ts for b in got] == [b.ts for b in keep]


def test_trim_updates_the_cached_range(seeded_storage):
    bars = make_bars(30, seed=22)
    seeded_storage.upsert_bars("TRIMMETA", "1d", bars, "coinmetrics")
    keep = bars[2:-2]

    seeded_storage.trim_bars_outside("TRIMMETA", "1d", keep[0].ts, keep[-1].ts, "coinmetrics")

    meta = seeded_storage.get_meta("TRIMMETA", "1d")
    assert meta["earliest_ts"] == keep[0].ts
    assert meta["latest_ts"] == keep[-1].ts


def test_trim_refuses_to_touch_another_sources_series(seeded_storage):
    """The guard that stops a Coin Metrics import deleting Binance bars."""
    bars = make_bars(20, seed=23)
    seeded_storage.upsert_bars("OTHERSRC", "1d", bars, "binance")

    removed = seeded_storage.trim_bars_outside(
        "OTHERSRC", "1d", bars[5].ts, bars[10].ts, "coinmetrics",
    )

    assert removed == 0
    assert len(seeded_storage.get_bars("OTHERSRC", "1d", 0, 2**33)) == 20


def test_trim_is_a_noop_when_everything_is_in_range(seeded_storage):
    bars = make_bars(15, seed=24)
    seeded_storage.upsert_bars("NOTRIM", "1d", bars, "coinmetrics")

    removed = seeded_storage.trim_bars_outside(
        "NOTRIM", "1d", bars[0].ts, bars[-1].ts, "coinmetrics",
    )

    assert removed == 0
    assert len(seeded_storage.get_bars("NOTRIM", "1d", 0, 2**33)) == 15
