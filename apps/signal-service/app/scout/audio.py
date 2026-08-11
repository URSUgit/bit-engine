"""Audio-transcription fallback: when a video has no captions and on-screen
chart OCR (vision.py) still finds nothing, download its audio and
transcribe it locally so the extractor works from what was actually said,
not just the title. Heaviest of the three analysis paths (network download
+ CPU transcription) so it's only reached when the cheaper paths already
came up empty — see service.py's analyze_video.

Heavy libs (yt-dlp, faster-whisper) imported lazily inside functions,
matching vision.py's pattern, so app startup stays fast and tests can
monkeypatch these seams without the packages needing to be importable.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from .vision import probe

log = logging.getLogger(__name__)

AUDIO_MAX_DURATION_S = float(os.getenv("SCOUT_AUDIO_MAX_DURATION_S", "2400"))
AUDIO_MODEL_SIZE = os.getenv("SCOUT_AUDIO_MODEL_SIZE", "base")

_MODEL: Any = None


def _get_model() -> Any:
    global _MODEL
    if _MODEL is None:
        from faster_whisper import WhisperModel

        _MODEL = WhisperModel(AUDIO_MODEL_SIZE, device="cpu", compute_type="int8")
    return _MODEL


async def download_audio(video_id: str) -> Path:
    """Download an audio-only, lowest-bitrate copy to a temp dir. Caller
    owns cleanup of the returned file's parent dir."""
    def _get() -> Path:
        import yt_dlp

        tmpdir = Path(tempfile.mkdtemp(prefix="scout_audio_"))
        url = f"https://www.youtube.com/watch?v={video_id}"
        outtmpl = str(tmpdir / f"{video_id}.%(ext)s")
        opts = {
            "quiet": True,
            "no_warnings": True,
            "format": "worstaudio/worst",
            "outtmpl": outtmpl,
            "noplaylist": True,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
        files = list(tmpdir.glob(f"{video_id}.*"))
        if not files:
            raise RuntimeError("yt-dlp produced no audio output file")
        return files[0]

    return await asyncio.to_thread(_get)


def _transcribe_sync(path: Path) -> list[dict]:
    model = _get_model()
    segments, _info = model.transcribe(str(path), vad_filter=True)
    return [{"text": seg.text, "start": seg.start} for seg in segments]


async def transcribe(video_id: str) -> list[dict]:
    """Timestamped transcript chunks from speech — same [{text, start}, ...]
    shape `service.py`'s `_fetch_transcript` returns, so it drops straight
    into the same extraction path. Empty list on any failure, or when the
    video exceeds AUDIO_MAX_DURATION_S (transcription cost scales with
    duration; this cap matches vision.py's frame-OCR bound). Never raises —
    the caller keeps whatever it already has on failure."""
    tmpdir: Path | None = None
    try:
        info = await probe(video_id)
        duration = info.get("duration") or 0
        if duration and duration > AUDIO_MAX_DURATION_S:
            return []
        audio_path = await download_audio(video_id)
        tmpdir = audio_path.parent
        return await asyncio.to_thread(_transcribe_sync, audio_path)
    except Exception as exc:
        log.warning("scout audio transcription failed for %s: %r", video_id, exc)
        return []
    finally:
        if tmpdir is not None:
            shutil.rmtree(tmpdir, ignore_errors=True)
