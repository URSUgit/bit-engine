"""Shared rate-limiter instance — imported by main.py and any router that needs
per-endpoint overrides. Centralised here to avoid circular imports.

slowapi is an optional dependency. If it isn't installed, fall back to a no-op
limiter so the service still starts and serves requests (just without rate
limiting). This keeps core endpoints like /symbols working even when optional
deps haven't been installed yet.
"""
from __future__ import annotations

try:
    from slowapi import Limiter
    from slowapi.util import get_remote_address

    limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
    SLOWAPI_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised only when slowapi is absent
    SLOWAPI_AVAILABLE = False

    class _NoopLimiter:
        """Minimal stand-in for slowapi's Limiter.

        Provides `.limit(...)` as an identity decorator so the
        `@limiter.limit("20/minute")` decorations on routers keep working
        without slowapi installed.
        """

        def limit(self, *_args, **_kwargs):
            def decorator(func):
                return func

            return decorator

        def __getattr__(self, _name):  # tolerate any other attribute access
            def _noop(*_a, **_k):
                return None

            return _noop

    limiter = _NoopLimiter()
