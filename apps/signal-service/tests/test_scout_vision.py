"""app/scout/vision.py: no real network/download/OCR here — every test
monkeypatches at the vision.py seam level (probe, download_clip,
_sample_frames_sync, _get_reader), same style as the transcript/title
mocking in test_scout.py."""
import pytest

from app.scout import vision


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_analyze_frames_skips_when_video_too_long(monkeypatch):
    async def fake_probe(video_id):
        return {"duration": vision.VISION_MAX_DURATION_S + 1}

    async def fail_download(video_id):
        raise AssertionError("download_clip should not be called when too long")

    monkeypatch.setattr(vision, "probe", fake_probe)
    monkeypatch.setattr(vision, "download_clip", fail_download)

    events = [e async for e in vision.analyze_frames("abcdefghijk")]
    assert len(events) == 1
    assert events[0] == {"stage": "result", "skipped": True, "reason": "too_long", "frame_texts": []}


@pytest.mark.anyio
async def test_analyze_frames_happy_path_yields_one_frame_event_per_frame(monkeypatch, tmp_path):
    fake_frames = ["frame0", "frame1", "frame2"]

    async def fake_probe(video_id):
        return {"duration": 60}

    async def fake_download_clip(video_id):
        return tmp_path / "clip.mp4"

    def fake_sample_frames_sync(path, n):
        return fake_frames[:n]

    class FakeReader:
        def readtext(self, frame, detail=0):
            return [f"OCR:{frame}"]

    monkeypatch.setattr(vision, "probe", fake_probe)
    monkeypatch.setattr(vision, "download_clip", fake_download_clip)
    monkeypatch.setattr(vision, "_sample_frames_sync", fake_sample_frames_sync)
    monkeypatch.setattr(vision, "_get_reader", lambda: FakeReader())

    events = [e async for e in vision.analyze_frames("abcdefghijk", n=3)]
    frame_events = [e for e in events if e["stage"] == "frame"]
    result_events = [e for e in events if e["stage"] == "result"]

    assert len(frame_events) == 3
    assert [e["index"] for e in frame_events] == [0, 1, 2]
    assert all(e["total"] == 3 for e in frame_events)

    assert len(result_events) == 1
    result = result_events[0]
    assert result["skipped"] is False
    assert result["reason"] is None
    assert result["frame_texts"] == ["OCR:frame0", "OCR:frame1", "OCR:frame2"]


@pytest.mark.anyio
async def test_analyze_frames_degrades_gracefully_on_download_failure(monkeypatch):
    async def fake_probe(video_id):
        return {"duration": 60}

    async def fake_download_clip(video_id):
        raise RuntimeError("network unreachable")

    monkeypatch.setattr(vision, "probe", fake_probe)
    monkeypatch.setattr(vision, "download_clip", fake_download_clip)

    events = [e async for e in vision.analyze_frames("abcdefghijk")]
    assert len(events) == 1
    assert events[0]["stage"] == "result"
    assert events[0]["skipped"] is True
    assert events[0]["reason"] == "RuntimeError"
    assert events[0]["frame_texts"] == []


@pytest.mark.anyio
async def test_analyze_frames_skips_when_no_frames_sampled(monkeypatch, tmp_path):
    async def fake_probe(video_id):
        return {"duration": 60}

    async def fake_download_clip(video_id):
        return tmp_path / "clip.mp4"

    def fake_sample_frames_sync(path, n):
        return []

    monkeypatch.setattr(vision, "probe", fake_probe)
    monkeypatch.setattr(vision, "download_clip", fake_download_clip)
    monkeypatch.setattr(vision, "_sample_frames_sync", fake_sample_frames_sync)

    events = [e async for e in vision.analyze_frames("abcdefghijk")]
    assert len(events) == 1
    assert events[0] == {"stage": "result", "skipped": True, "reason": "no_frames", "frame_texts": []}
