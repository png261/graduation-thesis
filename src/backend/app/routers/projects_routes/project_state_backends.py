"""Project state backend endpoints."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.models import Project, User
from app.routers import auth_dependencies as auth_deps
from app.routers import github_dependencies as github_deps
from app.routers.http_errors import raise_http_error
from app.services.state_backends import service as state_service

router = APIRouter()


class CloudImportBody(BaseModel):
    provider: str
    name: str = ""
    access_key_id: str
    secret_access_key: str
    bucket: str
    key: str = ""
    prefix: str = ""


class ScmImportBody(BaseModel):
    repo_full_name: str
    branch: str | None = None
    credential_profile_id: str
    dry_run: bool = False
    selected_candidates: list[dict[str, str]] = Field(default_factory=list)


class BackendSettingsBody(BaseModel):
    name: str | None = None
    schedule_minutes: int | None = None
    retention_days: int | None = None
    settings: dict[str, Any] = Field(default_factory=dict)


@router.get("/{project_id}/state-backends")
async def list_state_backends(
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    items = await state_service.list_state_backends(project_id=project.id)
    return {"backends": items}


@router.get("/{project_id}/state-backends/deploy-drift")
async def deploy_drift_summary(
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    return await state_service.get_project_deploy_drift_summary(project.id)


@router.get("/{project_id}/state-backends/import/cloud/buckets")
async def list_cloud_buckets(
    provider: str = Query(...),
    access_key_id: str = Query(...),
    secret_access_key: str = Query(...),
    user: User = Depends(auth_deps.require_current_user),
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        buckets = await state_service.browse_cloud_buckets(
            user_id=user.id,
            provider=provider,
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            settings=get_settings(),
        )
        return {"buckets": buckets}
    except ValueError as exc:
        raise_http_error(400, code=str(exc), message=str(exc))
    except Exception as exc:
        raise_http_error(400, code="cloud_buckets_failed", message=str(exc))


@router.get("/{project_id}/state-backends/import/cloud/objects")
async def list_cloud_objects(
    provider: str = Query(...),
    access_key_id: str = Query(...),
    secret_access_key: str = Query(...),
    bucket: str = Query(...),
    prefix: str = Query(default=""),
    user: User = Depends(auth_deps.require_current_user),
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        objects = await state_service.browse_cloud_objects(
            user_id=user.id,
            provider=provider,
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            bucket=bucket,
            prefix=prefix,
            settings=get_settings(),
        )
        return {"objects": objects}
    except ValueError as exc:
        raise_http_error(400, code=str(exc), message=str(exc))
    except Exception as exc:
        raise_http_error(400, code="cloud_objects_failed", message=str(exc))


@router.post("/{project_id}/state-backends/import/cloud")
async def import_cloud_state_backend(
    body: CloudImportBody,
    user: User = Depends(auth_deps.require_current_user),
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        backend = await state_service.import_cloud_backend(
            project=project,
            user_id=user.id,
            provider=body.provider,
            name=body.name,
            credential_profile_id=None,
            access_key_id=body.access_key_id,
            secret_access_key=body.secret_access_key,
            bucket=body.bucket,
            key=body.key,
            prefix=body.prefix,
            settings=get_settings(),
        )
        return backend
    except ValueError as exc:
        raise_http_error(400, code=str(exc), message=str(exc))
    except Exception as exc:
        raise_http_error(400, code="import_cloud_failed", message=str(exc))


@router.post("/{project_id}/state-backends/import/github")
async def import_state_backend_from_github(
    body: ScmImportBody,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
    github_ctx: github_deps.GitHubAuthContext = Depends(github_deps.require_authenticated_github_context),
) -> dict:
    try:
        return await state_service.import_from_github_repo(
            project=project,
            user_id=str(project.user_id or ""),
            access_token=github_ctx.access_token,
            repo_full_name=body.repo_full_name,
            branch=body.branch,
            credential_profile_id=body.credential_profile_id,
            selected_candidates=body.selected_candidates,
            dry_run=body.dry_run,
            settings=get_settings(),
        )
    except ValueError as exc:
        raise_http_error(400, code=str(exc), message=str(exc))
    except Exception as exc:
        raise_http_error(400, code="import_github_failed", message=str(exc))


@router.post("/{project_id}/state-backends/{backend_id}/sync")
async def sync_backend(
    backend_id: str,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        return await state_service.run_backend_sync(
            backend_id=backend_id,
            triggered_by="manual",
            settings=get_settings(),
        )
    except ValueError as exc:
        status = 404 if str(exc) == "backend_not_found" else 400
        raise_http_error(status, code=str(exc), message=str(exc))
    except Exception as exc:
        raise_http_error(400, code="state_sync_failed", message=str(exc))


@router.get("/{project_id}/state-backends/{backend_id}/resources")
async def backend_resources(
    backend_id: str,
    search: str = Query(default=""),
    show_sensitive: bool = Query(default=False),
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        rows = await state_service.list_state_resources(
            project_id=project.id,
            backend_id=backend_id,
            search=search,
            show_sensitive=show_sensitive,
        )
        return {"resources": rows}
    except ValueError as exc:
        raise_http_error(404, code=str(exc), message=str(exc))


@router.get("/{project_id}/state-backends/{backend_id}/history")
async def backend_history(
    backend_id: str,
    search: str = Query(default=""),
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        rows = await state_service.list_state_history(project_id=project.id, backend_id=backend_id, search=search)
        return {"history": rows}
    except ValueError as exc:
        raise_http_error(404, code=str(exc), message=str(exc))


@router.get("/{project_id}/state-backends/{backend_id}/drift-alerts")
async def drift_alerts(
    backend_id: str,
    active_only: bool = Query(default=False),
    search: str = Query(default=""),
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        rows = await state_service.list_drift_alerts(
            project_id=project.id,
            backend_id=backend_id,
            active_only=active_only,
            search=search,
        )
        return {"alerts": rows}
    except ValueError as exc:
        raise_http_error(404, code=str(exc), message=str(exc))


@router.get("/{project_id}/state-backends/{backend_id}/policy-alerts")
async def policy_alerts(
    backend_id: str,
    active_only: bool = Query(default=False),
    search: str = Query(default=""),
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        rows = await state_service.list_policy_alerts(
            project_id=project.id,
            backend_id=backend_id,
            active_only=active_only,
            search=search,
        )
        return {"alerts": rows}
    except ValueError as exc:
        raise_http_error(404, code=str(exc), message=str(exc))


@router.post("/{project_id}/state-backends/{backend_id}/drift-alerts/{alert_id}/fix-plan")
async def drift_fix_plan(
    backend_id: str,
    alert_id: str,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        return await state_service.generate_fix_plan(
            project_id=project.id,
            backend_id=backend_id,
            alert_id=alert_id,
        )
    except ValueError as exc:
        raise_http_error(404, code=str(exc), message=str(exc))


@router.post("/{project_id}/state-backends/{backend_id}/drift-alerts/fix-all-plan")
async def drift_fix_all_plan(
    backend_id: str,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    return await state_service.generate_fix_all_plan(project_id=project.id, backend_id=backend_id)


@router.get("/{project_id}/state-backends/{backend_id}/settings")
async def backend_settings(
    backend_id: str,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    rows = await state_service.list_state_backends(project_id=project.id)
    match = next((row for row in rows if row["id"] == backend_id), None)
    if match is None:
        raise_http_error(404, code="backend_not_found", message="Backend not found")
    runs = await state_service.get_sync_runs(project_id=project.id, backend_id=backend_id)
    return {"backend": match, "sync_runs": runs}


@router.put("/{project_id}/state-backends/{backend_id}/settings")
async def update_settings(
    backend_id: str,
    body: BackendSettingsBody,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    try:
        item = await state_service.update_backend_settings(
            project_id=project.id,
            backend_id=backend_id,
            name=body.name,
            schedule_minutes=body.schedule_minutes,
            retention_days=body.retention_days,
            settings_patch=body.settings,
        )
        return item
    except ValueError as exc:
        raise_http_error(404, code=str(exc), message=str(exc))


@router.delete("/{project_id}/state-backends/{backend_id}")
async def delete_state_backend(
    backend_id: str,
    project: Project = Depends(auth_deps.get_owned_project_or_404),
) -> dict:
    ok = await state_service.delete_backend(project_id=project.id, backend_id=backend_id)
    if not ok:
        raise_http_error(404, code="backend_not_found", message="Backend not found")
    return {"ok": True}
