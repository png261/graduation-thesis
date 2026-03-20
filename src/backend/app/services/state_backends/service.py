from __future__ import annotations

import asyncio
import base64
import json
import os
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, select

from app import db
from app.core.config import Settings, get_settings
from app.models import DriftAlert, PolicyAlert, Project, StateBackend, StateResource, StateSnapshot, StateSyncRun
from app.services.incident import service as incident_service
from app.services.jobs import service as jobs_service
from app.services.opentofu.runtime.shared import discover_modules_from_project_dir
from app.services.project import files as project_files
from app.services.telegram import notifications as telegram_notifications

from .cloud_adapters import (
    CloudAdapter,
    get_cloud_adapter,
    likely_state_objects,
    normalize_cloud_provider,
    parse_state_payload,
)
from .credential_profiles import resolve_profile_credentials
from .crypto import decrypt_text
from .scanners import scan_backend_candidates

DRIFT_REFRESH_MAX_AGE_MINUTES = 60


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _to_provider(provider: str | None) -> str:
    if not provider:
        return ""
    raw = provider.lower()
    if "aws" in raw:
        return "aws"
    if "google" in raw or "gcp" in raw:
        return "gcs"
    return raw


def _serialize_backend(row: StateBackend) -> dict[str, Any]:
    return {
        "id": row.id,
        "project_id": row.project_id,
        "name": row.name,
        "source_type": row.source_type,
        "provider": row.provider,
        "status": row.status,
        "bucket_name": row.bucket_name,
        "object_key": row.object_key,
        "object_prefix": row.object_prefix,
        "repository": row.repository,
        "branch": row.branch,
        "path": row.path,
        "schedule_minutes": row.schedule_minutes,
        "retention_days": row.retention_days,
        "versioning_enabled": row.versioning_enabled,
        "warning": row.warning,
        "settings": row.settings_json or {},
        "last_sync_at": _iso(row.last_sync_at),
        "last_error": row.last_error,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
    }


def _is_primary_for_deploy(settings: dict[str, Any] | None) -> bool:
    return bool((settings or {}).get("primary_for_deploy"))


