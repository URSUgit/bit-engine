"""Persist audit reports to SQLite at ~/.bitprivat/audit.db."""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any

from app.audit.checker import AuditReport, Finding

_DB_DIR = Path.home() / ".bitprivat"
_DB_PATH = _DB_DIR / "audit.db"


def _get_conn() -> sqlite3.Connection:
    _DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH))
    conn.row_factory = sqlite3.Row
    _ensure_schema(conn)
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS audit_reports (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            checked_at TEXT    NOT NULL,
            summary    TEXT    NOT NULL,
            findings   TEXT    NOT NULL
        )
    """)
    conn.commit()


def _finding_to_dict(f: Finding) -> dict[str, Any]:
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


def _dict_to_finding(d: dict[str, Any]) -> Finding:
    return Finding(
        id=d["id"],
        priority=d["priority"],
        category=d["category"],
        title=d["title"],
        detail=d["detail"],
        file=d.get("file", ""),
        line=d.get("line", 0),
        fix_hint=d.get("fix_hint", ""),
    )


def save_report(report: AuditReport) -> int:
    """Persist a report and return its auto-assigned integer id."""
    conn = _get_conn()
    cursor = conn.execute(
        "INSERT INTO audit_reports (checked_at, summary, findings) VALUES (?, ?, ?)",
        (
            report.checked_at,
            json.dumps(report.summary),
            json.dumps([_finding_to_dict(f) for f in report.findings]),
        ),
    )
    conn.commit()
    report_id: int = cursor.lastrowid  # type: ignore[assignment]
    conn.close()
    return report_id


def load_report(report_id: int) -> AuditReport | None:
    """Load a specific report by id; returns None if not found."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT * FROM audit_reports WHERE id = ?", (report_id,)
    ).fetchone()
    conn.close()
    if not row:
        return None
    return _row_to_report(row)


def list_reports(limit: int = 20) -> list[dict[str, Any]]:
    """Return metadata for the most recent reports (no findings payload)."""
    conn = _get_conn()
    rows = conn.execute(
        "SELECT id, checked_at, summary FROM audit_reports ORDER BY id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    conn.close()
    result = []
    for row in rows:
        summary = json.loads(row["summary"])
        result.append({
            "id": row["id"],
            "checked_at": row["checked_at"],
            "total": summary.get("total", 0),
            "by_priority": summary.get("by_priority", {}),
        })
    return result


def load_latest() -> AuditReport | None:
    """Load the most recently saved report."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT * FROM audit_reports ORDER BY id DESC LIMIT 1"
    ).fetchone()
    conn.close()
    if not row:
        return None
    return _row_to_report(row)


def _row_to_report(row: sqlite3.Row) -> AuditReport:
    summary = json.loads(row["summary"])
    raw_findings = json.loads(row["findings"])
    findings = [_dict_to_finding(d) for d in raw_findings]
    return AuditReport(
        findings=findings,
        summary=summary,
        checked_at=row["checked_at"],
    )
