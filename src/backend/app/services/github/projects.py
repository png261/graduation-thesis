"""Project-level GitHub connect/disconnect/pull-request workflows."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Project
from app.services.github import git as github_git
from app.services.project import files as project_files


_REPO_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


class GitHubProjectError(Exception):
    def __init__(self, message: str, *, status_code: int = 400, code: str = "github_project_error") -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def normalize_repo_full_name(repo_full_name: str) -> str:
    value = (repo_full_name or "").strip()
    if not _REPO_NAME_RE.match(value):
        raise GitHubProjectError(
            "Repository must be in 'owner/repo' format",
            status_code=400,
            code="invalid_repo",
        )
    return value


def _working_branch_for_project(project_name: str) -> str:
    return f"infra/{github_git.slugify(project_name)}"


def connection_payload(project: Project) -> dict:
    return {
        "connected": bool(project.github_repo_full_name),
        "repo_full_name": project.github_repo_full_name,
        "base_branch": project.github_base_branch,
        "working_branch": project.github_working_branch,
        "github_account_id": None,
        "connected_at": project.github_connected_at.isoformat() if project.github_connected_at else None,
    }


def _ensure_not_connected(project: Project) -> None:
    if project.github_repo_full_name:
        raise GitHubProjectError(
            "Project is already connected to a GitHub repository",
            status_code=409,
            code="already_connected",
        )


def _resolve_requested_branch(repo: dict[str, object], base_branch: str | None) -> str:
    default_branch = github_git.normalize_branch_name(str(repo.get("default_branch") or "main")) or "main"
    return github_git.normalize_branch_name(base_branch) or default_branch


def _ensure_push_permission(repo: dict[str, object]) -> None:
    permissions = repo.get("permissions") if isinstance(repo.get("permissions"), dict) else {}
    if permissions and not permissions.get("push", False):
        raise GitHubProjectError(
            "GitHub account does not have push access to this repository",
            status_code=403,
            code="missing_push_permission",
        )


def _apply_connection_state(project: Project, *, repo_full_name: str, resolved_base: str, working_branch: str) -> None:
    project.github_repo_full_name = repo_full_name
    project.github_base_branch = resolved_base
    project.github_working_branch = working_branch
    project.github_connected_at = datetime.now(timezone.utc)


def _raise_clone_error(exc: github_git.GitCommandError) -> None:
    message = str(exc)
    if "non-system files" in message.lower():
        raise GitHubProjectError(message, status_code=409, code="clone_target_not_clean") from exc
    raise GitHubProjectError(message, status_code=400, code="git_clone_failed") from exc


async def _fetch_repo(access_token: str, repo_full_name: str) -> dict[str, object]:
    from app.services.github import auth as github_auth  # lazy import to avoid cycles

    repo = await github_auth.github_get_repo(access_token, repo_full_name)
    return repo


def _clone_connection_repo(
    *,
    project: Project,
    normalized_repo: str,
    access_token: str,
    requested_base: str,
    working_branch: str,
) -> str:
    project_root = project_files.ensure_project_dir(project.id)
    try:
        return github_git.clone_and_prepare_repo(
            project_root=project_root,
            repo_full_name=normalized_repo,
            access_token=access_token,
            base_branch=requested_base,
            working_branch=working_branch,
        )
    except github_git.GitCommandError as exc:
        _raise_clone_error(exc)


async def connect_project_repository(
    session: AsyncSession,
    *,
    project: Project,
    access_token: str,
    repo_full_name: str,
    base_branch: str | None,
) -> dict:
    _ensure_not_connected(project)
    normalized_repo = normalize_repo_full_name(repo_full_name)
    repo = await _fetch_repo(access_token, normalized_repo)
    _ensure_push_permission(repo)
    requested_base = _resolve_requested_branch(repo, base_branch)
    working_branch = _working_branch_for_project(project.name)
    resolved_base = _clone_connection_repo(
        project=project,
        normalized_repo=normalized_repo,
        access_token=access_token,
        requested_base=requested_base,
        working_branch=working_branch,
    )

    _apply_connection_state(
        project,
        repo_full_name=normalized_repo,
        resolved_base=resolved_base,
        working_branch=working_branch,
    )
    await session.flush()
    return connection_payload(project)


async def disconnect_project_repository(session: AsyncSession, *, project: Project) -> dict:
    project.github_repo_full_name = None
    project.github_base_branch = None
    project.github_working_branch = None
    project.github_connected_at = None
    await session.flush()
    return connection_payload(project)


async def create_project_pull_request(
    session: AsyncSession,
    *,
    project: Project,
    access_token: str,
    github_login: str,
    title: str,
    body: str,
    base_branch: str | None,
) -> dict:
    pr_title, working_branch = _pull_request_inputs(project, title)
    project_root = project_files.ensure_project_dir(project.id)
    requested_base = github_git.normalize_branch_name(base_branch or project.github_base_branch) or "main"

    try:
        target_base = _resolve_target_base(project_root, requested_base, working_branch)
        _push_changes(project, project_root, access_token, github_login, pr_title, target_base)
    except github_git.GitCommandError as exc:
        _raise_push_error(exc)

    pr = await _create_pull_request_or_raise(project, access_token, pr_title, body, target_base)
    await _persist_base_branch(session, project, target_base)
    return _pull_request_payload(pr, project, target_base)


def _pull_request_inputs(project: Project, title: str) -> tuple[str, str]:
    pr_title = (title or "").strip()
    if not pr_title:
        raise GitHubProjectError("Pull request title is required", status_code=400, code="invalid_title")
    if not project.github_repo_full_name or not project.github_working_branch:
        raise GitHubProjectError("Project is not connected to GitHub", status_code=400, code="project_not_connected")
    return pr_title, github_git.normalize_branch_name(project.github_working_branch)


def _resolve_target_base(project_root: Path, requested_base: str, working_branch: str) -> str:
    target_base = github_git.resolve_base_branch(project_root=project_root, preferred_base=requested_base)
    if target_base == working_branch:
        target_base = github_git.resolve_base_branch(project_root=project_root, preferred_base=None)
    if target_base == working_branch:
        raise GitHubProjectError("Base branch cannot be the same as working branch", status_code=400, code="invalid_base_branch")
    return target_base


def _push_changes(
    project: Project,
    project_root: Path,
    access_token: str,
    github_login: str,
    pr_title: str,
    target_base: str,
) -> None:
    github_git.prepare_and_push_changes(
        project_root=project_root,
        access_token=access_token,
        working_branch=project.github_working_branch,
        base_branch=target_base,
        commit_title=pr_title,
        github_login=github_login,
    )


async def _create_pull_request(project: Project, access_token: str, title: str, body: str, target_base: str) -> dict[str, object]:
    from app.services.github import auth as github_auth  # lazy import to avoid cycles

    return await github_auth.github_create_pull_request(
        access_token,
        repo_full_name=project.github_repo_full_name,
        title=title,
        body=(body or "").strip(),
        head=project.github_working_branch,
        base=target_base,
    )


async def _create_pull_request_or_raise(
    project: Project,
    access_token: str,
    title: str,
    body: str,
    target_base: str,
) -> dict[str, object]:
    try:
        return await _create_pull_request(project, access_token, title, body, target_base)
    except Exception as exc:
        _raise_pull_request_error(exc)
    raise AssertionError("unreachable")


async def _persist_base_branch(session: AsyncSession, project: Project, target_base: str) -> None:
    project.github_base_branch = target_base
    await session.flush()


def _pull_request_payload(pr: dict[str, object], project: Project, target_base: str) -> dict[str, object]:
    return {
        "ok": True,
        "url": pr.get("html_url"),
        "number": pr.get("number"),
        "title": pr.get("title"),
        "repo_full_name": project.github_repo_full_name,
        "base_branch": target_base,
        "working_branch": project.github_working_branch,
    }


def _raise_push_error(exc: github_git.GitCommandError) -> None:
    message = str(exc)
    lowered = message.lower()
    if "not a git repository" in lowered:
        raise GitHubProjectError(message, status_code=400, code="not_git_repository") from exc
    if "could not read" in lowered or "authentication" in lowered or "permission denied" in lowered:
        raise GitHubProjectError(message, status_code=401, code="git_auth_failed") from exc
    raise GitHubProjectError(message, status_code=400, code="git_push_failed") from exc


def _raise_pull_request_error(exc: Exception) -> None:
    message = str(exc)
    lowered = message.lower()
    if "already exists" in lowered:
        raise GitHubProjectError(message, status_code=409, code="pull_request_exists") from exc
    if "no commits between" in lowered:
        raise GitHubProjectError(message, status_code=400, code="no_changes") from exc
    if "head" in lowered and "not found" in lowered:
        raise GitHubProjectError(message, status_code=400, code="head_branch_not_found") from exc
    if "base" in lowered and "not found" in lowered:
        raise GitHubProjectError(message, status_code=400, code="base_branch_not_found") from exc
    raise GitHubProjectError(message, status_code=400, code="pull_request_failed") from exc