def _normalize_settings_patch(settings: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(settings)
    if not normalized.get("primary_for_deploy"):
        normalized.pop("primary_for_deploy", None)
    return normalized


async def _load_project(project_id: str) -> Project | None:
    async with db.get_session() as session:
        return await session.get(Project, project_id)


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _refresh_timestamp(sync_run: dict[str, Any] | None) -> str | None:
    if not isinstance(sync_run, dict):
        return None
    finished_at = sync_run.get("finished_at")
    if isinstance(finished_at, str) and finished_at:
        return finished_at
    created_at = sync_run.get("created_at")
    if isinstance(created_at, str) and created_at:
        return created_at
    return None


def _freshness_minutes(last_successful_refresh_at: str | None) -> int | None:
    parsed = _parse_iso_datetime(last_successful_refresh_at)
    if parsed is None:
        return None
    delta = _now() - parsed
    return max(0, int(delta.total_seconds() // 60))


async def get_local_runtime_drift_status(*, project_id: str, user_id: str) -> dict[str, Any]:
    modules = discover_modules_from_project_dir(project_id)
    project_root = project_files.ensure_project_dir(project_id)
    state_root = project_root / ".opentofu-runtime" / "state"
    modules_without_state = [module for module in modules if not (state_root / f"{module}.tfstate").is_file()]

    latest_plan = await jobs_service.list_jobs(
        project_id=project_id,
        user_id=user_id,
        status=None,
        kind="plan",
        limit=1,
        offset=0,
    )
    latest_apply = await jobs_service.list_jobs(
        project_id=project_id,
        user_id=user_id,
        status=None,
        kind="apply",
        limit=1,
        offset=0,
    )

    latest_plan_job = latest_plan["items"][0] if latest_plan["items"] else None
    latest_apply_job = latest_apply["items"][0] if latest_apply["items"] else None

    if not modules:
        status = "no_modules"
    elif modules_without_state:
        status = "state_missing"
    elif not latest_plan_job:
        status = "plan_missing"
    elif latest_apply_job and str(latest_plan_job.get("created_at", "")) < str(latest_apply_job.get("created_at", "")):
        status = "plan_outdated"
    else:
        status = "in_sync"

    return {
        "status": status,
        "module_count": len(modules),
        "modules_without_state": modules_without_state,
        "last_plan_job": latest_plan_job,
        "last_apply_job": latest_apply_job,
    }


def _deploy_drift_status(
    *,
    primary_backend: dict[str, Any],
    latest_sync: dict[str, Any] | None,
    last_successful_refresh_at: str | None,
    freshness_minutes: int | None,
    active_drift_alert_count: int,
) -> tuple[str, bool, str]:
    if primary_backend.get("last_error") or str((latest_sync or {}).get("status") or "") == "failed":
        return "error", True, str(primary_backend.get("last_error") or "Primary backend drift refresh failed.")
    if last_successful_refresh_at is None or freshness_minutes is None or freshness_minutes > DRIFT_REFRESH_MAX_AGE_MINUTES:
        return "refresh_required", True, "Refresh the primary backend drift status before deploy."
    if active_drift_alert_count > 0:
        return "drift_detected", True, f"{active_drift_alert_count} active drift alert(s) detected."
    return "in_sync", False, "Primary backend drift status is fresh and in sync."


def _serialize_resource(row: StateResource, *, show_sensitive: bool) -> dict[str, Any]:
    attrs = row.attributes_json or {}
    if show_sensitive:
        return {
            "id": row.id,
            "address": row.address,
            "resource_type": row.resource_type,
            "resource_name": row.resource_name,
            "provider": row.provider,
            "status": row.status,
            "cloud_id": row.cloud_id,
            "console_url": row.console_url,
            "attributes": attrs,
            "sensitive_fields": row.sensitive_fields_json or [],
            "last_updated_at": _iso(row.last_updated_at),
        }
    masked = dict(attrs)
    for field in row.sensitive_fields_json or []:
        if isinstance(field, str) and field in masked:
            masked[field] = "****"
    return {
        "id": row.id,
        "address": row.address,
        "resource_type": row.resource_type,
        "resource_name": row.resource_name,
        "provider": row.provider,
        "status": row.status,
        "cloud_id": row.cloud_id,
        "console_url": row.console_url,
        "attributes": masked,
        "sensitive_fields": row.sensitive_fields_json or [],
        "last_updated_at": _iso(row.last_updated_at),
    }


def _serialize_alert(row: DriftAlert | PolicyAlert) -> dict[str, Any]:
    payload = {
        "id": row.id,
        "backend_id": row.backend_id,
        "severity": row.severity,
        "status": row.status,
        "details": row.details_json or {},
        "first_detected_at": _iso(row.first_detected_at),
        "last_detected_at": _iso(row.last_detected_at),
        "resolved_at": _iso(row.resolved_at),
    }
    if isinstance(row, DriftAlert):
        payload.update(
            {
                "resource_address": row.resource_address,
                "remediation": row.remediation_json,
            }
        )
    if isinstance(row, PolicyAlert):
        payload.update(
            {
                "resource_address": row.resource_address,
                "rule_id": row.rule_id,
            }
        )
    return payload


def _hash_attributes(attrs: dict[str, Any]) -> str:
    raw = json.dumps(attrs, sort_keys=True, default=str, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8")


def _parse_provider_from_tf(value: str | None) -> str | None:
    if not value:
        return None
    text = value.lower()
    if "hashicorp/aws" in text or "aws" in text:
        return "aws"
    if "hashicorp/google" in text or "google" in text:
        return "gcs"
    return None


def _resolve_console_url(provider: str | None, resource_type: str, attrs: dict[str, Any]) -> str | None:
    if provider == "aws":
        return _resolve_aws_console(resource_type, attrs)
    if provider == "gcs":
        return _resolve_gcp_console(resource_type, attrs)
    return None


def _resolve_aws_console(resource_type: str, attrs: dict[str, Any]) -> str | None:
    region = str(attrs.get("region") or attrs.get("availability_zone") or "")
    if region and len(region) > 1 and region[-1].isalpha() and region[-2] == "-":
        region = region[:-2]
    if not region:
        region = "us-east-1"
    item_id = str(attrs.get("id") or "")
    if resource_type == "aws_instance" and item_id:
        return f"https://{region}.console.aws.amazon.com/ec2/home?region={region}#InstanceDetails:instanceId={item_id}"
    if resource_type == "aws_s3_bucket":
        bucket = str(attrs.get("bucket") or attrs.get("id") or "")
        if bucket:
            return f"https://s3.console.aws.amazon.com/s3/buckets/{bucket}"
    if resource_type == "aws_vpc" and item_id:
        return f"https://{region}.console.aws.amazon.com/vpcconsole/home?region={region}#VpcDetails:VpcId={item_id}"
    return None


def _resolve_gcp_console(resource_type: str, attrs: dict[str, Any]) -> str | None:
    item_id = str(attrs.get("id") or "")
    if resource_type == "google_storage_bucket":
        bucket = str(attrs.get("name") or item_id or "")
        if bucket:
            return f"https://console.cloud.google.com/storage/browser/{bucket}"
    if resource_type == "google_compute_instance" and item_id:
        return "https://console.cloud.google.com/compute/instancesDetail"
    return None


def _extract_resource_instances(state: dict[str, Any]) -> list[dict[str, Any]]:
    resources = state.get("resources") if isinstance(state, dict) else []
    if not isinstance(resources, list):
        return []
    extracted: list[dict[str, Any]] = []
    for row in resources:
        if not isinstance(row, dict):
            continue
        res_type = str(row.get("type") or "").strip()
        name = str(row.get("name") or "").strip()
        module = str(row.get("module") or "").strip()
        provider = _parse_provider_from_tf(str(row.get("provider") or ""))
        instances = row.get("instances") if isinstance(row.get("instances"), list) else []
        if not instances:
            continue
        for index, inst in enumerate(instances):
            if not isinstance(inst, dict):
                continue
            attrs = inst.get("attributes") if isinstance(inst.get("attributes"), dict) else {}
            addr = f"{res_type}.{name}"
            if module:
                addr = f"{module}.{addr}"
            if len(instances) > 1:
                addr = f"{addr}[{index}]"
            sensitive = inst.get("sensitive_attributes")
            sensitive_fields = sensitive if isinstance(sensitive, list) else []
            cloud_id = str(attrs.get("id") or attrs.get("name") or "") or None
            extracted.append(
                {
                    "address": addr,
                    "resource_type": res_type,
                    "resource_name": name,
                    "provider": provider,
                    "cloud_id": cloud_id,
                    "attributes": attrs,
                    "sensitive_fields": sensitive_fields,
                    "console_url": _resolve_console_url(provider, res_type, attrs),
                }
            )
    return extracted


def _resource_diff(previous: list[StateResource], current: list[dict[str, Any]]) -> dict[str, int]:
    before = {row.address: _hash_attributes(row.attributes_json or {}) for row in previous}
    after = {row["address"]: _hash_attributes(row.get("attributes", {})) for row in current}
    added = len(set(after.keys()) - set(before.keys()))
    deleted = len(set(before.keys()) - set(after.keys()))
    changed = 0
    for address in set(before.keys()) & set(after.keys()):
        if before[address] != after[address]:
            changed += 1
    return {"added": added, "deleted": deleted, "changed": changed}


def _aws_credentials_from_profile(profile: dict[str, str]) -> dict[str, str]:
    return {
        "aws_access_key_id": profile.get("aws_access_key_id", ""),
        "aws_secret_access_key": profile.get("aws_secret_access_key", ""),
        "aws_session_token": profile.get("aws_session_token", ""),
        "aws_region": profile.get("aws_region", ""),
    }


def _check_aws_resource(resource: dict[str, Any], credentials: dict[str, str]) -> tuple[str, str]:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError

    attrs = resource.get("attributes") if isinstance(resource.get("attributes"), dict) else {}
    resource_type = str(resource.get("resource_type") or "")
    region = str(attrs.get("region") or credentials.get("aws_region") or "us-east-1")
    kwargs = {
        "aws_access_key_id": credentials.get("aws_access_key_id"),
        "aws_secret_access_key": credentials.get("aws_secret_access_key"),
        "aws_session_token": credentials.get("aws_session_token"),
        "region_name": region,
    }
    client_kwargs = {key: val for key, val in kwargs.items() if val}
    try:
        if resource_type == "aws_s3_bucket":
            bucket = str(attrs.get("bucket") or attrs.get("id") or "")
            if not bucket:
                return "unverifiable", "missing_bucket_name"
            boto3.client("s3", **client_kwargs).head_bucket(Bucket=bucket)
            return "active", "bucket_exists"
        if resource_type == "aws_instance":
            iid = str(attrs.get("id") or "")
            if not iid:
                return "unverifiable", "missing_instance_id"
            payload = boto3.client("ec2", **client_kwargs).describe_instances(InstanceIds=[iid])
            reservations = payload.get("Reservations") if isinstance(payload, dict) else []
            if not reservations:
                return "drifted", "instance_missing"
            return "active", "instance_exists"
        if resource_type == "aws_vpc":
            vid = str(attrs.get("id") or "")
            if not vid:
                return "unverifiable", "missing_vpc_id"
            payload = boto3.client("ec2", **client_kwargs).describe_vpcs(VpcIds=[vid])
            vpcs = payload.get("Vpcs") if isinstance(payload, dict) else []
            if not vpcs:
                return "drifted", "vpc_missing"
            return "active", "vpc_exists"
        if resource_type == "aws_subnet":
            sid = str(attrs.get("id") or "")
            if not sid:
                return "unverifiable", "missing_subnet_id"
            payload = boto3.client("ec2", **client_kwargs).describe_subnets(SubnetIds=[sid])
            subnets = payload.get("Subnets") if isinstance(payload, dict) else []
            if not subnets:
                return "drifted", "subnet_missing"
            return "active", "subnet_exists"
        if resource_type == "aws_security_group":
            gid = str(attrs.get("id") or "")
            if not gid:
                return "unverifiable", "missing_group_id"
            payload = boto3.client("ec2", **client_kwargs).describe_security_groups(GroupIds=[gid])
            groups = payload.get("SecurityGroups") if isinstance(payload, dict) else []
            if not groups:
                return "drifted", "security_group_missing"
            return "active", "security_group_exists"
        if resource_type == "aws_db_instance":
            did = str(attrs.get("identifier") or attrs.get("id") or "")
            if not did:
                return "unverifiable", "missing_db_identifier"
            payload = boto3.client("rds", **client_kwargs).describe_db_instances(DBInstanceIdentifier=did)
            dbs = payload.get("DBInstances") if isinstance(payload, dict) else []
            if not dbs:
                return "drifted", "db_missing"
            return "active", "db_exists"
    except (ClientError, BotoCoreError) as exc:
        message = str(exc).lower()
        if "not found" in message or "404" in message:
            return "drifted", "resource_missing"
        return "unverifiable", str(exc)
    return "unverifiable", "unsupported_aws_resource"


def _check_gcs_resource(resource: dict[str, Any], credentials: dict[str, str]) -> tuple[str, str]:
    from google.api_core.exceptions import GoogleAPIError
    from google.cloud import storage

    attrs = resource.get("attributes") if isinstance(resource.get("attributes"), dict) else {}
    resource_type = str(resource.get("resource_type") or "")
    if resource_type != "google_storage_bucket":
        return "unverifiable", "unsupported_gcp_resource"
    bucket_name = str(attrs.get("name") or attrs.get("id") or "")
    if not bucket_name:
        return "unverifiable", "missing_bucket_name"
    raw = credentials.get("gcp_credentials_json")
    if raw:
        client = storage.Client.from_service_account_info(json.loads(raw))
    else:
        client = storage.Client()
    try:
        exists = client.bucket(bucket_name).exists(client)
    except GoogleAPIError as exc:
        return "unverifiable", str(exc)
    return ("active", "bucket_exists") if exists else ("drifted", "bucket_missing")


def _reconcile_resource(resource: dict[str, Any], credentials: dict[str, str], provider: str) -> tuple[str, str]:
    if provider == "aws":
        return _check_aws_resource(resource, _aws_credentials_from_profile(credentials))
    if provider == "gcs":
        return _check_gcs_resource(resource, credentials)
    return "unverifiable", "unsupported_provider"


def _severity_for_status(status: str) -> str:
    if status == "drifted":
        return "high"
    if status == "unverifiable":
        return "medium"
    return "low"


async def list_state_backends(*, project_id: str) -> list[dict[str, Any]]:
    async with db.get_session() as session:
        rows = await session.execute(
            select(StateBackend).where(StateBackend.project_id == project_id).order_by(StateBackend.created_at.asc())
        )
        backends = rows.scalars().all()
    return [_serialize_backend(row) for row in backends]


async def get_state_backend(*, project_id: str, backend_id: str) -> StateBackend:
    async with db.get_session() as session:
        rows = await session.execute(
            select(StateBackend).where(StateBackend.project_id == project_id, StateBackend.id == backend_id)
        )
        backend = rows.scalar_one_or_none()
    if backend is None:
        raise ValueError("backend_not_found")
    return backend


async def browse_cloud_buckets(
    *,
    user_id: str,
    provider: str,
    credential_profile_id: str,
    settings: Settings,
) -> list[str]:
    profile_provider, credentials = await resolve_profile_credentials(
        profile_id=credential_profile_id,
        user_id=user_id,
        secret=settings.state_encryption_key,
    )
    normalized = normalize_cloud_provider(provider)
    if profile_provider != normalized:
        raise ValueError("profile_provider_mismatch")
    adapter = get_cloud_adapter(normalized, credentials)
    return adapter.list_buckets()


async def browse_cloud_objects(
    *,
    user_id: str,
    provider: str,
    credential_profile_id: str,
    bucket: str,
    prefix: str,
    settings: Settings,
) -> list[dict[str, Any]]:
    profile_provider, credentials = await resolve_profile_credentials(
        profile_id=credential_profile_id,
        user_id=user_id,
        secret=settings.state_encryption_key,
    )
    normalized = normalize_cloud_provider(provider)
    if profile_provider != normalized:
        raise ValueError("profile_provider_mismatch")
    adapter = get_cloud_adapter(normalized, credentials)
    objects = likely_state_objects(adapter.list_objects(bucket=bucket, prefix=prefix or ""))
    return [
        {
            "key": item.key,
            "size": item.size,
            "updated_at": item.updated_at,
        }
        for item in objects
    ]


async def _create_backend(
    *,
    project_id: str,
    name: str,
    source_type: str,
    provider: str,
    credential_profile_id: str,
    bucket_name: str,
    object_key: str,
    object_prefix: str,
    repository: str | None,
    branch: str | None,
    path: str | None,
) -> StateBackend:
    backend = StateBackend(
        id=str(uuid4()),
        project_id=project_id,
        credential_profile_id=credential_profile_id,
        name=(name or "").strip() or f"{provider}-{bucket_name}",
        source_type=source_type,
        provider=provider,
        status="connected",
        bucket_name=bucket_name,
        object_key=object_key,
        object_prefix=object_prefix,
        repository=repository,
        branch=branch,
        path=path,
        schedule_minutes=60,
        retention_days=90,
        settings_json={"notifications": {"telegram": True}},
    )
    async with db.get_session() as session:
        session.add(backend)
    return backend


async def import_cloud_backend(
    *,
    project: Project,
    user_id: str,
    provider: str,
    name: str,
    credential_profile_id: str,
    bucket: str,
    key: str,
    prefix: str,
    settings: Settings,
) -> dict[str, Any]:
    normalized = normalize_cloud_provider(provider)
    profile_provider, credentials = await resolve_profile_credentials(
        profile_id=credential_profile_id,
        user_id=user_id,
        secret=settings.state_encryption_key,
    )
    if profile_provider != normalized:
        raise ValueError("profile_provider_mismatch")
    adapter = get_cloud_adapter(normalized, credentials)
    object_key = (key or "").strip()
    object_prefix = (prefix or "").strip()
    if not object_key:
        objects = likely_state_objects(adapter.list_objects(bucket=bucket, prefix=object_prefix))
        if not objects:
            raise ValueError("state_object_not_found")
        object_key = objects[0].key
    backend = await _create_backend(
        project_id=project.id,
        name=name,
        source_type="cloud",
        provider=normalized,
        credential_profile_id=credential_profile_id,
        bucket_name=bucket,
        object_key=object_key,
        object_prefix=object_prefix,
        repository=None,
        branch=None,
        path=None,
    )
    await run_backend_sync(
        backend_id=backend.id,
        triggered_by="manual_import",
        settings=settings,
    )
    return _serialize_backend(backend)


def _is_scan_candidate_path(path: str) -> bool:
    lower = path.lower()
    if lower.endswith(".tf"):
        return True
    return any(token in lower for token in ("gitlab-ci", "github/workflows", ".env"))


async def _github_fetch_files(access_token: str, repo_full_name: str, branch: str | None) -> list[tuple[str, str]]:
    def _load_files() -> list[tuple[str, str]]:
        repo = repo_full_name.strip()
        if "/" not in repo:
            raise ValueError("invalid_repo_full_name")
        try:
            from github import Auth, Github
        except Exception as exc:  # pragma: no cover - import failure path
            raise RuntimeError("github_sdk_unavailable") from exc
        client = Github(auth=Auth.Token(access_token), per_page=100)
        try:
            repository = client.get_repo(repo)
            ref = (branch or "").strip() or str(getattr(repository, "default_branch", "") or "HEAD")
            tree = repository.get_git_tree(ref, recursive=True).tree
            files: list[tuple[str, str]] = []
            for node in tree:
                path = str(getattr(node, "path", "") or "")
                if not path or str(getattr(node, "type", "") or "") != "blob":
                    continue
                if not _is_scan_candidate_path(path):
                    continue
                blob = repository.get_git_blob(str(getattr(node, "sha", "") or ""))
                encoded = str(getattr(blob, "content", "") or "")
                if not encoded:
                    continue
                decoded = base64.b64decode(encoded).decode("utf-8", errors="ignore")
                files.append((path, decoded))
            return files
        except Exception as exc:
            raise RuntimeError(str(exc) or "github_tree_failed") from exc
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                close()

    return await asyncio.to_thread(_load_files)


async def _gitlab_fetch_files(access_token: str, repo_full_name: str, branch: str | None, settings: Settings) -> list[tuple[str, str]]:
    def _load_files() -> list[tuple[str, str]]:
        try:
            import gitlab
        except Exception as exc:  # pragma: no cover - import failure path
            raise RuntimeError("gitlab_sdk_unavailable") from exc
        try:
            client = gitlab.Gitlab(settings.gitlab_api_url, oauth_token=access_token, per_page=100)
            client.auth()
            project = client.projects.get(repo_full_name.strip())
            ref = (branch or "").strip() or str(getattr(project, "default_branch", "") or "main")
            tree = project.repository_tree(path="", ref=ref, recursive=True, all=True)
        except Exception as exc:
            raise RuntimeError(str(exc) or "gitlab_tree_failed") from exc

        files: list[tuple[str, str]] = []
        for row in tree:
            if not isinstance(row, dict) or row.get("type") != "blob":
                continue
            path = str(row.get("path") or "").strip()
            if not path or not _is_scan_candidate_path(path):
                continue
            try:
                file_obj = project.files.get(file_path=path, ref=ref)
                encoded = str(getattr(file_obj, "content", "") or "")
                if not encoded:
                    continue
                decoded = base64.b64decode(encoded).decode("utf-8", errors="ignore")
                files.append((path, decoded))
            except Exception:
                continue
        return files

    return await asyncio.to_thread(_load_files)


async def import_from_github_repo(
    *,
    project: Project,
    user_id: str,
    access_token: str,
    repo_full_name: str,
    branch: str | None,
    credential_profile_id: str,
    selected_candidates: list[dict[str, str]] | None,
    dry_run: bool,
    settings: Settings,
) -> dict[str, Any]:
    files = await _github_fetch_files(access_token, repo_full_name, branch)
    discovered = scan_backend_candidates(files)
    if dry_run:
        return {"discovered": discovered, "created": []}
    chosen = selected_candidates if selected_candidates else discovered
    if not chosen:
        raise ValueError("no_backend_candidate_found")
    created: list[dict[str, Any]] = []
    for item in chosen:
        backend = await import_cloud_backend(
            project=project,
            user_id=user_id,
            provider=str(item.get("provider") or ""),
            name=str(item.get("name") or f"github:{repo_full_name}"),
            credential_profile_id=credential_profile_id,
            bucket=str(item.get("bucket") or ""),
            key=str(item.get("key") or ""),
            prefix=str(item.get("prefix") or ""),
            settings=settings,
        )
        await _update_backend_source(
            backend_id=backend["id"],
            source_type="github",
            repository=repo_full_name,
            branch=branch,
        )
        created.append(backend)
    return {"discovered": discovered, "created": created}


async def import_from_gitlab_repo(
    *,
    project: Project,
    user_id: str,
    access_token: str,
    repo_full_name: str,
    branch: str | None,
    credential_profile_id: str,
    selected_candidates: list[dict[str, str]] | None,
    dry_run: bool,
    settings: Settings,
) -> dict[str, Any]:
    files = await _gitlab_fetch_files(access_token, repo_full_name, branch, settings)
    discovered = scan_backend_candidates(files)
    if dry_run:
        return {"discovered": discovered, "created": []}
    chosen = selected_candidates if selected_candidates else discovered
    if not chosen:
        raise ValueError("no_backend_candidate_found")
    created: list[dict[str, Any]] = []
    for item in chosen:
        backend = await import_cloud_backend(
            project=project,
            user_id=user_id,
            provider=str(item.get("provider") or ""),
            name=str(item.get("name") or f"gitlab:{repo_full_name}"),
            credential_profile_id=credential_profile_id,
            bucket=str(item.get("bucket") or ""),
            key=str(item.get("key") or ""),
            prefix=str(item.get("prefix") or ""),
            settings=settings,
        )
        await _update_backend_source(
            backend_id=backend["id"],
            source_type="gitlab",
            repository=repo_full_name,
            branch=branch,
        )
        created.append(backend)
    return {"discovered": discovered, "created": created}


async def _update_backend_source(
    *,
    backend_id: str,
    source_type: str,
    repository: str | None,
    branch: str | None,
) -> None:
    async with db.get_session() as session:
        backend = await session.get(StateBackend, backend_id)
        if backend is None:
            return
        backend.source_type = source_type
        backend.repository = repository
        backend.branch = branch


def _parse_opa_output(payload: dict[str, Any]) -> Any:
    result = payload.get("result") if isinstance(payload, dict) else []
    if not isinstance(result, list) or not result:
        return None
    first = result[0]
    if not isinstance(first, dict):
        return None
    expressions = first.get("expressions")
    if not isinstance(expressions, list) or not expressions:
        return None
    expression = expressions[0]
    if not isinstance(expression, dict):
        return None
    return expression.get("value")


async def _evaluate_policies(
    *,
    project_id: str,
    backend: StateBackend,
    resources: list[dict[str, Any]],
    snapshot_summary: dict[str, Any],
) -> list[dict[str, Any]]:
    project_root = project_files.ensure_project_dir(project_id)
    policies_dir = project_root / "policies"
    if not policies_dir.exists() or not policies_dir.is_dir():
        return []
    rego_files = list(policies_dir.rglob("*.rego"))
    if not rego_files:
        return []
    opa_path = os.getenv("OPA_BIN", "opa")
    if not shutil_which(opa_path):
        return [
            {
                "rule_id": "opa_unavailable",
                "resource_address": "*",
                "severity": "medium",
                "details": {"message": "OPA binary not available"},
            }
        ]

    payload = {
        "backend": _serialize_backend(backend),
        "summary": snapshot_summary,
        "resources": resources,
    }
    with tempfile.NamedTemporaryFile("w", delete=False, suffix=".json") as tmp:
        json.dump(payload, tmp)
        tmp_path = Path(tmp.name)
    alerts: list[dict[str, Any]] = []
    try:
        deny = await _opa_eval(opa_path, policies_dir, tmp_path, "data.statebackends.deny")
        if isinstance(deny, list):
            for idx, row in enumerate(deny):
                alerts.append(
                    {
                        "rule_id": f"deny_{idx + 1}",
                        "resource_address": "*",
                        "severity": "high",
                        "details": {"message": str(row)},
                    }
                )
        extra = await _opa_eval(opa_path, policies_dir, tmp_path, "data.statebackends.alerts")
        if isinstance(extra, list):
            for row in extra:
                if not isinstance(row, dict):
                    continue
                alerts.append(
                    {
                        "rule_id": str(row.get("rule_id") or "policy_violation"),
                        "resource_address": str(row.get("resource_address") or row.get("resource") or "*"),
                        "severity": str(row.get("severity") or "medium"),
                        "details": {"message": str(row.get("message") or "Policy violation")},
                    }
                )
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
    return alerts


async def _opa_eval(opa_path: str, policies_dir: Path, input_path: Path, query: str) -> Any:
    process = await asyncio.create_subprocess_exec(
        opa_path,
        "eval",
        "--format",
        "json",
        "--data",
        str(policies_dir),
        "--input",
        str(input_path),
        query,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await process.communicate()
    if process.returncode != 0:
        raise RuntimeError((err or out).decode("utf-8", errors="ignore") or "opa_eval_failed")
    payload = json.loads(out.decode("utf-8"))
    return _parse_opa_output(payload)


def shutil_which(binary: str) -> str | None:
    return subprocess.run(["/usr/bin/which", binary], capture_output=True, text=True).stdout.strip() or None


async def _upsert_drift_alerts(
    *,
    session,
    backend_id: str,
    drift_items: list[dict[str, Any]],
) -> list[DriftAlert]:
    existing_rows = await session.execute(select(DriftAlert).where(DriftAlert.backend_id == backend_id))
    existing = {row.resource_address: row for row in existing_rows.scalars().all()}
    active_addresses = {row["resource_address"] for row in drift_items}
    now = _now()

    for address, row in existing.items():
        if address in active_addresses:
            continue
        row.status = "resolved"
        row.resolved_at = now

    active: list[DriftAlert] = []
    for item in drift_items:
        address = item["resource_address"]
        current = existing.get(address)
        if current is None:
            current = DriftAlert(
                id=str(uuid4()),
                backend_id=backend_id,
                resource_address=address,
                severity=item["severity"],
                status="active",
                details_json=item["details"],
                first_detected_at=now,
                last_detected_at=now,
            )
            session.add(current)
        else:
            current.status = "active"
            current.severity = item["severity"]
            current.details_json = item["details"]
            current.last_detected_at = now
            current.resolved_at = None
        active.append(current)
    return active


async def _upsert_policy_alerts(
    *,
    session,
    backend_id: str,
    alerts: list[dict[str, Any]],
) -> list[PolicyAlert]:
    existing_rows = await session.execute(select(PolicyAlert).where(PolicyAlert.backend_id == backend_id))
    existing = {(row.rule_id, row.resource_address): row for row in existing_rows.scalars().all()}
    active_keys = {(row["rule_id"], row["resource_address"]) for row in alerts}
    now = _now()

    for key, row in existing.items():
        if key in active_keys:
            continue
        row.status = "resolved"
        row.resolved_at = now

    active: list[PolicyAlert] = []
    for item in alerts:
        key = (item["rule_id"], item["resource_address"])
        current = existing.get(key)
        if current is None:
            current = PolicyAlert(
                id=str(uuid4()),
                backend_id=backend_id,
                rule_id=item["rule_id"],
                resource_address=item["resource_address"],
                severity=item["severity"],
                status="active",
                details_json=item["details"],
                first_detected_at=now,
                last_detected_at=now,
            )
            session.add(current)
        else:
            current.status = "active"
            current.severity = item["severity"]
            current.details_json = item["details"]
            current.last_detected_at = now
            current.resolved_at = None
        active.append(current)
    return active


async def _notify_alerts_if_needed(
    *,
    project_id: str,
    backend: StateBackend,
    drift_alerts: list[DriftAlert],
    policy_alerts: list[PolicyAlert],
    settings: Settings,
) -> dict[str, Any] | None:
    if not drift_alerts and not policy_alerts:
        return None
    correlation_id = str(uuid4())
    recent_jobs = await incident_service.recent_project_jobs(project_id=project_id, limit=20)
    decision, memories, events = await incident_service.build_decision(
        backend=backend,
        drift_alerts=drift_alerts,
        policy_alerts=policy_alerts,
        recent_jobs=recent_jobs,
        correlation_id=correlation_id,
        settings=settings,
    )
    summary = await incident_service.store_incident_summary(
        project_id=project_id,
        backend_id=backend.id,
        decision=decision,
        memories=memories,
        correlation_id=correlation_id,
    )
    severity_set = set(settings.state_alert_notify_severity_list())
    relevant_drift = [row for row in drift_alerts if row.severity.lower() in severity_set and row.status == "active"]
    relevant_policy = [row for row in policy_alerts if row.severity.lower() in severity_set and row.status == "active"]
    should_notify = bool(relevant_drift or relevant_policy)
    if should_notify:
        should_notify = await incident_service.should_emit_alert(
            project_id=project_id,
            incident_key=decision["incident_key"],
            settings=settings,
        )
    if should_notify:
        lines = [
            f"State backend: {backend.name}",
            f"Provider: {backend.provider}",
            f"Active drift alerts: {len(relevant_drift)}",
            f"Active policy alerts: {len(relevant_policy)}",
            f"Severity: {decision['severity']}",
            f"Confidence: {decision['confidence']:.2f}",
            f"Recommended action: {decision['recommended_action']}",
        ]
        await telegram_notifications.notify_by_project_id(project_id, settings, "\n".join(lines))
    if decision["action_class"] == incident_service.ACTION_BLOCKED:
        events.append(
            {
                "type": "incident.action.blocked",
                "correlationId": correlation_id,
                "incidentKey": decision["incident_key"],
                "reason": "blocked_action_class",
            }
        )
    return {
        "summary": summary,
        "decision": decision,
        "events": events,
        "memories": memories,
        "correlation_id": correlation_id,
        "notified": should_notify,
    }


async def _cleanup_retention(session, backend: StateBackend) -> None:
    retention = max(1, int(backend.retention_days or 90))
    cutoff = _now() - timedelta(days=retention)
    await session.execute(
        delete(StateSnapshot).where(StateSnapshot.backend_id == backend.id, StateSnapshot.created_at < cutoff)
    )
    await session.execute(
        delete(StateSyncRun).where(StateSyncRun.backend_id == backend.id, StateSyncRun.created_at < cutoff)
    )


async def _resolve_backend_runtime(
    *,
    session,
    backend: StateBackend,
    cfg: Settings,
) -> tuple[str, dict[str, str], CloudAdapter]:
    project = await session.get(Project, backend.project_id)
    if project is None:
        raise ValueError("project_not_found")
    user_id = str(project.user_id or "")
    if not user_id:
        raise ValueError("project_owner_required")
    if not backend.credential_profile_id:
        raise ValueError("credential_profile_required")

    provider, credentials = await resolve_profile_credentials(
        profile_id=backend.credential_profile_id,
        user_id=user_id,
        secret=cfg.state_encryption_key,
    )
    return provider, credentials, get_cloud_adapter(provider, credentials)


async def _snapshot_backend_state(
    *,
    session,
    backend: StateBackend,
    adapter: CloudAdapter,
) -> tuple[list[dict[str, Any]], dict[str, int], StateSnapshot]:
    cloud = adapter.read_object(bucket=str(backend.bucket_name or ""), key=str(backend.object_key or ""))
    state = parse_state_payload(cloud.payload)
    resources = _extract_resource_instances(state)
    prev_rows = await session.execute(select(StateResource).where(StateResource.backend_id == backend.id))
    previous_resources = prev_rows.scalars().all()
    diff = _resource_diff(previous_resources, resources)
    snapshot = StateSnapshot(
        id=str(uuid4()),
        backend_id=backend.id,
        source_version=cloud.version,
        source_generation=cloud.generation,
        source_etag=cloud.etag,
        source_updated_at=datetime.fromisoformat(cloud.updated_at) if cloud.updated_at else None,
        resource_count=len(resources),
        summary_json=diff,
        state_json=state,
    )
    session.add(snapshot)
    await session.flush()
    return resources, diff, snapshot


async def _replace_state_resources(
    *,
    session,
    backend: StateBackend,
    snapshot: StateSnapshot,
    resources: list[dict[str, Any]],
    credentials: dict[str, str],
    provider: str,
) -> tuple[list[StateResource], list[dict[str, Any]]]:
    await session.execute(delete(StateResource).where(StateResource.backend_id == backend.id))
    resource_rows: list[StateResource] = []
    drift_items: list[dict[str, Any]] = []
    for item in resources:
        status, reason = _reconcile_resource(item, credentials, provider)
        if status != "active":
            drift_items.append(
                {
                    "resource_address": item["address"],
                    "severity": _severity_for_status(status),
                    "details": {
                        "status": status,
                        "reason": reason,
                        "resource_type": item["resource_type"],
                        "provider": item.get("provider"),
                    },
                }
            )
        row = StateResource(
            id=str(uuid4()),
            backend_id=backend.id,
            snapshot_id=snapshot.id,
            address=item["address"],
            resource_type=item["resource_type"],
            resource_name=item["resource_name"],
            provider=item.get("provider"),
            status=status,
            cloud_id=item.get("cloud_id"),
            console_url=item.get("console_url"),
            attributes_json=item.get("attributes") or {},
            sensitive_fields_json=item.get("sensitive_fields") or [],
            last_updated_at=_now(),
        )
        session.add(row)
        resource_rows.append(row)
    return resource_rows, drift_items


def _policy_payload_rows(resource_rows: list[StateResource]) -> list[dict[str, Any]]:
    return [
        {
            "address": row.address,
            "type": row.resource_type,
            "provider": row.provider,
            "status": row.status,
            "attributes": row.attributes_json,
        }
        for row in resource_rows
    ]


def _active_alert_count(rows: list[DriftAlert] | list[PolicyAlert]) -> int:
    return len([row for row in rows if row.status == "active"])


def _build_sync_summary(
    *,
    resources: list[dict[str, Any]],
    diff: dict[str, int],
    active_drift: list[DriftAlert],
    active_policy: list[PolicyAlert],
) -> dict[str, Any]:
    return {
        "resource_count": len(resources),
        "drift_alerts": _active_alert_count(active_drift),
        "policy_alerts": _active_alert_count(active_policy),
        "diff": diff,
    }


def _update_backend_sync_metadata(backend: StateBackend, adapter: CloudAdapter) -> None:
    backend.last_sync_at = _now()
    backend.last_error = None
    backend.warning = None
    backend.versioning_enabled = adapter.is_versioning_enabled(bucket=str(backend.bucket_name or ""))
    if backend.versioning_enabled is False:
        backend.warning = "Bucket versioning is disabled. State history is limited to sync snapshots."


async def _execute_backend_sync(
    *,
    session,
    backend: StateBackend,
    cfg: Settings,
) -> dict[str, Any]:
    provider, credentials, adapter = await _resolve_backend_runtime(session=session, backend=backend, cfg=cfg)
    resources, diff, snapshot = await _snapshot_backend_state(session=session, backend=backend, adapter=adapter)
    resource_rows, drift_items = await _replace_state_resources(
        session=session,
        backend=backend,
        snapshot=snapshot,
        resources=resources,
        credentials=credentials,
        provider=provider,
    )
    policy_matches = await _evaluate_policies(
        project_id=backend.project_id,
        backend=backend,
        resources=_policy_payload_rows(resource_rows),
        snapshot_summary=diff,
    )
    active_drift = await _upsert_drift_alerts(session=session, backend_id=backend.id, drift_items=drift_items)
    active_policy = await _upsert_policy_alerts(session=session, backend_id=backend.id, alerts=policy_matches)
    _update_backend_sync_metadata(backend, adapter)
    await _cleanup_retention(session, backend)
    summary = _build_sync_summary(
        resources=resources,
        diff=diff,
        active_drift=active_drift,
        active_policy=active_policy,
    )
    await session.flush()
    incident_result = await _notify_alerts_if_needed(
        project_id=backend.project_id,
        backend=backend,
        drift_alerts=active_drift,
        policy_alerts=active_policy,
        settings=cfg,
    )
    return {"summary": summary, "incident": incident_result}


async def run_backend_sync(
    *,
    backend_id: str,
    triggered_by: str = "manual",
    settings: Settings | None = None,
) -> dict[str, Any]:
    cfg = settings or get_settings()
    async with db.get_session() as session:
        backend = await session.get(StateBackend, backend_id)
        if backend is None:
            raise ValueError("backend_not_found")

        run = StateSyncRun(
            id=str(uuid4()),
            backend_id=backend.id,
            triggered_by=triggered_by,
            status="running",
            started_at=_now(),
            summary_json={},
        )
        session.add(run)
        await session.flush()

        try:
            result = await _execute_backend_sync(session=session, backend=backend, cfg=cfg)
            run.status = "succeeded"
            run.finished_at = _now()
            run.summary_json = {
                **result["summary"],
                "incident": result.get("incident"),
            }
            await session.flush()

            return {
                "run_id": run.id,
                "status": "succeeded",
                "summary": run.summary_json,
                "backend": _serialize_backend(backend),
            }
        except Exception as exc:
            run.status = "failed"
            run.finished_at = _now()
            run.error_message = str(exc)
            backend.last_error = str(exc)
            backend.status = "error"
            await session.flush()
            raise


async def list_state_resources(
    *,
    project_id: str,
    backend_id: str,
    search: str = "",
    show_sensitive: bool = False,
) -> list[dict[str, Any]]:
    await get_state_backend(project_id=project_id, backend_id=backend_id)
    async with db.get_session() as session:
        rows = await session.execute(
            select(StateResource)
            .where(StateResource.backend_id == backend_id)
            .order_by(StateResource.address.asc())
        )
        resources = rows.scalars().all()
    needle = (search or "").strip().lower()
    if needle:
        resources = [
            row
            for row in resources
            if needle in row.address.lower() or needle in row.resource_type.lower() or needle in row.resource_name.lower()
        ]
    return [_serialize_resource(row, show_sensitive=show_sensitive) for row in resources]


async def list_state_history(*, project_id: str, backend_id: str, search: str = "") -> list[dict[str, Any]]:
    await get_state_backend(project_id=project_id, backend_id=backend_id)
    async with db.get_session() as session:
        rows = await session.execute(
            select(StateSnapshot)
            .where(StateSnapshot.backend_id == backend_id)
            .order_by(StateSnapshot.created_at.desc())
        )
        snapshots = rows.scalars().all()
    needle = (search or "").strip().lower()
    output: list[dict[str, Any]] = []
    for row in snapshots:
        summary = row.summary_json if isinstance(row.summary_json, dict) else {}
        payload = {
            "id": row.id,
            "version": row.source_version or row.source_generation,
            "etag": row.source_etag,
            "resource_count": row.resource_count,
            "added": int(summary.get("added", 0) or 0),
            "deleted": int(summary.get("deleted", 0) or 0),
            "changed": int(summary.get("changed", 0) or 0),
            "created_at": _iso(row.created_at),
            "source_updated_at": _iso(row.source_updated_at),
        }
        if needle and needle not in json.dumps(payload).lower():
            continue
        output.append(payload)
    return output


async def list_drift_alerts(*, project_id: str, backend_id: str, active_only: bool = False, search: str = "") -> list[dict[str, Any]]:
    await get_state_backend(project_id=project_id, backend_id=backend_id)
    async with db.get_session() as session:
        query = select(DriftAlert).where(DriftAlert.backend_id == backend_id)
        if active_only:
            query = query.where(DriftAlert.status == "active")
        rows = await session.execute(query.order_by(DriftAlert.last_detected_at.desc()))
        alerts = rows.scalars().all()
    needle = (search or "").strip().lower()
    if needle:
        alerts = [
            row for row in alerts if needle in row.resource_address.lower() or needle in json.dumps(row.details_json or {}).lower()
        ]
    return [_serialize_alert(row) for row in alerts]


async def list_policy_alerts(*, project_id: str, backend_id: str, active_only: bool = False, search: str = "") -> list[dict[str, Any]]:
    await get_state_backend(project_id=project_id, backend_id=backend_id)
    async with db.get_session() as session:
        query = select(PolicyAlert).where(PolicyAlert.backend_id == backend_id)
        if active_only:
            query = query.where(PolicyAlert.status == "active")
        rows = await session.execute(query.order_by(PolicyAlert.last_detected_at.desc()))
        alerts = rows.scalars().all()
    needle = (search or "").strip().lower()
    if needle:
        alerts = [
            row
            for row in alerts
            if needle in row.resource_address.lower() or needle in row.rule_id.lower() or needle in json.dumps(row.details_json or {}).lower()
        ]
    return [_serialize_alert(row) for row in alerts]


async def update_backend_settings(
    *,
    project_id: str,
    backend_id: str,
    name: str | None,
    schedule_minutes: int | None,
    retention_days: int | None,
    settings_patch: dict[str, Any] | None,
) -> dict[str, Any]:
    async with db.get_session() as session:
        rows = await session.execute(
            select(StateBackend).where(StateBackend.project_id == project_id, StateBackend.id == backend_id)
        )
        backend = rows.scalar_one_or_none()
        if backend is None:
            raise ValueError("backend_not_found")
        if name is not None and name.strip():
            backend.name = name.strip()
        if schedule_minutes is not None:
            backend.schedule_minutes = max(15, min(schedule_minutes, 24 * 60))
        if retention_days is not None:
            backend.retention_days = max(1, min(retention_days, 3650))
        if settings_patch and isinstance(settings_patch, dict):
            merged = dict(backend.settings_json or {})
            merged.update(settings_patch)
            merged = _normalize_settings_patch(merged)
            if merged.get("primary_for_deploy") is True:
                rows = await session.execute(
                    select(StateBackend).where(
                        StateBackend.project_id == project_id,
                        StateBackend.id != backend_id,
                    )
                )
                for row in rows.scalars().all():
                    sibling_settings = _normalize_settings_patch(dict(row.settings_json or {}))
                    sibling_settings.pop("primary_for_deploy", None)
                    row.settings_json = sibling_settings
            backend.settings_json = merged
        await session.flush()
    return _serialize_backend(backend)


async def delete_backend(*, project_id: str, backend_id: str) -> bool:
    async with db.get_session() as session:
        rows = await session.execute(
            select(StateBackend).where(StateBackend.project_id == project_id, StateBackend.id == backend_id)
        )
        backend = rows.scalar_one_or_none()
        if backend is None:
            return False
        await session.delete(backend)
    return True


async def generate_fix_plan(*, project_id: str, backend_id: str, alert_id: str) -> dict[str, Any]:
    await get_state_backend(project_id=project_id, backend_id=backend_id)
    async with db.get_session() as session:
        row = await session.get(DriftAlert, alert_id)
        if row is None or row.backend_id != backend_id:
            raise ValueError("drift_alert_not_found")
        details = row.details_json if isinstance(row.details_json, dict) else {}
        reason = str(details.get("reason") or "resource drift detected")
        plan = {
            "title": f"Remediate drift for {row.resource_address}",
            "steps": [
                "Inspect current cloud resource configuration.",
                "Compare with latest Terraform state and module definition.",
                "Run plan in review mode for affected module.",
                "Apply remediation after approval.",
            ],
            "reason": reason,
        }
        row.remediation_json = plan
        await session.flush()
    return {"alert_id": alert_id, "plan": plan}


async def generate_fix_all_plan(*, project_id: str, backend_id: str) -> dict[str, Any]:
    alerts = await list_drift_alerts(project_id=project_id, backend_id=backend_id, active_only=True)
    plans: list[dict[str, Any]] = []
    for item in alerts:
        plans.append(
            {
                "resource_address": item.get("resource_address"),
                "steps": [
                    "Validate drift with cloud API.",
                    "Review module variables and dependencies.",
                    "Run plan and validate expected changes.",
                    "Apply approved changes.",
                ],
            }
        )
    return {
        "backend_id": backend_id,
        "count": len(plans),
        "plans": plans,
    }


async def due_backends(*, settings: Settings | None = None) -> list[str]:
    cfg = settings or get_settings()
    now = _now()
    async with db.get_session() as session:
        rows = await session.execute(select(StateBackend).where(StateBackend.status.in_(["connected", "error"])))
        backends = rows.scalars().all()
    due: list[str] = []
    for row in backends:
        schedule = max(15, int(row.schedule_minutes or cfg.state_sync_scan_interval_minutes or 60))
        if row.last_sync_at is None or row.last_sync_at + timedelta(minutes=schedule) <= now:
            due.append(row.id)
    return due[: max(1, int(cfg.state_sync_max_backends_per_tick or 25))]


async def sync_due_backends(*, settings: Settings | None = None) -> dict[str, Any]:
    cfg = settings or get_settings()
    ids = await due_backends(settings=cfg)
    succeeded = 0
    failed = 0
    for backend_id in ids:
        try:
            await run_backend_sync(backend_id=backend_id, triggered_by="scheduler", settings=cfg)
            succeeded += 1
        except Exception:
            failed += 1
    return {
        "processed": len(ids),
        "succeeded": succeeded,
        "failed": failed,
    }


async def get_sync_runs(*, project_id: str, backend_id: str, limit: int = 30) -> list[dict[str, Any]]:
    await get_state_backend(project_id=project_id, backend_id=backend_id)
    async with db.get_session() as session:
        rows = await session.execute(
            select(StateSyncRun)
            .where(StateSyncRun.backend_id == backend_id)
            .order_by(StateSyncRun.created_at.desc())
            .limit(max(1, min(limit, 200)))
        )
        runs = rows.scalars().all()
    return [
        {
            "id": row.id,
            "status": row.status,
            "triggered_by": row.triggered_by,
            "summary": row.summary_json or {},
            "error_message": row.error_message,
            "started_at": _iso(row.started_at),
            "finished_at": _iso(row.finished_at),
            "created_at": _iso(row.created_at),
        }
        for row in runs
    ]


async def get_project_deploy_drift_summary(project_id: str) -> dict[str, Any]:
    project = await _load_project(project_id)
    if project is None:
        raise ValueError("project_not_found")

    backends = await list_state_backends(project_id=project_id)
    primary_backend = next((row for row in backends if _is_primary_for_deploy(row.get("settings"))), None)
    if primary_backend is None:
        return {
            "source": "local_runtime_fallback",
            "status": "primary_backend_required",
            "blocking": True,
            "reason": "Select one state backend as the primary backend for deploy decisions.",
            "primary_backend": None,
            "last_successful_refresh_at": None,
            "freshness_minutes": None,
            "active_drift_alert_count": 0,
            "fallback_runtime": await get_local_runtime_drift_status(
                project_id=project_id,
                user_id=str(project.user_id or ""),
            ),
        }

    sync_runs = await get_sync_runs(project_id=project_id, backend_id=str(primary_backend["id"]), limit=20)
    latest_sync = sync_runs[0] if sync_runs else None
    latest_successful = next((row for row in sync_runs if row.get("status") == "succeeded"), None)
    last_successful_refresh_at = _refresh_timestamp(latest_successful)
    freshness_minutes = _freshness_minutes(last_successful_refresh_at)
    active_drift_alerts = await list_drift_alerts(
        project_id=project_id,
        backend_id=str(primary_backend["id"]),
        active_only=True,
    )
    active_drift_alert_count = len(active_drift_alerts)
    status, blocking, reason = _deploy_drift_status(
        primary_backend=primary_backend,
        latest_sync=latest_sync,
        last_successful_refresh_at=last_successful_refresh_at,
        freshness_minutes=freshness_minutes,
        active_drift_alert_count=active_drift_alert_count,
    )
    return {
        "source": "primary_backend",
        "status": status,
        "blocking": blocking,
        "reason": reason,
        "primary_backend": primary_backend,
        "last_successful_refresh_at": last_successful_refresh_at,
        "freshness_minutes": freshness_minutes,
        "active_drift_alert_count": active_drift_alert_count,
        "fallback_runtime": None,
    }


async def get_gitlab_token_for_user(*, user_id: str, settings: Settings) -> str | None:
    from app.models import GitLabOAuthToken

    async with db.get_session() as session:
        rows = await session.execute(select(GitLabOAuthToken).where(GitLabOAuthToken.user_id == user_id))
        token = rows.scalar_one_or_none()
    if token is None:
        return None
    if token.expires_at and token.expires_at <= _now():
        return None
    return decrypt_text(secret=settings.state_encryption_key, value=token.access_token_encrypted)
