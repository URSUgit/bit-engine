"""Resolution of on-disk data file locations.

Persistent JSON stores (scout state, strategies, the cryptobot ledger,
OAuth tokens) used to be declared as bare relative paths like
``data/scout_state.json``. A relative path is resolved against the
*process* working directory, so the file a module reads depends on where
uvicorn happened to be launched from. Launch the service from the repo
root instead of ``apps/signal-service`` and every store silently starts
empty — and the next save writes that emptiness over the real file.

``data_path`` pins these files to the service directory instead, so the
location no longer depends on the caller's cwd. Behaviour is unchanged
when the service is started from its own directory (the common case);
it only stops the resolution from drifting when it isn't.
"""
from __future__ import annotations

import os
from pathlib import Path

# apps/signal-service — this file lives at apps/signal-service/app/data_paths.py
SERVICE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = SERVICE_DIR / "data"


def data_path(env_var: str, filename: str) -> Path:
    """Absolute path for a data file, overridable per deployment.

    ``env_var`` still wins so deployments can point a store anywhere; a
    relative override is resolved against the service directory rather
    than the process cwd, for the same reason.
    """
    override = os.getenv(env_var)
    if override:
        p = Path(override)
        return p if p.is_absolute() else (SERVICE_DIR / p)
    return DATA_DIR / filename
