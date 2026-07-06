"""FastAPI router for the platform audit bot — prefix /api/v1/audit."""
from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel

from app.audit import checker, store

PROJECT_ROOT = checker.PROJECT_ROOT

router = APIRouter()


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _finding_to_dict(f: checker.Finding) -> dict[str, Any]:
    return {
        "id": f.id,
        "priority": f.priority,
        "category": f.category,
        "title": f.title,
        "detail": f.detail,
        "file": f.file,
        "line": f.line,
        "fix_hint": f.fix_hint,
    }


def _report_to_dict(report: checker.AuditReport) -> dict[str, Any]:
    return {
        "findings": [_finding_to_dict(f) for f in report.findings],
        "summary": report.summary,
        "checked_at": report.checked_at,
    }


# ─── Request models ────────────────────────────────────────────────────────────

class ApplyFixRequest(BaseModel):
    file_path: str
    new_content: str


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/run")
async def run_audit() -> dict[str, Any]:
    """Run a full platform audit, persist it, and return the report."""
    import asyncio
    report = await asyncio.to_thread(checker.run_all)
    report_id = await asyncio.to_thread(store.save_report, report)
    result = _report_to_dict(report)
    result["report_id"] = report_id
    return result


@router.get("/reports")
async def list_reports() -> list[dict[str, Any]]:
    """Return metadata for past audit reports (no findings payload)."""
    import asyncio
    return await asyncio.to_thread(store.list_reports, 20)


@router.get("/reports/latest")
async def latest_report() -> dict[str, Any]:
    """Return the most recent full audit report."""
    import asyncio
    report = await asyncio.to_thread(store.load_latest)
    if report is None:
        raise HTTPException(status_code=404, detail="No audit reports found. Run /run first.")
    return _report_to_dict(report)


@router.get("/reports/{report_id}")
async def get_report(report_id: int = Path(..., description="Report ID")) -> dict[str, Any]:
    """Return a specific audit report by ID."""
    import asyncio
    report = await asyncio.to_thread(store.load_report, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail=f"Report {report_id} not found.")
    return _report_to_dict(report)


@router.post("/apply-fix")
async def apply_fix(body: ApplyFixRequest) -> dict[str, Any]:
    """Write new content to a file within PROJECT_ROOT (safety-checked)."""
    file_path = body.file_path

    # Resolve absolute path
    if not os.path.isabs(file_path):
        file_path = os.path.join(PROJECT_ROOT, file_path)
    file_path = os.path.realpath(file_path)

    # Safety: must be within PROJECT_ROOT
    if not file_path.startswith(os.path.realpath(PROJECT_ROOT) + os.sep):
        raise HTTPException(status_code=403, detail="Path is outside PROJECT_ROOT.")

    # Safety: must not touch .env or .git files
    basename = os.path.basename(file_path)
    if basename.startswith(".env") or "/.git/" in file_path or file_path.endswith("/.git"):
        raise HTTPException(status_code=403, detail="Writing .env or .git files is not allowed.")

    try:
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as fh:
            fh.write(body.new_content)
        return {"ok": True, "file": file_path}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
