"""Ansible configuration visualization helpers."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_TASK_NAME_RE = re.compile(r"^\s*-\s*name:\s*(.+?)\s*$")
_MODULE_LINE_RE = re.compile(r"^\s*(?:-\s*)?([A-Za-z0-9_.]+)\s*:\s*(.*?)\s*$")
_KEY_VALUE_RE = re.compile(r"^\s*([A-Za-z0-9_]+)\s*:\s*(.*?)\s*$")
_LIST_ITEM_RE = re.compile(r"^\s*-\s*(.+?)\s*$")
_QUOTE_RE = re.compile(r"^['\"]?(.*?)['\"]?$")
_ACCESS_KEY_RE = re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")
_SECRET_PAIR_RE = re.compile(
    r"(?im)\b((?:api[_-]?key|token|secret|password|license[_-]?key|aws_secret_access_key)\b\s*[:=]\s*)([^\s\"']+)"
)

_PACKAGE_MODULE_SUFFIXES = ("package", "apt", "yum", "dnf", "homebrew", "apk", "pacman")
_SERVICE_MODULE_SUFFIXES = ("service", "systemd")
_FILE_MODULE_SUFFIXES = ("copy", "template", "file")
_POST_DEPLOY_TEXT_LIMIT = 1200
PostDeployChecks = dict[str, Any]


def _clean_scalar(value: str) -> str:
    text = value.strip()
    if not text:
        return ""
    return _QUOTE_RE.sub(r"\1", text).strip()


def _walk_yaml_files(root: Path) -> list[Path]:
    files: list[Path] = []
    if not root.exists():
        return files
    for suffix in ("*.yml", "*.yaml"):
        files.extend(path for path in root.rglob(suffix) if path.is_file())
    files.sort()
    return files


def _collect_block(lines: list[str], start_index: int, base_indent: int) -> tuple[dict[str, str], list[str], int]:
    values: dict[str, str] = {}
    lists_by_key: dict[str, list[str]] = {}
    current_list_key: str | None = None
    idx = start_index
    while idx < len(lines):
        line = lines[idx]
        raw = line.rstrip("\n")
        if not raw.strip():
            idx += 1
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        if indent <= base_indent:
            break
        key_match = _KEY_VALUE_RE.match(raw)
        if key_match:
            key = key_match.group(1).strip()
            value = _clean_scalar(key_match.group(2))
            if value:
                values[key] = value
                current_list_key = None
            else:
                current_list_key = key
                lists_by_key.setdefault(key, [])
            idx += 1
            continue
        if current_list_key:
            list_match = _LIST_ITEM_RE.match(raw)
            if list_match:
                item = _clean_scalar(list_match.group(1))
                if item:
                    lists_by_key[current_list_key].append(item)
        idx += 1
    combined_list: list[str] = []
    for key in ("name", "pkg", "packages"):
        if key in lists_by_key:
            combined_list.extend(lists_by_key[key])
    return values, combined_list, idx


def _module_kind(module_name: str) -> str:
    short = module_name.rsplit(".", 1)[-1]
    if short in _PACKAGE_MODULE_SUFFIXES:
        return "package"
    if short in _SERVICE_MODULE_SUFFIXES:
        return "service"
    if short in _FILE_MODULE_SUFFIXES:
        return "file"
    return "other"


def _record_sorted_unique(items: set[str], limit: int = 40) -> list[str]:
    ordered = sorted(item for item in items if item.strip())
    return ordered[:limit]


def collect_config_visualization(project_root: Path) -> dict[str, Any]:
    playbook_files = _walk_yaml_files(project_root / "playbooks")
    role_files = _walk_yaml_files(project_root / "roles")
    all_files = playbook_files + role_files

    task_names: set[str] = set()
    package_targets: set[str] = set()
    service_targets: set[str] = set()
    file_targets: set[str] = set()
    module_counts: dict[str, int] = {}

    for path in all_files:
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        idx = 0
        while idx < len(lines):
            line = lines[idx]
            task_match = _TASK_NAME_RE.match(line)
            if task_match:
                task_names.add(_clean_scalar(task_match.group(1)))

            module_match = _MODULE_LINE_RE.match(line)
            if not module_match:
                idx += 1
                continue
            module_name = (module_match.group(1) or "").strip()
            if not module_name:
                idx += 1
                continue

            module_counts[module_name] = module_counts.get(module_name, 0) + 1
            base_indent = len(line) - len(line.lstrip(" "))
            inline_value = _clean_scalar(module_match.group(2) or "")
            values, list_values, next_idx = _collect_block(lines, idx + 1, base_indent)
            kind = _module_kind(module_name)

            if kind == "package":
                if inline_value:
                    package_targets.add(inline_value)
                if values.get("name"):
                    package_targets.add(values["name"])
                for item in list_values:
                    package_targets.add(item)
            elif kind == "service":
                target = values.get("name") or inline_value
                if target:
                    service_targets.add(target)
            elif kind == "file":
                target = values.get("dest") or values.get("path") or inline_value
                if target:
                    file_targets.add(target)
            idx = max(next_idx, idx + 1)

    top_modules = sorted(
        [{"module": name, "count": count} for name, count in module_counts.items()],
        key=lambda item: (-item["count"], item["module"]),
    )[:8]
    return {
        "playbook_files": [path.relative_to(project_root).as_posix() for path in playbook_files],
        "role_task_files": [path.relative_to(project_root).as_posix() for path in role_files],
        "task_names": _record_sorted_unique(task_names, limit=60),
        "package_targets": _record_sorted_unique(package_targets),
        "service_targets": _record_sorted_unique(service_targets),
        "file_targets": _record_sorted_unique(file_targets),
        "module_usage_top": top_modules,
    }


def default_post_deploy_checks() -> PostDeployChecks:
    return {
        "services": ["sshd"],
        "package_versions": ["python3"],
        "health_checks": [
            {
                "name": "Host command path",
                "type": "command",
                "command": "command -v python3",
                "success_contains": "python3",
            }
        ],
        "service_logs": [{"name": "System Journal", "command": "journalctl -n 40 --no-pager"}],
    }


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    seen: set[str] = set()
    items: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        text = item.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        items.append(text)
    return items


def _int_value(value: Any, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _latest_run_transport(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    target_ids = _string_list(value.get("target_ids"))
    display_names = _string_list(value.get("display_names"))
    return {
        "mode": str(value.get("mode") or "unknown"),
        "target_count": _int_value(value.get("target_count"), len(target_ids)),
        "target_ids": target_ids,
        "display_names": display_names,
    }


def read_latest_run_summary(project_root: Path) -> dict[str, Any] | None:
    path = project_root / ".ansible-runtime" / "latest-run.json"
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    transport = _latest_run_transport(payload.get("transport"))
    target_ids = _string_list(payload.get("target_ids"))
    if not target_ids and transport is not None:
        target_ids = list(transport.get("target_ids") or [])
    target_count = _int_value(payload.get("target_count"))
    if target_count < 1:
        target_count = int(
            (transport or {}).get("target_count") or len(target_ids) or _int_value(payload.get("host_count"))
        )
    payload["transport"] = transport
    payload["selected_modules"] = _string_list(payload.get("selected_modules")) or _string_list(payload.get("modules"))
    payload["target_count"] = target_count
    payload["target_ids"] = target_ids
    return payload


def resolve_post_deploy_checks(checks: PostDeployChecks | dict[str, Any] | None) -> PostDeployChecks:
    fallback = default_post_deploy_checks()
    source = checks if isinstance(checks, dict) else {}
    health_checks = [
        dict(item)
        for item in source.get("health_checks", [])
        if isinstance(item, dict) and isinstance(item.get("name"), str)
    ]
    service_logs = [
        dict(item)
        for item in source.get("service_logs", [])
        if isinstance(item, dict) and isinstance(item.get("name"), str)
    ]
    return {
        "services": _string_list(source.get("services")) or list(fallback["services"]),
        "package_versions": _string_list(source.get("package_versions")) or list(fallback["package_versions"]),
        "health_checks": health_checks or [dict(item) for item in fallback["health_checks"]],
        "service_logs": service_logs or [dict(item) for item in fallback["service_logs"]],
    }


def redact_secrets(value: Any) -> tuple[Any, bool]:
    if isinstance(value, str):
        redacted = False
        text = value
        replaced = _ACCESS_KEY_RE.sub("[redacted]", text)
        if replaced != text:
            redacted = True
            text = replaced
        replaced = _SECRET_PAIR_RE.sub(r"\1[redacted]", text)
        if replaced != text:
            redacted = True
            text = replaced
        return text, redacted
    if isinstance(value, list):
        redacted = False
        items: list[Any] = []
        for item in value:
            next_value, next_redacted = redact_secrets(item)
            redacted = redacted or next_redacted
            items.append(next_value)
        return items, redacted
    if isinstance(value, dict):
        redacted = False
        normalized: dict[str, Any] = {}
        for key, item in value.items():
            next_value, next_redacted = redact_secrets(item)
            redacted = redacted or next_redacted
            normalized[str(key)] = next_value
        return normalized, redacted
    return value, False


def sanitize_post_deploy_text(text: Any, *, limit: int = _POST_DEPLOY_TEXT_LIMIT) -> dict[str, Any]:
    raw_text = "" if text is None else str(text)
    redacted_text, redacted = redact_secrets(raw_text)
    normalized = str(redacted_text)
    truncated = len(normalized) > limit
    content = normalized
    truncated_reason: str | None = None
    if truncated:
        content = normalized[:limit].rstrip() + "\n...[truncated]"
        truncated_reason = f"Exceeded {limit} characters"
    return {
        "content": content,
        "truncated": truncated,
        "redacted": redacted,
        "truncated_reason": truncated_reason,
    }


def summarize_post_deploy_result(result: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(result, dict):
        return None
    post_deploy = result.get("post_deploy")
    if not isinstance(post_deploy, dict):
        return None
    hosts = post_deploy.get("hosts") if isinstance(post_deploy.get("hosts"), list) else []
    skipped_hosts = post_deploy.get("skipped_hosts") if isinstance(post_deploy.get("skipped_hosts"), list) else []
    summary = post_deploy.get("summary") if isinstance(post_deploy.get("summary"), dict) else {}
    return {
        "status": str(post_deploy.get("status") or summary.get("status") or "failed"),
        "host_count": int(summary.get("host_count") or len(hosts)),
        "skipped_host_count": int(summary.get("skipped_host_count") or len(skipped_hosts)),
        "service_count": int(summary.get("service_count") or 0),
        "health_summary": str(summary.get("health_summary") or "No health checks collected."),
        "collected_at": post_deploy.get("collected_at"),
    }
