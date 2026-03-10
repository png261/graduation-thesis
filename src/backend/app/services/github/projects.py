"""Project-level GitHub connect/disconnect/pull-request workflows."""
from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import GitHubAccount, Project
from app.services.github import auth as github_auth
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
        "connected": bool(project.github_repo_full_name and project.github_account_id),
        "repo_full_name": project.github_repo_full_name,
        "base_branch": project.github_base_branch,
        "working_branch": project.github_working_branch,
        "github_account_id": project.github_account_id,
        "connected_at": project.github_connected_at.isoformat() if project.github_connected_at else None,
    }


async def connect_project_repository(
    session: AsyncSession,
    *,
    settings: Settings,
    project: Project,
    account: GitHubAccount,
    repo_full_name: str,
    base_branch: str | None,
) -> dict:
    if project.github_repo_full_name and project.github_account_id:
        raise GitHubProjectError(
            "Project is already connected to a GitHub repository",
            status_code=409,
            code="already_connected",
        )

    normalized_repo = normalize_repo_full_name(repo_full_name)
    token = await github_auth.get_account_access_token(session, settings=settings, account=account)
    repo = await github_auth.github_get_repo(token, normalized_repo)
    permissions = repo.get("permissions") if isinstance(repo.get("permissions"), dict) else {}
    if permissions and not permissions.get("push", False):
        raise GitHubProjectError(
            "GitHub account does not have push access to this repository",
            status_code=403,
            code="missing_push_permission",
        )

    default_branch = github_git.normalize_branch_name(str(repo.get("default_branch") or "main")) or "main"
    requested_base = github_git.normalize_branch_name(base_branch) or default_branch
    working_branch = _working_branch_for_project(project.name)
    project_root = project_files.ensure_project_dir(project.id)

    try:
        resolved_base = github_git.clone_and_prepare_repo(
            project_root=project_root,
            repo_full_name=normalized_repo,
            access_token=token,
            base_branch=requested_base,
            working_branch=working_branch,
        )
    except github_git.GitCommandError as exc:
        message = str(exc)
        if "non-system files" in message.lower():
            raise GitHubProjectError(
                message,
                status_code=409,
                code="clone_target_not_clean",
            ) from exc
        raise GitHubProjectError(
            message,
            status_code=400,
            code="git_clone_failed",
        ) from exc

    project.github_account_id = account.id
    project.github_repo_full_name = normalized_repo
    project.github_base_branch = resolved_base
    project.github_working_branch = working_branch
    project.github_connected_at = datetime.now(timezone.utc)
    await session.flush()
    return connection_payload(project)


async def disconnect_project_repository(session: AsyncSession, *, project: Project) -> dict:
    project.github_account_id = None
    project.github_repo_full_name = None
    project.github_base_branch = None
    project.github_working_branch = None
    project.github_connected_at = None
    await session.flush()
    return connection_payload(project)


async def create_project_pull_request(
    session: AsyncSession,
    *,
    settings: Settings,
    project: Project,
    account: GitHubAccount,
    title: str,
    body: str,
    base_branch: str | None,
) -> dict:
    pr_title = (title or "").strip()
    if not pr_title:
        raise GitHubProjectError("Pull request title is required", status_code=400, code="invalid_title")

    if not project.github_repo_full_name or not project.github_account_id or not project.github_working_branch:
        raise GitHubProjectError(
            "Project is not connected to GitHub",
            status_code=400,
            code="project_not_connected",
        )

    if project.github_account_id != account.id:
        raise GitHubProjectError(
            "GitHub session account does not match this project connection",
            status_code=403,
            code="account_mismatch",
        )

    token = await github_auth.get_account_access_token(session, settings=settings, account=account)
    project_root = project_files.ensure_project_dir(project.id)
    working_branch = github_git.normalize_branch_name(project.github_working_branch)
    requested_base = github_git.normalize_branch_name(base_branch or project.github_base_branch) or "main"

    try:
        target_base = github_git.resolve_base_branch(
            project_root=project_root,
            preferred_base=requested_base,
        )
        if target_base == working_branch:
            # Retry without user preference to pick a repository-default style branch
            # (origin/HEAD, main/master, etc.) before rejecting the PR request.
            target_base = github_git.resolve_base_branch(
                project_root=project_root,
                preferred_base=None,
            )
        if target_base == working_branch:
            raise GitHubProjectError(
                "Base branch cannot be the same as working branch",
                status_code=400,
                code="invalid_base_branch",
            )
        has_changes = github_git.prepare_and_push_changes(
            project_root=project_root,
            access_token=token,
            working_branch=project.github_working_branch,
            base_branch=target_base,
            commit_title=pr_title,
            github_login=account.login,
        )
    except github_git.GitCommandError as exc:
        message = str(exc)
        lowered = message.lower()
        if "not a git repository" in lowered:
            raise GitHubProjectError(message, status_code=400, code="not_git_repository") from exc
        if "could not read" in lowered or "authentication" in lowered or "permission denied" in lowered:
            raise GitHubProjectError(message, status_code=401, code="git_auth_failed") from exc
        raise GitHubProjectError(message, status_code=400, code="git_push_failed") from exc

    # If there are no local file changes, still attempt PR creation from the
    # existing working branch. This supports the case where commits were already
    # pushed earlier and user is only opening the PR now.

    try:
        pr = await github_auth.github_create_pull_request(
            token,
            repo_full_name=project.github_repo_full_name,
            title=pr_title,
            body=(body or "").strip(),
            head=project.github_working_branch,
            base=target_base,
        )
    except github_auth.GitHubAuthError as exc:
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

    project.github_base_branch = target_base
    await session.flush()

    return {
        "ok": True,
        "url": pr.get("html_url"),
        "number": pr.get("number"),
        "title": pr.get("title"),
        "repo_full_name": project.github_repo_full_name,
        "base_branch": target_base,
        "working_branch": project.github_working_branch,
    }
