"""LRU backtest result cache — avoids re-running identical requests."""
from __future__ import annotations
import hashlib, json, time
from collections import OrderedDict
from threading import Lock
from typing import Any

class BacktestCache:
    def __init__(self, max_size: int = 200, ttl_seconds: int = 300):
        self._cache: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._max = max_size
        self._ttl = ttl_seconds
        self._lock = Lock()

    def _key(self, params: dict) -> str:
        s = json.dumps(params, sort_keys=True, default=str)
        return hashlib.sha256(s.encode()).hexdigest()[:16]

    def get(self, params: dict) -> Any | None:
        k = self._key(params)
        with self._lock:
            if k not in self._cache:
                return None
            val, ts = self._cache[k]
            if time.monotonic() - ts > self._ttl:
                del self._cache[k]
                return None
            self._cache.move_to_end(k)
            return val

    def set(self, params: dict, result: Any) -> None:
        k = self._key(params)
        with self._lock:
            self._cache[k] = (result, time.monotonic())
            self._cache.move_to_end(k)
            while len(self._cache) > self._max:
                self._cache.popitem(last=False)

    def invalidate(self, symbol: str | None = None) -> None:
        with self._lock:
            if symbol is None:
                self._cache.clear()
            else:
                keys_to_del = [k for k in self._cache if symbol in k]
                for k in keys_to_del:
                    del self._cache[k]

    @property
    def size(self) -> int:
        return len(self._cache)

backtest_cache = BacktestCache()
