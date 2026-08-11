"""On-screen chart/ticker OCR: sample frames from a video and read what's
shown but not necessarily spoken (tickers, price levels, indicator overlays).

Heavy libs (yt-dlp, opencv, easyocr) are imported lazily inside functions so
app startup stays fast and tests can monkeypatch these seams without the
packages needing to be importable at all. Runs only on manual "Analyze live"
requests (see service.analyze_video_live), never in the background poll loop.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, AsyncIterator

log = logging.getLogger(__name__)

VISION_MAX_DURATION_S = float(os.getenv("SCOUT_VISION_MAX_DURATION_S", "2400"))
VISION_MAX_HEIGHT = int(os.getenv("SCOUT_VISION_MAX_HEIGHT", "360"))
VISION_FRAME_COUNT = int(os.getenv("SCOUT_VISION_FRAME_COUNT", "6"))

_READER: Any = None


async def probe(video_id: str) -> dict:
    """Duration and basic info without downloading anything."""
    def _get() -> dict:
        import yt_dlp

        url = f"https://www.youtube.com/watch?v={video_id}"
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True}) as ydl:
            info = ydl.extract_info(url, download=False)
            return {"duration": int(info.get("duration") or 0)}

    return await asyncio.to_thread(_get)


async def download_clip(video_id: str) -> Path:
    """Download a capped low-resolution copy of the video to a temp dir.
    Caller owns cleanup of the returned directory."""
    def _get() -> Path:
        import yt_dlp

        tmpdir = Path(tempfile.mkdtemp(prefix="scout_vision_"))
        url = f"https://www.youtube.com/watch?v={video_id}"
        outtmpl = str(tmpdir / "%(id)s.%(ext)s")
        opts = {
            "quiet": True,
            "no_warnings": True,
            "format": f"best[height<={VISION_MAX_HEIGHT}]/worst",
            "outtmpl": outtmpl,
            "noplaylist": True,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
        files = list(tmpdir.glob(f"{video_id}.*"))
        if not files:
            raise RuntimeError("yt-dlp produced no output file")
        return files[0]

    return await asyncio.to_thread(_get)


def _sample_frames_sync(path: Path, n: int) -> list[Any]:
    import cv2

    cap = cv2.VideoCapture(str(path))
    try:
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if total <= 0:
            frames = []
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                frames.append(frame)
            if not frames:
                return []
            step = max(1, len(frames) // n)
            return frames[::step][:n]
        stride = max(1, total // n)
        frames = []
        for i in range(n):
            idx = min(i * stride, total - 1)
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ok, frame = cap.read()
            if ok:
                frames.append(frame)
        return frames
    finally:
        cap.release()


def _get_reader() -> Any:
    global _READER
    if _READER is None:
        import easyocr

        _READER = easyocr.Reader(["en"], gpu=False)
    return _READER


def _ocr_frame_sync(reader: Any, frame: Any) -> str:
    results = reader.readtext(frame, detail=0)
    return " ".join(str(r) for r in results)


async def analyze_frames(video_id: str, n: int | None = None) -> AsyncIterator[dict]:
    """Download a capped low-res copy, sample evenly-spaced frames, OCR each
    one. Async generator: yields one {"stage": "frame", ...} event per frame
    as OCR completes, then a final {"stage": "result", ...} event. Never
    raises: any failure degrades the final event to {"skipped": True,
    "reason": ...} so the caller's pipeline can continue with text-only
    findings. This is the single seam tests/service.py should mock."""
    n = n or VISION_FRAME_COUNT
    tmpdir: Path | None = None
    try:
        info = await probe(video_id)
        duration = info.get("duration") or 0
        if duration and duration > VISION_MAX_DURATION_S:
            yield {"stage": "result", "skipped": True, "reason": "too_long", "frame_texts": []}
            return

        clip_path = await download_clip(video_id)
        tmpdir = clip_path.parent
        frames = await asyncio.to_thread(_sample_frames_sync, clip_path, n)
        if not frames:
            yield {"stage": "result", "skipped": True, "reason": "no_frames", "frame_texts": []}
            return

        reader = await asyncio.to_thread(_get_reader)
        texts: list[str] = []
        for i, frame in enumerate(frames):
            text = await asyncio.to_thread(_ocr_frame_sync, reader, frame)
            texts.append(text)
            yield {"stage": "frame", "index": i, "total": len(frames), "text": text}
        yield {"stage": "result", "skipped": False, "reason": None, "frame_texts": texts}
    except Exception as exc:
        log.warning("scout vision analysis failed for %s: %r", video_id, exc)
        yield {"stage": "result", "skipped": True, "reason": type(exc).__name__, "frame_texts": []}
    finally:
        if tmpdir is not None:
            shutil.rmtree(tmpdir, ignore_errors=True)
