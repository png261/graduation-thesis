"""Terraform target-contract validation and snapshot helpers."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Any

from app.core.config import Settings
from app.services.agent.runtime.iac_templates import (
    ANSIBLE_HOSTS_OUTPUT_NAME,
    CANONICAL_TARGET_CONTRACT_OUTPUT_NAME,
    CONFIGURATION_TARGETS_OUTPUT_NAME,
    TARGET_CONTRACT_DEDUPE_KEY,
    TARGET_CONTRACT_OPTIONAL_FIELDS,
    TARGET_CONTRACT_REQUIRED_FIELDS,
    TARGET_CONTRACT_SCHEMA_VERSION,
)
from app.services.opentofu.runtime.shared import discover_modules_from_project_dir
from app.services.project import files as project_files

_AWS_EXECUTION_ID_RE = re.compile(r"^(?:i|mi)-[A-Za-z0-9]+$")
_SNAPSHOT_PATH = Path(".opentofu-runtime") / "target-contract-latest.json"
_RUNTIME_STATE_ROOT = Path(".opentofu-runtime") / "state"
_STACK_STATE_CANDIDATES: tuple[Path, ...] = (
    _RUNTIME_STATE_ROOT / "stacks-main.tfstate",
    _RUNTIME_STATE_ROOT / "main.tfstate",
    Path("stacks/main/terraform.tfstate"),
    Path("stacks/main/tofu.tfstate"),
)
_TERRAFORM_FILE_SUFFIXES: tuple[str, ...] = (
    ".tf",
    ".tfvars",
    ".tfvars.json",
    ".auto.tfvars",
    ".auto.tfvars.json",
)
_TERRAFORM_DOC_NAMES = {"README.md", "PROVENANCE.md"}
_FINGERPRINT_EXCLUDES = {".git", ".opentofu-runtime", ".agents", ".claude", "AGENTS.md", "CLAUDE.md"}
_CONFLICT_FIELDS: tuple[str, ...] = ("role", *TARGET_CONTRACT_OPTIONAL_FIELDS)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _module_state_candidates(module: str) -> tuple[Path, ...]:
    return (
        _RUNTIME_STATE_ROOT / f"{module}.tfstate",
        Path("modules") / module / "terraform.tfstate",
        Path("modules") / module / "tofu.tfstate",
    )


def _find_existing_path(project_root: Path, candidates: tuple[Path, ...]) -> Path | None:
    for relative_path in candidates:
        candidate = project_root / relative_path
        if candidate.is_file():
            return candidate
    return None


def _read_json_file(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _as_output_value(raw: Any) -> Any:
    if isinstance(raw, dict) and "value" in raw:
        return raw.get("value")
    return raw


def _normalize_string(raw: Any) -> str | None:
    if raw in (None, ""):
        return None
    value = str(raw).strip()
    return value or None


def _normalize_string_list(raw: Any) -> list[str] | None:
    if raw is None:
        return None
    if not isinstance(raw, list):
        return None
    items = sorted({str(item).strip() for item in raw if str(item).strip()})
    return items


def _normalize_map(raw: Any) -> dict[str, str] | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        return None
    normalized: dict[str, str] = {}
    for key, value in raw.items():
        key_text = str(key).strip()
        if not key_text:
            continue
        normalized[key_text] = str(value)
    return normalized or None


def _normalized_target(
    raw: Any,
    *,
    origin: str,
    validation_errors: list[str],
) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        validation_errors.append(f"{origin} must be an object")
        return None

    execution_id = _normalize_string(raw.get("execution_id"))
    if execution_id is None:
        validation_errors.append(f"{origin}.execution_id is required")
        return None
    if not _AWS_EXECUTION_ID_RE.match(execution_id):
        validation_errors.append(
            f"{origin}.execution_id must be an AWS runtime identity (i-... or mi-...)"
        )
        return None

    role = _normalize_string(raw.get("role"))
    if role is None:
        validation_errors.append(f"{origin}.role is required")
        return None

    source_modules = _normalize_string_list(raw.get("source_modules"))
    if source_modules is None:
        validation_errors.append(f"{origin}.source_modules must be a list of module names")
        return None
    if len(source_modules) == 0:
        validation_errors.append(f"{origin}.source_modules must include at least one module")
        return None

    target: dict[str, Any] = {
        "execution_id": execution_id,
        "role": role,
        "source_modules": source_modules,
    }
    for field in TARGET_CONTRACT_OPTIONAL_FIELDS:
        raw_value = raw.get(field)
        if field in {"labels", "tags"}:
            normalized = _normalize_map(raw_value)
            if raw_value is not None and normalized is None:
                validation_errors.append(f"{origin}.{field} must be an object map")
                continue
            if normalized is not None:
                target[field] = normalized
            continue
        normalized = _normalize_string(raw_value)
        if raw_value not in (None, "") and normalized is None:
            validation_errors.append(f"{origin}.{field} must be a string")
            continue
        if normalized is not None:
            target[field] = normalized
    return target


def _target_sort_key(target: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(target.get("execution_id") or ""),
        str(target.get("role") or ""),
        json.dumps(target, sort_keys=True, separators=(",", ":"), ensure_ascii=False),
    )


def merge_canonical_targets(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for item in items:
        execution_id = str(item["execution_id"])
        current = merged.get(execution_id)
        if current is None:
            merged[execution_id] = {
                **item,
                "source_modules": sorted(set(item["source_modules"])),
            }
            continue
        for field in _CONFLICT_FIELDS:
            if current.get(field) != item.get(field):
                raise ValueError(
                    f"execution_id {execution_id} has conflicting metadata for field '{field}'"
                )
        current["source_modules"] = sorted(
            set(current.get("source_modules", [])) | set(item.get("source_modules", []))
        )
    return sorted(merged.values(), key=_target_sort_key)


def _normalize_output_targets(
    items: Any,
    *,
    origin: str,
    validation_errors: list[str],
) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        validation_errors.append(f"{origin} must be a list")
        return []
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        target = _normalized_target(
            item,
            origin=f"{origin}[{index}]",
            validation_errors=validation_errors,
        )
        if target is not None:
            normalized.append(target)
    return normalized


def _state_output(
    *,
    path: Path | None,
    output_name: str,
    owner: str,
    missing_errors: list[str],
    validation_errors: list[str],
) -> Any | None:
    if path is None:
        missing_errors.append(f"{owner}: state file not found for output \"{output_name}\"")
        return None
    payload = _read_json_file(path)
    if payload is None:
        validation_errors.append(f"{owner}: state file is not valid JSON")
        return None
    outputs = payload.get("outputs")
    if not isinstance(outputs, dict):
        validation_errors.append(f"{owner}: state file missing outputs object")
        return None
    if output_name not in outputs:
        validation_errors.append(f"{owner}: missing output \"{output_name}\"")
        return None
    return _as_output_value(outputs[output_name])


def _empty_snapshot(status: str = "unvalidated") -> dict[str, Any]:
    return {
        "status": status,
        "validated_at": None,
        "fingerprint": "",
        "schema_version": TARGET_CONTRACT_SCHEMA_VERSION,
        "module_output_name": CONFIGURATION_TARGETS_OUTPUT_NAME,
        "canonical_output_name": CANONICAL_TARGET_CONTRACT_OUTPUT_NAME,
        "legacy_output_name": ANSIBLE_HOSTS_OUTPUT_NAME,
        "target_count": 0,
        "targets": [],
        "validation_errors": [],
    }


def _snapshot_payload(
    *,
    status: str,
    fingerprint: str,
    targets: list[dict[str, Any]],
    validation_errors: list[str],
) -> dict[str, Any]:
    return {
        **_empty_snapshot(status),
        "validated_at": _now_iso(),
        "fingerprint": fingerprint,
        "target_count": len(targets),
        "targets": targets,
        "validation_errors": validation_errors,
    }


def _write_snapshot(project_id: str, payload: dict[str, Any]) -> None:
    path = project_files.ensure_project_dir(project_id) / _SNAPSHOT_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _status_payload(snapshot: dict[str, Any], *, stale: bool) -> dict[str, Any]:
    return {
        "status": str(snapshot.get("status") or "unvalidated"),
        "stale": stale,
        "validated_at": snapshot.get("validated_at"),
        "target_count": int(snapshot.get("target_count") or 0),
        "targets": list(snapshot.get("targets") or []),
        "validation_errors": list(snapshot.get("validation_errors") or []),
        "schema_version": int(snapshot.get("schema_version") or TARGET_CONTRACT_SCHEMA_VERSION),
        "module_output_name": str(snapshot.get("module_output_name") or CONFIGURATION_TARGETS_OUTPUT_NAME),
        "canonical_output_name": str(
            snapshot.get("canonical_output_name") or CANONICAL_TARGET_CONTRACT_OUTPUT_NAME
        ),
        "legacy_output_name": str(snapshot.get("legacy_output_name") or ANSIBLE_HOSTS_OUTPUT_NAME),
    }


def _is_terraform_fingerprint_path(relative_path: Path) -> bool:
    if not relative_path.parts:
        return False
    if relative_path.parts[0] in _FINGERPRINT_EXCLUDES:
        return False
    name = relative_path.name
    if any(name.endswith(suffix) for suffix in _TERRAFORM_FILE_SUFFIXES):
        return True
    if name in _TERRAFORM_DOC_NAMES and relative_path.parts[0] in {"modules", "stacks"}:
        return True
    return False


def build_terraform_target_fingerprint(project_id: str) -> str:
    project_root = project_files.ensure_project_dir(project_id)
    digest = hashlib.sha256()
    for candidate in sorted(project_root.rglob("*")):
        if not candidate.is_file():
            continue
        relative_path = candidate.relative_to(project_root)
        if not _is_terraform_fingerprint_path(relative_path):
            continue
        digest.update(relative_path.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(candidate.read_bytes()).digest())
        digest.update(b"\0")
    return digest.hexdigest()


def read_target_contract_snapshot(project_id: str) -> dict[str, Any]:
    path = project_files.ensure_project_dir(project_id) / _SNAPSHOT_PATH
    payload = _read_json_file(path)
    if payload is None:
        return _empty_snapshot()
    return {
        **_empty_snapshot(str(payload.get("status") or "unvalidated")),
        **payload,
        "targets": list(payload.get("targets") or []),
        "validation_errors": list(payload.get("validation_errors") or []),
    }


def get_target_contract_status(project_id: str) -> dict[str, Any]:
    snapshot = read_target_contract_snapshot(project_id)
    current_fingerprint = build_terraform_target_fingerprint(project_id)
    stale = (
        str(snapshot.get("status") or "") == "valid"
        and bool(snapshot.get("fingerprint"))
        and str(snapshot.get("fingerprint")) != current_fingerprint
    )
    return _status_payload(snapshot, stale=stale)


def validate_target_contract(project_id: str, settings: Settings) -> dict[str, Any]:
    _ = settings
    project_root = project_files.ensure_project_dir(project_id)
    fingerprint = build_terraform_target_fingerprint(project_id)
    modules = discover_modules_from_project_dir(project_id)
    if len(modules) == 0:
        payload = _snapshot_payload(
            status="missing",
            fingerprint=fingerprint,
            targets=[],
            validation_errors=["No Terraform modules found to validate"],
        )
        _write_snapshot(project_id, payload)
        return _status_payload(payload, stale=False)

    missing_errors: list[str] = []
    validation_errors: list[str] = []
    module_targets: list[dict[str, Any]] = []

    for module in modules:
        state_value = _state_output(
            path=_find_existing_path(project_root, _module_state_candidates(module)),
            output_name=CONFIGURATION_TARGETS_OUTPUT_NAME,
            owner=f"modules/{module}",
            missing_errors=missing_errors,
            validation_errors=validation_errors,
        )
        if state_value is None:
            continue
        module_targets.extend(
            _normalize_output_targets(
                state_value,
                origin=f"modules/{module}:{CONFIGURATION_TARGETS_OUTPUT_NAME}",
                validation_errors=validation_errors,
            )
        )

    canonical_value = _state_output(
        path=_find_existing_path(project_root, _STACK_STATE_CANDIDATES),
        output_name=CANONICAL_TARGET_CONTRACT_OUTPUT_NAME,
        owner="stacks/main",
        missing_errors=missing_errors,
        validation_errors=validation_errors,
    )
    canonical_targets = (
        _normalize_output_targets(
            canonical_value,
            origin=CANONICAL_TARGET_CONTRACT_OUTPUT_NAME,
            validation_errors=validation_errors,
        )
        if canonical_value is not None
        else []
    )

    try:
        merged_targets = merge_canonical_targets(module_targets)
    except ValueError as exc:
        validation_errors.append(f"{CONFIGURATION_TARGETS_OUTPUT_NAME}: {exc}")
        merged_targets = []

    if not validation_errors and not missing_errors:
        sorted_canonical = sorted(canonical_targets, key=_target_sort_key)
        if sorted_canonical != merged_targets:
            validation_errors.append(
                f"{CANONICAL_TARGET_CONTRACT_OUTPUT_NAME}: canonical output does not match merged module targets"
            )

    status = "valid"
    if validation_errors:
        status = "invalid"
    elif missing_errors:
        status = "missing"

    target_list = sorted(canonical_targets, key=_target_sort_key) if status == "valid" else []
    payload = _snapshot_payload(
        status=status,
        fingerprint=fingerprint,
        targets=target_list,
        validation_errors=[*missing_errors, *validation_errors],
    )
    _write_snapshot(project_id, payload)
    return _status_payload(payload, stale=False)


__all__ = [
    "build_terraform_target_fingerprint",
    "get_target_contract_status",
    "merge_canonical_targets",
    "read_target_contract_snapshot",
    "validate_target_contract",
]
