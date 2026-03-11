"""Trivy-based policy checks for project workspaces."""
from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path
from typing import Any

from app.services.project import files as project_files

_TRIVY_BASE_CMD: tuple[str, ...] = (
    "trivy",
    "fs",
    "--scanners",
    "misconfig,secret",
    "--format",
    "json",
    "--quiet",
    "--no-progress",
    "--exit-code",
    "0",
    "--skip-check-update",
    "--skip-db-update",
    "--skip-java-db-update",
)

_SUMMARY_SEVERITIES: tuple[str, ...] = (
    "CRITICAL",
    "HIGH",
    "MEDIUM",
    "LOW",
    "UNKNOWN",
)


def _normalize_severity(raw: object) -> str:
    value = str(raw or "").strip().upper()
    return value if value else "UNKNOWN"


def _to_int(value: object) -> int | None:
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _target_path(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or text == ".":
        return None
    return text.lstrip("./")


def _first_reference(item: dict[str, Any]) -> str | None:
    primary = item.get("PrimaryURL")
    if isinstance(primary, str) and primary.strip():
        return primary.strip()
    refs = item.get("References")
    if isinstance(refs, list):
        for ref in refs:
            if isinstance(ref, str) and ref.strip():
                return ref.strip()
    return None


def _issue_base(source: str, severity: object, message: object, title: object) -> dict[str, Any]:
    return {
        "source": source,
        "severity": _normalize_severity(severity),
        "message": str(message or title or "Security issue found"),
        "title": str(title or message or "Security issue"),
    }


def _with_optional_path(issue: dict[str, Any], path: object) -> None:
    path_value = _target_path(path)
    if path_value:
        issue["path"] = path_value


def _with_optional_line(issue: dict[str, Any], key: str, value: object) -> None:
    line_value = _to_int(value)
    if line_value is not None:
        issue[key] = line_value


def _with_optional_str(issue: dict[str, Any], key: str, value: object) -> None:
    if isinstance(value, str) and value.strip():
        issue[key] = value.strip()


def _make_issue(
    *,
    source: str,
    severity: object,
    message: object,
    title: object,
    rule_id: object,
    path: object,
    line: object,
    end_line: object,
    reference_url: object,
) -> dict[str, Any]:
    item = _issue_base(source, severity, message, title)
    _with_optional_str(item, "rule_id", rule_id)
    _with_optional_path(item, path)
    _with_optional_line(item, "line", line)
    _with_optional_line(item, "end_line", end_line)
    _with_optional_str(item, "reference_url", reference_url)
    return item


def _misconfig_issue(mis: dict[str, Any], target: object) -> dict[str, Any]:
    cause = mis.get("CauseMetadata")
    cause_dict = cause if isinstance(cause, dict) else {}
    return _make_issue(
        source="misconfig",
        severity=mis.get("Severity"),
        message=mis.get("Message") or mis.get("Description"),
        title=mis.get("Title"),
        rule_id=mis.get("ID") or mis.get("AVDID"),
        path=target,
        line=cause_dict.get("StartLine"),
        end_line=cause_dict.get("EndLine"),
        reference_url=_first_reference(mis),
    )


def _secret_issue(secret: dict[str, Any], target: object) -> dict[str, Any]:
    return _make_issue(
        source="secret",
        severity=secret.get("Severity"),
        message=secret.get("Title") or secret.get("Match"),
        title=secret.get("Title") or "Potential secret detected",
        rule_id=secret.get("RuleID") or secret.get("ID"),
        path=target,
        line=secret.get("StartLine"),
        end_line=secret.get("EndLine"),
        reference_url=_first_reference(secret),
    )


def _result_issues(result: dict[str, Any]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    target = result.get("Target")
    for mis in result.get("Misconfigurations") or []:
        if isinstance(mis, dict):
            issues.append(_misconfig_issue(mis, target))
    for secret in result.get("Secrets") or []:
        if isinstance(secret, dict):
            issues.append(_secret_issue(secret, target))
    return issues


def _summary_from_issues(issues: list[dict[str, Any]]) -> dict[str, Any]:
    by_severity = {severity: 0 for severity in _SUMMARY_SEVERITIES}
    for issue in issues:
        severity = _normalize_severity(issue.get("severity"))
        by_severity[severity] = by_severity.get(severity, 0) + 1
    return {"total": len(issues), "bySeverity": by_severity}


def parse_trivy_report(report: dict[str, Any]) -> dict[str, Any]:
    results = report.get("Results")
    issues = []
    for result in results if isinstance(results, list) else []:
        if isinstance(result, dict):
            issues.extend(_result_issues(result))
    return {"issues": issues, "summary": _summary_from_issues(issues)}


def _scan_error(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def _empty_scan_result(code: str, message: str) -> dict[str, Any]:
    return {
        "issues": [],
        "summary": {"total": 0, "bySeverity": {severity: 0 for severity in _SUMMARY_SEVERITIES}},
        "scanError": _scan_error(code, message),
    }


async def _run_trivy(project_root: Path) -> tuple[int, str, str]:
    process = await asyncio.create_subprocess_exec(
        *_TRIVY_BASE_CMD,
        str(project_root),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    return process.returncode, stdout.decode(errors="replace").strip(), stderr.decode(errors="replace").strip()


async def run_trivy_policy_checks(project_root: Path) -> dict[str, Any]:
    if shutil.which("trivy") is None:
        return _empty_scan_result("trivy_unavailable", "Trivy CLI is not available")

    returncode, raw_stdout, raw_stderr = await _run_trivy(project_root)
    if not raw_stdout:
        return _empty_scan_result("trivy_empty_output", raw_stderr or "Trivy returned empty output")

    try:
        report = json.loads(raw_stdout)
    except json.JSONDecodeError:
        return _empty_scan_result("trivy_invalid_json", raw_stderr or "Failed to parse Trivy JSON output")

    parsed = parse_trivy_report(report if isinstance(report, dict) else {})
    if returncode != 0:
        parsed["scanError"] = _scan_error("trivy_failed", raw_stderr or f"Trivy exited with status {returncode}")
        return parsed
    if raw_stderr:
        parsed["scanError"] = _scan_error("trivy_warning", raw_stderr)
    return parsed


async def run_project_policy_checks(project_id: str) -> dict[str, Any]:
    project_root = project_files.ensure_project_dir(project_id)
    return await run_trivy_policy_checks(project_root)
