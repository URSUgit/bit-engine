"""Platform audit checker — runs real checks on the bit-engine monorepo."""
from __future__ import annotations

import ast
import glob
import json
import os
import re
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

PROJECT_ROOT = "/home/user/bit-engine"
WEB_ROOT = f"{PROJECT_ROOT}/apps/web"
SERVICE_ROOT = f"{PROJECT_ROOT}/apps/signal-service"

Priority = Literal["critical", "high", "medium", "low", "info"]

PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


@dataclass
class Finding:
    id: str           # unique slug
    priority: Priority
    category: str     # security | quality | style | deps | tests | perf
    title: str
    detail: str
    file: str = ""
    line: int = 0
    fix_hint: str = ""  # short suggestion for the agent


@dataclass
class AuditReport:
    findings: list[Finding] = field(default_factory=list)
    summary: dict = field(default_factory=dict)  # counts by priority/category
    checked_at: str = ""


# ─── Helper ──────────────────────────────────────────────────────────────────

def _run(cmd: list[str], cwd: str | None = None, timeout: int = 30) -> tuple[str, str, int]:
    """Run a subprocess; return (stdout, stderr, returncode)."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=cwd,
            timeout=timeout,
        )
        return result.stdout, result.stderr, result.returncode
    except subprocess.TimeoutExpired:
        return "", "timeout", 1
    except FileNotFoundError:
        return "", f"command not found: {cmd[0]}", 127
    except Exception as exc:
        return "", str(exc), 1


def _py_files() -> list[str]:
    return glob.glob(f"{SERVICE_ROOT}/**/*.py", recursive=True)


def _ts_files() -> list[str]:
    return (
        glob.glob(f"{WEB_ROOT}/src/**/*.ts", recursive=True)
        + glob.glob(f"{WEB_ROOT}/src/**/*.tsx", recursive=True)
    )


# ─── Check functions ──────────────────────────────────────────────────────────

def check_python_syntax() -> list[Finding]:
    findings: list[Finding] = []
    py_files = _py_files()
    for path in py_files:
        stdout, stderr, rc = _run(["python", "-m", "py_compile", path])
        if rc != 0 and stderr:
            # Parse line number from SyntaxError messages
            line_num = 0
            m = re.search(r"line (\d+)", stderr)
            if m:
                line_num = int(m.group(1))
            rel = path.replace(PROJECT_ROOT + "/", "")
            findings.append(Finding(
                id=f"py_syntax_{rel.replace('/', '_').replace('.', '_')}",
                priority="critical",
                category="quality",
                title=f"Python syntax error in {os.path.basename(path)}",
                detail=stderr.strip(),
                file=rel,
                line=line_num,
                fix_hint="Fix the syntax error reported above.",
            ))
    return findings


def check_typescript() -> list[Finding]:
    findings: list[Finding] = []
    stdout, stderr, rc = _run(
        ["npx", "tsc", "--noEmit", "--project", "tsconfig.json"],
        cwd=WEB_ROOT,
        timeout=60,
    )
    if rc == 127 or "not found" in stderr.lower():
        findings.append(Finding(
            id="ts_check_unavailable",
            priority="info",
            category="quality",
            title="TypeScript check unavailable",
            detail="npx/tsc not found; skipping TS compilation check.",
            fix_hint="Install Node.js and run npm install in apps/web.",
        ))
        return findings

    combined = stdout + stderr
    # Parse error lines like: path/to/file.ts(10,5): error TS2345: ...
    for line in combined.splitlines():
        m = re.match(r"(.+?)\((\d+),\d+\):\s+error\s+(TS\d+):\s+(.+)", line)
        if m:
            file_path = m.group(1).strip()
            line_num = int(m.group(2))
            code = m.group(3)
            message = m.group(4)
            rel = file_path.replace(WEB_ROOT + "/", "").replace(PROJECT_ROOT + "/", "")
            findings.append(Finding(
                id=f"ts_{code}_{rel.replace('/', '_').replace('.', '_')}_{line_num}",
                priority="high",
                category="quality",
                title=f"TypeScript error {code} in {os.path.basename(file_path)}",
                detail=message,
                file=rel,
                line=line_num,
                fix_hint=f"Fix TypeScript error {code}: {message}",
            ))
    return findings


def check_todos() -> list[Finding]:
    findings: list[Finding] = []
    pattern = re.compile(r"\b(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)", re.IGNORECASE)
    all_files = _py_files() + _ts_files()
    seen: set[str] = set()
    for path in all_files:
        try:
            with open(path, encoding="utf-8", errors="ignore") as f:
                for lineno, text in enumerate(f, 1):
                    m = pattern.search(text)
                    if m:
                        keyword = m.group(1).upper()
                        comment = m.group(2).strip()[:80]
                        rel = path.replace(PROJECT_ROOT + "/", "")
                        finding_id = f"todo_{rel.replace('/', '_').replace('.', '_')}_{lineno}"
                        if finding_id not in seen:
                            seen.add(finding_id)
                            findings.append(Finding(
                                id=finding_id,
                                priority="info",
                                category="style",
                                title=f"{keyword} in {os.path.basename(path)}:{lineno}",
                                detail=comment or text.strip()[:100],
                                file=rel,
                                line=lineno,
                                fix_hint=f"Resolve or track the {keyword} comment.",
                            ))
        except OSError:
            pass
    return findings


def check_security_patterns() -> list[Finding]:
    findings: list[Finding] = []

    # (pattern, priority, title_template, fix_hint)
    secret_patterns = [
        (re.compile(r'password\s*=\s*["\'][^"\']{4,}["\']', re.IGNORECASE),
         "critical", "Hardcoded password", "Move to environment variable."),
        (re.compile(r'api_key\s*=\s*["\'][^"\']{4,}["\']', re.IGNORECASE),
         "critical", "Hardcoded API key", "Move to environment variable."),
        (re.compile(r'secret\s*=\s*["\'][^"\']{4,}["\']', re.IGNORECASE),
         "high", "Hardcoded secret", "Move to environment variable."),
        (re.compile(r'\beval\s*\(', re.IGNORECASE),
         "high", "Use of eval()", "Avoid eval(); use safer alternatives."),
        (re.compile(r'shell\s*=\s*True'),
         "high", "subprocess with shell=True", "Use shell=False with a list of args."),
        (re.compile(r'f["\']SELECT\b.*\bWHERE\b', re.IGNORECASE),
         "critical", "SQL string concatenation (injection risk)", "Use parameterized queries."),
        (re.compile(r'\bexec\s*\('),
         "high", "Use of exec()", "Avoid exec(); refactor to explicit code paths."),
    ]

    # Files that define the audit patterns themselves are excluded to avoid
    # false positives (the pattern strings match themselves).
    _SELF_EXCLUDE = {
        os.path.abspath(__file__),                           # this checker
        os.path.abspath(__file__.replace(".pyc", ".py")),
    }

    all_files = _py_files() + _ts_files()
    for path in all_files:
        if os.path.abspath(path) in _SELF_EXCLUDE:
            continue
        try:
            with open(path, encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
            for lineno, text in enumerate(lines, 1):
                # Respect inline suppression comments (# noqa: or // noqa:)
                if re.search(r"#\s*noqa\b|//\s*noqa\b", text):
                    continue
                for pat, priority, title, fix_hint in secret_patterns:
                    if pat.search(text):
                        rel = path.replace(PROJECT_ROOT + "/", "")
                        findings.append(Finding(
                            id=f"sec_{pat.pattern[:20].replace(' ', '_').replace('/', '_')}_{rel.replace('/', '_')}_{lineno}",
                            priority=priority,  # type: ignore[arg-type]
                            category="security",
                            title=f"{title} in {os.path.basename(path)}",
                            detail=text.strip()[:120],
                            file=rel,
                            line=lineno,
                            fix_hint=fix_hint,
                        ))
        except OSError:
            pass
    return findings


def check_large_files() -> list[Finding]:
    findings: list[Finding] = []
    all_files = _py_files() + _ts_files()
    for path in all_files:
        try:
            with open(path, encoding="utf-8", errors="ignore") as f:
                count = sum(1 for _ in f)
            if count > 800:
                priority: Priority = "high"
            elif count > 400:
                priority = "medium"
            else:
                continue
            rel = path.replace(PROJECT_ROOT + "/", "")
            findings.append(Finding(
                id=f"large_{rel.replace('/', '_').replace('.', '_')}",
                priority=priority,
                category="quality",
                title=f"Large file: {os.path.basename(path)} ({count} lines)",
                detail=f"File has {count} lines. Consider splitting into smaller modules.",
                file=rel,
                line=0,
                fix_hint="Split into smaller, focused modules or components.",
            ))
        except OSError:
            pass
    return findings


def check_missing_tests() -> list[Finding]:
    findings: list[Finding] = []

    # Python: modules without test_*.py
    py_modules = [
        f for f in _py_files()
        if not os.path.basename(f).startswith("test_")
        and not os.path.basename(f).startswith("__")
        and "/tests/" not in f
        and "/test/" not in f
    ]
    test_files = {
        os.path.basename(f).replace("test_", "")
        for f in _py_files()
        if os.path.basename(f).startswith("test_")
    }
    for path in py_modules:
        basename = os.path.basename(path)
        if basename not in test_files:
            rel = path.replace(PROJECT_ROOT + "/", "")
            findings.append(Finding(
                id=f"notest_py_{rel.replace('/', '_').replace('.', '_')}",
                priority="low",
                category="tests",
                title=f"No test file for {basename}",
                detail=f"Module {rel} has no corresponding test_*.py file.",
                file=rel,
                line=0,
                fix_hint=f"Create tests/test_{basename} with unit tests.",
            ))

    # TypeScript: pages without .test.tsx
    page_files = glob.glob(f"{WEB_ROOT}/src/app/**/page.tsx", recursive=True)
    test_tsx = set(glob.glob(f"{WEB_ROOT}/src/**/*.test.tsx", recursive=True))
    test_basenames = {os.path.basename(t).replace(".test.tsx", "") for t in test_tsx}
    for path in page_files:
        parent = os.path.basename(os.path.dirname(path))
        if parent not in test_basenames and "page" not in test_basenames:
            rel = path.replace(PROJECT_ROOT + "/", "")
            findings.append(Finding(
                id=f"notest_ts_{rel.replace('/', '_').replace('.', '_')}",
                priority="low",
                category="tests",
                title=f"No test for page {rel}",
                detail=f"Page {rel} has no .test.tsx file.",
                file=rel,
                line=0,
                fix_hint="Create a .test.tsx file with component tests.",
            ))

    return findings


def check_deps() -> list[Finding]:
    findings: list[Finding] = []

    # Python outdated
    stdout, stderr, rc = _run(["pip", "list", "--outdated", "--format=json"])
    if rc == 0 and stdout.strip():
        try:
            outdated = json.loads(stdout)
            for pkg in outdated[:20]:  # cap at 20
                name = pkg.get("name", "")
                current = pkg.get("version", "")
                latest = pkg.get("latest_version", "")
                findings.append(Finding(
                    id=f"dep_py_{name.lower().replace('-', '_')}",
                    priority="low",
                    category="deps",
                    title=f"Outdated Python package: {name}",
                    detail=f"Current: {current} → Latest: {latest}",
                    fix_hint=f"Run: pip install --upgrade {name}",
                ))
        except (json.JSONDecodeError, KeyError):
            pass

    # Node outdated
    stdout, stderr, rc = _run(["npm", "outdated", "--json"], cwd=WEB_ROOT)
    if stdout.strip():
        try:
            outdated = json.loads(stdout)
            for pkg_name, info in list(outdated.items())[:20]:
                current = info.get("current", "?")
                latest = info.get("latest", "?")
                findings.append(Finding(
                    id=f"dep_npm_{pkg_name.lower().replace('@', '').replace('/', '_').replace('-', '_')}",
                    priority="low",
                    category="deps",
                    title=f"Outdated npm package: {pkg_name}",
                    detail=f"Current: {current} → Latest: {latest}",
                    fix_hint=f"Run: npm install {pkg_name}@latest in apps/web",
                ))
        except (json.JSONDecodeError, KeyError):
            pass

    return findings


def check_dead_code() -> list[Finding]:
    findings: list[Finding] = []

    # TypeScript: find .ts/.tsx files never imported
    ts_files = _ts_files()
    # Build a set of all import references across all TS files
    import_refs: set[str] = set()
    import_pat = re.compile(r'from\s+["\']([^"\']+)["\']')
    for path in ts_files:
        try:
            with open(path, encoding="utf-8", errors="ignore") as f:
                content = f.read()
            for m in import_pat.finditer(content):
                import_refs.add(m.group(1))
        except OSError:
            pass

    for path in ts_files:
        # Skip index files and page/layout files
        basename = os.path.basename(path)
        if basename in ("page.tsx", "layout.tsx", "index.ts", "index.tsx"):
            continue
        stem = os.path.splitext(basename)[0]
        rel = path.replace(PROJECT_ROOT + "/", "")
        # Check if any import references this module by stem or partial path
        referenced = any(
            stem in ref or rel.replace(PROJECT_ROOT, "") in ref
            for ref in import_refs
        )
        if not referenced:
            findings.append(Finding(
                id=f"dead_ts_{rel.replace('/', '_').replace('.', '_')}",
                priority="low",
                category="quality",
                title=f"Possibly unused TS module: {basename}",
                detail=f"{rel} — no other file appears to import it.",
                file=rel,
                line=0,
                fix_hint="Verify if this module is still needed; remove if not.",
            ))

    # Python: find functions defined but never called in the same directory
    py_files = _py_files()
    for path in py_files:
        try:
            with open(path, encoding="utf-8", errors="ignore") as f:
                source = f.read()
            try:
                tree = ast.parse(source, filename=path)
            except SyntaxError:
                continue
            # Collect top-level function names
            defined = [
                node.name for node in ast.walk(tree)
                if isinstance(node, ast.FunctionDef)
                and not node.name.startswith("_")
            ]
            if not defined:
                continue
            # Read all other files in the same directory to check calls
            dir_path = os.path.dirname(path)
            callers = ""
            for sibling in glob.glob(f"{dir_path}/*.py"):
                if sibling == path:
                    continue
                try:
                    with open(sibling, encoding="utf-8", errors="ignore") as f:
                        callers += f.read()
                except OSError:
                    pass
            for fn_name in defined:
                if fn_name not in callers:
                    rel = path.replace(PROJECT_ROOT + "/", "")
                    findings.append(Finding(
                        id=f"dead_py_{rel.replace('/', '_').replace('.', '_')}_{fn_name}",
                        priority="info",
                        category="quality",
                        title=f"Possibly unused function: {fn_name} in {os.path.basename(path)}",
                        detail=f"Function '{fn_name}' in {rel} has no callers in the same directory.",
                        file=rel,
                        line=0,
                        fix_hint=f"Verify if '{fn_name}' is still needed; remove if not.",
                    ))
        except OSError:
            pass

    return findings


def check_env_files() -> list[Finding]:
    findings: list[Finding] = []
    stdout, stderr, rc = _run(["git", "ls-files"], cwd=PROJECT_ROOT)
    if rc != 0:
        return findings
    for line in stdout.splitlines():
        if ".env" in line and not line.endswith(".example") and not line.endswith(".sample"):
            findings.append(Finding(
                id=f"env_tracked_{line.replace('/', '_').replace('.', '_')}",
                priority="critical",
                category="security",
                title=f".env file tracked by git: {line}",
                detail=f"The file '{line}' is tracked by git and may expose secrets.",
                file=line,
                line=0,
                fix_hint=f"Run: git rm --cached {line} && echo '{line}' >> .gitignore",
            ))
    return findings


def check_api_health() -> list[Finding]:
    findings: list[Finding] = []
    try:
        import urllib.request
        import urllib.error
        for url, label in [
            ("http://localhost:8001/health", "signal-service /health"),
            ("http://localhost:8001/docs", "signal-service /docs"),
        ]:
            try:
                with urllib.request.urlopen(url, timeout=3) as resp:
                    if resp.status == 200:
                        findings.append(Finding(
                            id=f"api_health_ok_{label.replace(' ', '_').replace('/', '_')}",
                            priority="info",
                            category="quality",
                            title=f"API reachable: {label}",
                            detail=f"GET {url} → HTTP {resp.status}",
                            fix_hint="",
                        ))
                        break
            except urllib.error.URLError:
                continue
        else:
            findings.append(Finding(
                id="api_health_down",
                priority="high",
                category="quality",
                title="signal-service appears to be down",
                detail="Could not reach http://localhost:8001/health or /docs.",
                fix_hint="Start the service: cd apps/signal-service && uvicorn main:app --port 8001",
            ))
    except Exception as exc:
        findings.append(Finding(
            id="api_health_error",
            priority="info",
            category="quality",
            title="API health check failed",
            detail=str(exc),
            fix_hint="",
        ))
    return findings


# ─── Orchestrator ─────────────────────────────────────────────────────────────

def run_all() -> AuditReport:
    """Run all checks, de-dupe, sort by priority, compute summary."""
    all_findings: list[Finding] = []

    checkers = [
        check_python_syntax,
        check_typescript,
        check_todos,
        check_security_patterns,
        check_large_files,
        check_missing_tests,
        check_deps,
        check_dead_code,
        check_env_files,
        check_api_health,
    ]

    for checker in checkers:
        try:
            results = checker()
            all_findings.extend(results)
        except Exception as exc:
            all_findings.append(Finding(
                id=f"checker_error_{checker.__name__}",
                priority="info",
                category="quality",
                title=f"Checker '{checker.__name__}' failed",
                detail=str(exc),
                fix_hint="Inspect checker code for bugs.",
            ))

    # De-duplicate by id
    seen_ids: set[str] = set()
    deduped: list[Finding] = []
    for f in all_findings:
        if f.id not in seen_ids:
            seen_ids.add(f.id)
            deduped.append(f)

    # Sort: critical → high → medium → low → info
    deduped.sort(key=lambda f: PRIORITY_ORDER.get(f.priority, 99))

    # Compute summary
    by_priority: dict[str, int] = {}
    by_category: dict[str, int] = {}
    for f in deduped:
        by_priority[f.priority] = by_priority.get(f.priority, 0) + 1
        by_category[f.category] = by_category.get(f.category, 0) + 1

    summary = {
        "total": len(deduped),
        "by_priority": by_priority,
        "by_category": by_category,
    }

    return AuditReport(
        findings=deduped,
        summary=summary,
        checked_at=datetime.now(timezone.utc).isoformat(),
    )
