"""Install a checksum-pinned Binance spot archive into a new research cache.

Run with Python 3.11 and --audit pointing to the locally verified manifest.
The normal Bit Engine database is never used. Existing caches are not overwritten.
"""
import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import sys
import tempfile
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

SYMBOL, INTERVAL, STEP = 'BTCUSDT', '1h', 3600
BASE = 'https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1h'


def month_start(month):
    return int(datetime.fromisoformat(month + '-01').replace(tzinfo=timezone.utc).timestamp())


def read_month(entry):
    month = entry['month']
    name = f'{SYMBOL}-{INTERVAL}-{month}'
    if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month):
        raise ValueError('Invalid month in audit')
    with urlopen(f'{BASE}/{name}.zip', timeout=20) as response:
        binary = response.read(1_000_001)
    if len(binary) > 1_000_000 or hashlib.sha256(binary).hexdigest() != entry['sha256']:
        raise ValueError(f'{month}: archive differs from the audited revision')
    year, num = map(int, month.split('-'))
    start, end = month_start(month), month_start(f'{year + (num == 12):04d}-{num % 12 + 1:02d}')
    factor = 1_000_000 if year >= 2025 else 1_000
    rows = []
    with zipfile.ZipFile(io.BytesIO(binary)) as archive:
        item = archive.getinfo(name + '.csv')
        if item.file_size > 2_000_000:
            raise ValueError(f'{month}: unexpected expanded size')
        with archive.open(item) as file:
            for row in csv.reader(io.TextIOWrapper(file, encoding='ascii')):
                raw = int(row[0])
                timestamp = raw // factor
                o, h, l, c, v = map(float, row[1:6])
                if (raw % factor or timestamp % STEP or not start <= timestamp < end
                    or (rows and timestamp <= rows[-1][0]) or not all(map(math.isfinite, (o, h, l, c, v)))
                    or not (0 < l <= min(o, c) <= max(o, c) <= h and v >= 0)):
                    raise ValueError(f'{month}: invalid candle at {raw}')
                rows.append((timestamp, o, h, l, c, v))
    if not rows or len(rows) != entry['rows']:
        raise ValueError(f'{month}: unexpected number of candles')
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit', type=Path, required=True)
    parser.add_argument('--release-dir', type=Path, default=Path(os.environ.get('LOCALAPPDATA', '.')) / 'BitEngine' / 'research')
    args = parser.parse_args()
    audit = json.loads(args.audit.read_text(encoding='utf-8'))
    expected_months = {f'{y}-{m:02d}' for y in range(2021, 2026) for m in range(1, 13)}
    entries = sorted((row for row in audit['archives']
                      if row['symbol'] == SYMBOL and row['timeframe'] == INTERVAL and row['month'] in expected_months),
                     key=lambda row: row['month'])
    if len(entries) != len(expected_months) or {e['month'] for e in entries} != expected_months:
        raise ValueError('Expected exactly 60 labelled BTCUSDT hourly months')
    release = args.release_dir.resolve()
    release.mkdir(parents=True, exist_ok=True)
    target = release / 'bars.duckdb'
    coverage_target = release / 'coverage.json'
    if target.exists() or coverage_target.exists():
        raise FileExistsError(f'Research archive already exists at {release}; no overwrite attempted')
    with ThreadPoolExecutor(max_workers=6) as workers:
        rows = [r for month in workers.map(read_month, entries) for r in month]
    times = {r[0] for r in rows}
    start, end = month_start('2021-01'), month_start('2026-01')
    missing = sorted(set(range(start, end, STEP)) - times)
    # Strict breakout dates use whole UTC days. Choose the widest fully covered day interval.
    boundaries = [start - STEP, *missing, end]
    day = 86400
    complete_start, complete_end = max(
        ((((a + STEP + day - 1) // day) * day, (b // day) * day) for a, b in zip(boundaries, boundaries[1:])),
        key=lambda pair: pair[1] - pair[0],
    )
    iso = lambda ts: datetime.fromtimestamp(ts, timezone.utc).isoformat()
    manifest = {'symbol': SYMBOL, 'interval': INTERVAL, 'venue': 'Binance spot',
                'candles': len(rows), 'missing': [iso(t) for t in missing], 'start_date': iso(start)[:10],
                'end_exclusive': iso(end)[:10], 'strict_start_date': iso(complete_start)[:10],
                'strict_end_exclusive': iso(complete_end)[:10],
                'archives': [{'month': e['month'], 'sha256': e['sha256'], 'rows': e['rows']} for e in entries]}
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps' / 'signal-service'))
    with tempfile.TemporaryDirectory(dir=release, prefix='install-') as tmp:
        work = Path(tmp) / 'bars.duckdb'
        os.environ.update(BACKTEST_DUCKDB_PATH=str(work), BACKTEST_DB_PATH=str(Path(tmp) / 'unused.sqlite'))
        from app.backtest.models import Bar
        from app.backtest.storage import bar_storage
        try:
            bars = [Bar(datetime.fromtimestamp(t, timezone.utc), o, h, l, c, v) for t, o, h, l, c, v in rows]
            bar_storage.upsert_bars(SYMBOL, INTERVAL, bars, 'binance')
            if len(bar_storage.get_bars(SYMBOL, INTERVAL, start, end - STEP)) != len(rows):
                raise RuntimeError('Cache verification failed')
        finally:
            bar_storage._con.close()
        local_manifest = Path(tmp) / 'coverage.json'
        local_manifest.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        # On Windows rename refuses an existing destination. Launcher requires both files.
        work.rename(target)
        local_manifest.rename(coverage_target)
    print(json.dumps({k: v for k, v in manifest.items() if k != 'archives'}, indent=2))


if __name__ == '__main__':
    main()
