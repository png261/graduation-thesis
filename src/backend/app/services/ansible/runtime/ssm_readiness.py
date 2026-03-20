"""AWS SSM readiness helpers for Ansible execution gating."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import Settings
from app.services.opentofu.runtime import target_contract as target_contract_service
from app.services.opentofu.runtime.shared import load_project
from app.services.project import credentials as project_credentials

DEFAULT_SSM_READY_TIMEOUT_SECONDS = 1200
SSM_READY_POLL_INTERVAL_SECONDS = 15
SSM_RECENT_CHECKIN_SECONDS = 900


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _scope_mode(selected_modules: list[str]) -> str:
    return "partial" if selected_modules else "full"


def _selected_modules(selected_modules: list[str]) -> list[str]:
    return sorted({str(module).strip() for module in selected_modules if str(module).strip()})


def _empty_snapshot(*, selected_modules: list[str], timeout_seconds: int) -> dict[str, Any]:
    return {
        "status": "unvalidated",
        "blocking": True,
        "scope_mode": _scope_mode(selected_modules),
        "selected_modules": _selected_modules(selected_modules),
        "checked_at": _now_iso(),
        "timeout_seconds": timeout_seconds,
        "target_count": 0,
        "ready_target_count": 0,
        "pending_target_count": 0,
        "failed_target_count": 0,
        "blocker_code": None,
        "blocker_message": "",
        "targets": [],
        "failed_targets": [],
    }


def _target_contract_blocker(target_contract: dict[str, Any]) -> tuple[str, str]:
    if bool(target_contract.get("stale")):
        return (
            "terraform_target_contract_stale",
            "Terraform target preview is stale. Refresh Target Preview before deploy.",
        )
    if str(target_contract.get("status") or "") == "invalid":
        errors = [str(item) for item in target_contract.get("validation_errors", [])]
        return (
            "terraform_target_contract_invalid",
            errors[0] if errors else "Terraform target preview is invalid.",
        )
    return (
        "terraform_target_contract_missing",
        "No validated Terraform target preview is available yet.",
    )


def _base_target_entry(target: dict[str, Any]) -> dict[str, Any]:
    expected_platform = str(target.get("platform") or "").strip() or None
    return {
        "execution_id": str(target.get("execution_id") or ""),
        "resolved_instance_id": None,
        "resolved_managed_instance_id": None,
        "display_name": str(target.get("display_name") or target.get("execution_id") or ""),
        "role": str(target.get("role") or ""),
        "source_modules": sorted(str(item) for item in list(target.get("source_modules") or [])),
        "expected_platform": expected_platform,
        "registration_status": "missing",
        "ping_status": "unknown",
        "platform_status": "unknown",
        "last_seen_at": None,
        "ready": False,
        "blocking_reason": None,
    }


def _normalize_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _ping_status(info: dict[str, Any] | None) -> str:
    if not info:
        return "unknown"
    value = str(info.get("PingStatus") or "").strip().lower()
    if value == "online":
        return "online"
    if value == "offline":
        return "offline"
    return "unknown"


def _platform_status(expected_platform: str | None, info: dict[str, Any] | None) -> str:
    actual = str((info or {}).get("PlatformType") or "").strip()
    if not expected_platform or not actual:
        return "unknown"
    return "matched" if expected_platform.lower() == actual.lower() else "mismatch"


def _resolved_instance_id(info: dict[str, Any] | None) -> str | None:
    if not info:
        return None
    for value in (info.get("SourceId"), info.get("InstanceId")):
        text = str(value or "").strip()
        if text.startswith("i-"):
            return text
    return None


def _resolved_managed_instance_id(info: dict[str, Any] | None) -> str | None:
    if not info:
        return None
    for value in (info.get("InstanceId"), info.get("SourceId")):
        text = str(value or "").strip()
        if text.startswith("mi-"):
            return text
    return None


def _last_seen_at(info: dict[str, Any] | None) -> str | None:
    if not info:
        return None
    value = _normalize_datetime(info.get("LastPingDateTime"))
    return value.isoformat() if value is not None else None


def _is_recent(last_seen_at: str | None, now: datetime) -> bool:
    seen_at = _normalize_datetime(last_seen_at)
    if seen_at is None:
        return False
    return seen_at >= now - timedelta(seconds=SSM_RECENT_CHECKIN_SECONDS)


def _target_ready(entry: dict[str, Any], *, now: datetime) -> tuple[bool, str | None]:
    if entry["registration_status"] != "registered":
        return False, "Target is not registered in AWS Systems Manager."
    if entry["ping_status"] != "online":
        return False, "Target is not online in AWS Systems Manager."
    if not _is_recent(entry["last_seen_at"], now):
        return False, "Target has not checked in recently in AWS Systems Manager."
    if entry["platform_status"] == "mismatch":
        expected = str(entry.get("expected_platform") or "expected platform")
        return False, f"Target platform does not match {expected}."
    return True, None


def _make_blocked_snapshot(
    *,
    targets: list[dict[str, Any]],
    selected_modules: list[str],
    timeout_seconds: int,
    status: str,
    blocker_code: str,
    blocker_message: str,
) -> dict[str, Any]:
    snapshot = _empty_snapshot(selected_modules=selected_modules, timeout_seconds=timeout_seconds)
    snapshot.update(
        {
            "status": status,
            "blocking": True,
            "target_count": len(targets),
            "pending_target_count": len(targets) if status == "waiting" else 0,
            "failed_target_count": len(targets) if status == "failed" else 0,
            "blocker_code": blocker_code,
            "blocker_message": blocker_message,
            "targets": targets,
            "failed_targets": targets if status == "failed" else [],
        }
    )
    return snapshot


def resolve_scoped_targets(project_id: str, selected_modules: list[str]) -> dict[str, Any]:
    normalized_selected = _selected_modules(selected_modules)
    target_contract = target_contract_service.get_target_contract_status(project_id)
    if str(target_contract.get("status") or "") != "valid" or bool(target_contract.get("stale")):
        blocker_code, blocker_message = _target_contract_blocker(target_contract)
        return {
            "status": "unvalidated",
            "blocking": True,
            "scope_mode": _scope_mode(normalized_selected),
            "selected_modules": normalized_selected,
            "targets": [],
            "target_count": 0,
            "blocker_code": blocker_code,
            "blocker_message": blocker_message,
        }
    all_targets = [dict(item) for item in list(target_contract.get("targets") or []) if isinstance(item, dict)]
    if not normalized_selected:
        scoped_targets = all_targets
    else:
        scoped_targets = []
        selected = set(normalized_selected)
        for item in all_targets:
            source_modules = {str(module) for module in list(item.get("source_modules") or [])}
            if source_modules & selected:
                scoped_targets.append(item)
    if not scoped_targets:
        return {
            "status": "no_targets",
            "blocking": True,
            "scope_mode": _scope_mode(normalized_selected),
            "selected_modules": normalized_selected,
            "targets": [],
            "target_count": 0,
            "blocker_code": "ssm_no_targets_in_scope",
            "blocker_message": "No Terraform targets match the selected configuration scope.",
        }
    return {
        "status": "ready",
        "blocking": False,
        "scope_mode": _scope_mode(normalized_selected),
        "selected_modules": normalized_selected,
        "targets": scoped_targets,
        "target_count": len(scoped_targets),
        "blocker_code": None,
        "blocker_message": "",
    }


def _ssm_lookup(instance_information: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for info in instance_information:
        if not isinstance(info, dict):
            continue
        for field in ("InstanceId", "SourceId"):
            key = str(info.get(field) or "").strip()
            if key:
                lookup[key] = info
    return lookup


def _describe_instance_information(credentials: dict[str, str]) -> list[dict[str, Any]]:
    kwargs = {
        "aws_access_key_id": credentials.get("aws_access_key_id"),
        "aws_secret_access_key": credentials.get("aws_secret_access_key"),
        "aws_session_token": credentials.get("aws_session_token"),
        "region_name": credentials.get("aws_region"),
    }
    client = boto3.client("ssm", **{key: value for key, value in kwargs.items() if value})
    items: list[dict[str, Any]] = []
    next_token: str | None = None
    while True:
        request: dict[str, Any] = {"MaxResults": 50}
        if next_token:
            request["NextToken"] = next_token
        payload = client.describe_instance_information(**request)
        rows = payload.get("InstanceInformationList") if isinstance(payload, dict) else []
        if isinstance(rows, list):
            items.extend(row for row in rows if isinstance(row, dict))
        next_token = str(payload.get("NextToken") or "").strip() or None
        if next_token is None:
            break
    return items


async def get_ssm_readiness(
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
) -> dict[str, Any]:
    _ = settings
    timeout_seconds = DEFAULT_SSM_READY_TIMEOUT_SECONDS
    snapshot = _empty_snapshot(selected_modules=selected_modules, timeout_seconds=timeout_seconds)
    resolved = resolve_scoped_targets(project_id, selected_modules)
    snapshot.update(
        {
            "status": str(resolved.get("status") or "unvalidated"),
            "blocking": bool(resolved.get("blocking")),
            "scope_mode": str(resolved.get("scope_mode") or snapshot["scope_mode"]),
            "selected_modules": list(resolved.get("selected_modules") or snapshot["selected_modules"]),
        }
    )
    if resolved["status"] == "unvalidated":
        snapshot["blocker_code"] = resolved["blocker_code"]
        snapshot["blocker_message"] = resolved["blocker_message"]
        return snapshot
    if resolved["status"] == "no_targets":
        snapshot["status"] = "no_targets"
        snapshot["blocker_code"] = resolved["blocker_code"]
        snapshot["blocker_message"] = resolved["blocker_message"]
        return snapshot

    scoped_targets = [dict(item) for item in list(resolved.get("targets") or [])]
    target_entries = [_base_target_entry(target) for target in scoped_targets]
    project = await load_project(project_id)
    if project is None:
        return _make_blocked_snapshot(
            targets=target_entries,
            selected_modules=selected_modules,
            timeout_seconds=timeout_seconds,
            status="blocked",
            blocker_code="project_not_found",
            blocker_message="Project not found.",
        )
    if project.provider != "aws":
        return _make_blocked_snapshot(
            targets=target_entries,
            selected_modules=selected_modules,
            timeout_seconds=timeout_seconds,
            status="blocked",
            blocker_code="ssm_provider_unsupported",
            blocker_message="AWS Systems Manager readiness is available only for AWS projects.",
        )

    credentials = project_credentials.parse_credentials(project.credentials)
    required = ("aws_access_key_id", "aws_secret_access_key", "aws_region")
    if any(not credentials.get(field) for field in required):
        return _make_blocked_snapshot(
            targets=target_entries,
            selected_modules=selected_modules,
            timeout_seconds=timeout_seconds,
            status="blocked",
            blocker_code="ssm_credentials_missing",
            blocker_message="Saved AWS credentials are incomplete for AWS Systems Manager readiness.",
        )

    try:
        lookup = _ssm_lookup(await asyncio.to_thread(_describe_instance_information, credentials))
    except (BotoCoreError, ClientError, RuntimeError) as exc:
        return _make_blocked_snapshot(
            targets=target_entries,
            selected_modules=selected_modules,
            timeout_seconds=timeout_seconds,
            status="blocked",
            blocker_code="ssm_query_failed",
            blocker_message=str(exc) or "AWS Systems Manager readiness check failed.",
        )

    now = _now()
    evaluated_targets: list[dict[str, Any]] = []
    for target, entry in zip(scoped_targets, target_entries, strict=False):
        info = lookup.get(entry["execution_id"])
        entry["resolved_instance_id"] = _resolved_instance_id(info)
        entry["resolved_managed_instance_id"] = _resolved_managed_instance_id(info)
        entry["registration_status"] = "registered" if info is not None else "missing"
        entry["ping_status"] = _ping_status(info)
        entry["platform_status"] = _platform_status(entry["expected_platform"], info)
        entry["last_seen_at"] = _last_seen_at(info)
        entry["ready"], entry["blocking_reason"] = _target_ready(entry, now=now)
        if info is not None and not entry["display_name"]:
            entry["display_name"] = str(info.get("Name") or entry["execution_id"])
        elif not entry["display_name"]:
            entry["display_name"] = str(target.get("execution_id") or "")
        evaluated_targets.append(entry)

    ready_count = sum(1 for item in evaluated_targets if item["ready"])
    pending_targets = [item for item in evaluated_targets if not item["ready"]]
    snapshot.update(
        {
            "status": "ready" if not pending_targets else "waiting",
            "blocking": bool(pending_targets),
            "target_count": len(evaluated_targets),
            "ready_target_count": ready_count,
            "pending_target_count": len(pending_targets),
            "targets": evaluated_targets,
            "failed_targets": [],
        }
    )
    if pending_targets:
        snapshot["blocker_code"] = "ssm_target_not_ready"
        snapshot["blocker_message"] = (
            f"AWS Systems Manager is still waiting for {len(pending_targets)} target(s) to become ready."
        )
    return snapshot


async def wait_for_ssm_readiness(
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    *,
    timeout_seconds: int = DEFAULT_SSM_READY_TIMEOUT_SECONDS,
    poll_interval_seconds: int = SSM_READY_POLL_INTERVAL_SECONDS,
    cancel_checker: Callable[[], Awaitable[bool]] | None = None,
    progress: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
) -> dict[str, Any]:
    deadline = _now() + timedelta(seconds=max(timeout_seconds, 0))
    latest_snapshot = _empty_snapshot(selected_modules=selected_modules, timeout_seconds=timeout_seconds)
    while True:
        latest_snapshot = await get_ssm_readiness(project_id, settings, selected_modules)
        latest_snapshot["timeout_seconds"] = timeout_seconds
        if progress is not None:
            await progress(latest_snapshot)
        if not latest_snapshot["blocking"]:
            return latest_snapshot
        if latest_snapshot["status"] in {"unvalidated", "no_targets", "blocked"}:
            return latest_snapshot
        if cancel_checker is not None and await cancel_checker():
            latest_snapshot["status"] = "failed"
            latest_snapshot["pending_target_count"] = 0
            latest_snapshot["failed_target_count"] = sum(1 for item in latest_snapshot["targets"] if not item["ready"])
            latest_snapshot["failed_targets"] = [item for item in latest_snapshot["targets"] if not item["ready"]]
            latest_snapshot["blocker_code"] = "config_canceled"
            latest_snapshot["blocker_message"] = "Configuration run canceled"
            return latest_snapshot
        if _now() >= deadline:
            failed_targets = [item for item in latest_snapshot["targets"] if not item["ready"]]
            latest_snapshot["status"] = "failed"
            latest_snapshot["pending_target_count"] = 0
            latest_snapshot["failed_target_count"] = len(failed_targets)
            latest_snapshot["failed_targets"] = failed_targets
            latest_snapshot["blocker_code"] = "ssm_readiness_timeout"
            latest_snapshot["blocker_message"] = (
                f"AWS Systems Manager readiness did not complete within {timeout_seconds} seconds."
            )
            return latest_snapshot
        await asyncio.sleep(max(poll_interval_seconds, 1))
