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
    item: dict[str, Any] = {
        "source": source,
        "severity": _normalize_severity(severity),
        "message": str(message or title or "Security issue found"),
        "title": str(title or message or "Security issue"),
    }
    if isinstance(rule_id, str) and rule_id.strip():
        item["rule_id"] = rule_id.strip()
    path_value = _target_path(path)
    if path_value:
        item["path"] = path_value
    line_value = _to_int(line)
    if line_value is not None:
        item["line"] = line_value
    end_line_value = _to_int(end_line)
    if end_line_value is not None:
        item["end_line"] = end_line_value
    if isinstance(reference_url, str) and reference_url.strip():
        item["reference_url"] = reference_url.strip()
    return item


def parse_trivy_report(report: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    results = report.get("Results")
    if not isinstance(results, list):
        results = []

    for result in results:
        if not isinstance(result, dict):
            continue
        target = result.get("Target")

        misconfigs = result.get("Misconfigurations")
        if isinstance(misconfigs, list):
            for mis in misconfigs:
                if not isinstance(mis, dict):
                    continue
                cause = mis.get("CauseMetadata")
                cause_dict = cause if isinstance(cause, dict) else {}
                issues.append(
                    _make_issue(
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
                )

        secrets = result.get("Secrets")
        if isinstance(secrets, list):
            for secret in secrets:
                if not isinstance(secret, dict):
                    continue
                issues.append(
                    _make_issue(
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
                )

    by_severity = {severity: 0 for severity in _SUMMARY_SEVERITIES}
    for issue in issues:
        severity = _normalize_severity(issue.get("severity"))
        by_severity[severity] = by_severity.get(severity, 0) + 1

    return {
        "issues": issues,
        "summary": {
            "total": len(issues),
            "bySeverity": by_severity,
        },
    }


def _scan_error(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


async def run_trivy_policy_checks(project_root: Path) -> dict[str, Any]:
    if shutil.which("trivy") is None:
        return {
            "issues": [],
            "summary": {"total": 0, "bySeverity": {severity: 0 for severity in _SUMMARY_SEVERITIES}},
            "scanError": _scan_error("trivy_unavailable", "Trivy CLI is not available"),
        }

    process = await asyncio.create_subprocess_exec(
        *_TRIVY_BASE_CMD,
        str(project_root),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    raw_stdout = stdout.decode(errors="replace").strip()
    raw_stderr = stderr.decode(errors="replace").strip()

    if not raw_stdout:
        message = raw_stderr or "Trivy returned empty output"
        return {
            "issues": [],
            "summary": {"total": 0, "bySeverity": {severity: 0 for severity in _SUMMARY_SEVERITIES}},
            "scanError": _scan_error("trivy_empty_output", message),
        }

    try:
        report = json.loads(raw_stdout)
    except json.JSONDecodeError:
        message = raw_stderr or "Failed to parse Trivy JSON output"
        return {
            "issues": [],
            "summary": {"total": 0, "bySeverity": {severity: 0 for severity in _SUMMARY_SEVERITIES}},
            "scanError": _scan_error("trivy_invalid_json", message),
        }

    parsed = parse_trivy_report(report if isinstance(report, dict) else {})
    if process.returncode != 0:
        message = raw_stderr or f"Trivy exited with status {process.returncode}"
        parsed["scanError"] = _scan_error("trivy_failed", message)
        return parsed
    if raw_stderr:
        parsed["scanError"] = _scan_error("trivy_warning", raw_stderr)
    return parsed


async def run_project_policy_checks(project_id: str) -> dict[str, Any]:
    project_root = project_files.ensure_project_dir(project_id)
    return await run_trivy_policy_checks(project_root)
