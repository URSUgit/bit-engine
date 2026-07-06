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
