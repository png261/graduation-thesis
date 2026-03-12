"""IaC policy checks for project workspaces."""
from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path
from typing import Any

from app.services.project import files as project_files

_CHECKOV_CMD: tuple[str, ...] = (
    "checkov",
    "--framework",
    "terraform",
    "--output",
    "json",
    "--quiet",
)

_TFLINT_CMD: tuple[str, ...] = (
    "tflint",
    "--recursive",
    "--format",
    "json",
)

_TRIVY_CMD: tuple[str, ...] = (
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

_SUMMARY_SEVERITIES: tuple[str, ...] = ("CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN")


def _normalize_severity(raw: object) -> str:
    value = str(raw or "").strip().upper()
    return value if value else "UNKNOWN"


def _summary_from_issues(issues: list[dict[str, Any]]) -> dict[str, Any]:
    by_severity = {severity: 0 for severity in _SUMMARY_SEVERITIES}
    for issue in issues:
        severity = _normalize_severity(issue.get("severity"))
        by_severity[severity] = by_severity.get(severity, 0) + 1
    return {"total": len(issues), "bySeverity": by_severity}


def _scan_error(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def _empty_scan_result(code: str, message: str) -> dict[str, Any]:
    return {
        "issues": [],
        "summary": {"total": 0, "bySeverity": {severity: 0 for severity in _SUMMARY_SEVERITIES}},
        "scanError": _scan_error(code, message),
    }


def _target_path(path: object) -> str | None:
    if not isinstance(path, str):
        return None
    value = path.strip()
    if not value:
        return None
    return value.lstrip("./")


def _as_line_range(line_range: object) -> tuple[int | None, int | None]:
    if not isinstance(line_range, list) or len(line_range) < 2:
        return None, None
    try:
        start = int(line_range[0]) if int(line_range[0]) > 0 else None
        end = int(line_range[1]) if int(line_range[1]) > 0 else None
    except Exception:
        return None, None
    return start, end


async def _run_command(*cmd: str, cwd: Path) -> tuple[int, str, str]:
    process = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    return process.returncode, stdout.decode(errors="replace"), stderr.decode(errors="replace")


def _parse_checkov_report(payload: dict[str, Any]) -> list[dict[str, Any]]:
    results = payload.get("results") if isinstance(payload.get("results"), dict) else {}
    failed_checks = results.get("failed_checks") if isinstance(results.get("failed_checks"), list) else []
    issues: list[dict[str, Any]] = []
    for row in failed_checks:
        if not isinstance(row, dict):
            continue
        start_line, end_line = _as_line_range(row.get("file_line_range"))
        issue: dict[str, Any] = {
            "source": "checkov",
            "severity": _normalize_severity(row.get("severity")),
            "message": str(row.get("check_name") or row.get("check_id") or "Policy issue found"),
            "title": str(row.get("check_name") or row.get("check_id") or "Policy issue"),
            "rule_id": str(row.get("check_id") or "").strip(),
        }
        path = _target_path(row.get("file_path") or row.get("file_abs_path"))
        if path:
            issue["path"] = path
        if start_line is not None:
            issue["line"] = start_line
        if end_line is not None:
            issue["end_line"] = end_line
        guideline = str(row.get("guideline") or "").strip()
        if guideline:
            issue["reference_url"] = guideline
        issues.append(issue)
    return issues


async def run_checkov_policy_checks(project_root: Path) -> dict[str, Any]:
    if shutil.which("checkov") is None:
        return _empty_scan_result("checkov_unavailable", "Checkov CLI is not available")
    returncode, raw_stdout, raw_stderr = await _run_command(*_CHECKOV_CMD, str(project_root), cwd=project_root)
    if not raw_stdout.strip():
        return _empty_scan_result("checkov_empty_output", raw_stderr.strip() or "Checkov returned empty output")
    try:
        parsed = json.loads(raw_stdout)
    except json.JSONDecodeError:
        return _empty_scan_result("checkov_invalid_json", raw_stderr.strip() or "Failed to parse Checkov JSON output")
    issues = _parse_checkov_report(parsed if isinstance(parsed, dict) else {})
    result: dict[str, Any] = {"issues": issues, "summary": _summary_from_issues(issues)}
    if returncode not in {0, 1}:
        result["scanError"] = _scan_error("checkov_failed", raw_stderr.strip() or f"Checkov exited with status {returncode}")
    elif raw_stderr.strip():
        result["scanError"] = _scan_error("checkov_warning", raw_stderr.strip())
    return result


def _parse_tflint_report(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, list):
        return []
    issues: list[dict[str, Any]] = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        issue: dict[str, Any] = {
            "source": "tflint",
            "severity": _normalize_severity(row.get("severity") or "MEDIUM"),
            "message": str(row.get("message") or row.get("rule") or "Lint issue found"),
            "title": str(row.get("rule") or "TFLint issue"),
            "rule_id": str(row.get("rule") or "").strip(),
        }
        path = _target_path(row.get("range", {}).get("filename") if isinstance(row.get("range"), dict) else row.get("file"))
        if path:
            issue["path"] = path
        if isinstance(row.get("range"), dict):
            start = row["range"].get("start") if isinstance(row["range"].get("start"), dict) else {}
            end = row["range"].get("end") if isinstance(row["range"].get("end"), dict) else {}
            line = int(start.get("line")) if str(start.get("line") or "").isdigit() else None
            end_line = int(end.get("line")) if str(end.get("line") or "").isdigit() else None
            if line and line > 0:
                issue["line"] = line
            if end_line and end_line > 0:
                issue["end_line"] = end_line
        issues.append(issue)
    return issues


async def run_tflint_policy_checks(project_root: Path) -> dict[str, Any]:
    if shutil.which("tflint") is None:
        return _empty_scan_result("tflint_unavailable", "TFLint CLI is not available")
    returncode, raw_stdout, raw_stderr = await _run_command(*_TFLINT_CMD, cwd=project_root)
    if not raw_stdout.strip():
        return _empty_scan_result("tflint_empty_output", raw_stderr.strip() or "TFLint returned empty output")
    try:
        parsed = json.loads(raw_stdout)
    except json.JSONDecodeError:
        return _empty_scan_result("tflint_invalid_json", raw_stderr.strip() or "Failed to parse TFLint JSON output")
    issues = _parse_tflint_report(parsed)
    result: dict[str, Any] = {"issues": issues, "summary": _summary_from_issues(issues)}
    if returncode not in {0, 2}:
        result["scanError"] = _scan_error("tflint_failed", raw_stderr.strip() or f"TFLint exited with status {returncode}")
    elif raw_stderr.strip():
        result["scanError"] = _scan_error("tflint_warning", raw_stderr.strip())
    return result


def _result_issues(result: dict[str, Any]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    target = _target_path(result.get("Target"))
    for mis in result.get("Misconfigurations") or []:
        if not isinstance(mis, dict):
            continue
        row: dict[str, Any] = {
            "source": "trivy",
            "severity": _normalize_severity(mis.get("Severity")),
            "message": str(mis.get("Message") or mis.get("Description") or mis.get("Title") or "Policy issue found"),
            "title": str(mis.get("Title") or mis.get("Message") or "Policy issue"),
            "rule_id": str(mis.get("ID") or mis.get("AVDID") or "").strip(),
        }
        if target:
            row["path"] = target
        issues.append(row)
    for secret in result.get("Secrets") or []:
        if not isinstance(secret, dict):
            continue
        row = {
            "source": "trivy",
            "severity": _normalize_severity(secret.get("Severity")),
            "message": str(secret.get("Title") or secret.get("Match") or "Potential secret detected"),
            "title": str(secret.get("Title") or "Potential secret detected"),
            "rule_id": str(secret.get("RuleID") or secret.get("ID") or "").strip(),
        }
        if target:
            row["path"] = target
        issues.append(row)
    return issues


async def run_trivy_policy_checks(project_root: Path) -> dict[str, Any]:
    if shutil.which("trivy") is None:
        return _empty_scan_result("trivy_unavailable", "Trivy CLI is not available")
    returncode, raw_stdout, raw_stderr = await _run_command(*_TRIVY_CMD, str(project_root), cwd=project_root)
    if not raw_stdout.strip():
        return _empty_scan_result("trivy_empty_output", raw_stderr.strip() or "Trivy returned empty output")
    try:
        report = json.loads(raw_stdout)
    except json.JSONDecodeError:
        return _empty_scan_result("trivy_invalid_json", raw_stderr.strip() or "Failed to parse Trivy JSON output")
    results = report.get("Results") if isinstance(report, dict) else []
    issues: list[dict[str, Any]] = []
    for result in results if isinstance(results, list) else []:
        if isinstance(result, dict):
            issues.extend(_result_issues(result))
    parsed: dict[str, Any] = {"issues": issues, "summary": _summary_from_issues(issues)}
    if returncode != 0:
        parsed["scanError"] = _scan_error("trivy_failed", raw_stderr.strip() or f"Trivy exited with status {returncode}")
    elif raw_stderr.strip():
        parsed["scanError"] = _scan_error("trivy_warning", raw_stderr.strip())
    return parsed


def _merge_results(*results: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for result in results:
        rows = result.get("issues")
        if isinstance(rows, list):
            issues.extend([row for row in rows if isinstance(row, dict)])
        scan_error = result.get("scanError")
        if isinstance(scan_error, dict):
            code = str(scan_error.get("code") or "").strip()
            message = str(scan_error.get("message") or "").strip()
            if code and message:
                errors.append({"code": code, "message": message})
    merged: dict[str, Any] = {"issues": issues, "summary": _summary_from_issues(issues)}
    if errors:
        merged["scanError"] = errors[0] if len(errors) == 1 else {"code": "multi_scan_error", "message": "; ".join(
            f"{item['code']}: {item['message']}" for item in errors
        )}
    return merged


async def run_project_policy_checks(project_id: str) -> dict[str, Any]:
    project_root = project_files.ensure_project_dir(project_id)
    checkov_result = await run_checkov_policy_checks(project_root)
    tflint_result = await run_tflint_policy_checks(project_root)
    merged = _merge_results(checkov_result, tflint_result)
    if merged["issues"]:
        return merged
    if shutil.which("checkov") or shutil.which("tflint"):
        return merged
    trivy_result = await run_trivy_policy_checks(project_root)
    return _merge_results(trivy_result)
