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


def _apply_sync_state(project: Project, *, resolved_base: str, working_branch: str) -> None:
    project.github_base_branch = resolved_base
    project.github_working_branch = working_branch


def _raise_clone_error(exc: github_git.GitCommandError) -> None:
    message = str(exc)
    if "non-system files" in message.lower():
        raise GitHubProjectError(message, status_code=409, code="clone_target_not_clean") from exc
    raise GitHubProjectError(message, status_code=400, code="git_clone_failed") from exc


async def _fetch_repo(access_token: str, repo_full_name: str) -> dict[str, object]:
    from app.services.github import auth as github_auth  # lazy import to avoid cycles

    repo = await github_auth.github_get_repo(access_token, repo_full_name)
    return repo


def _connected_repo_name(project: Project) -> str:
    if not (project.github_repo_full_name or "").strip():
        raise GitHubProjectError(
            "Project is not connected to GitHub",
            status_code=400,
            code="project_not_connected",
        )
    return normalize_repo_full_name(project.github_repo_full_name or "")


def _ensure_workspace_switch_confirmation(project_root: Path, *, confirm_workspace_switch: bool) -> None:
    if confirm_workspace_switch:
        return
    if not github_git.workspace_requires_confirmation(project_root):
        return
    raise GitHubProjectError(
        "Confirm repository import to replace local workspace files",
        status_code=409,
        code="workspace_switch_confirmation_required",
    )


def _working_branch_value(project: Project) -> str:
    return github_git.normalize_branch_name(project.github_working_branch) or _working_branch_for_project(project.name)


def _connected_branches(project: Project) -> tuple[str, str]:
    base_branch = github_git.normalize_branch_name(project.github_base_branch) or "main"
    working_branch = _working_branch_value(project)
    return base_branch, working_branch


def _sync_repository_workspace(
    *,
    project: Project,
    repo_full_name: str,
    access_token: str,
    requested_base: str,
    working_branch: str,
    confirm_workspace_switch: bool,
) -> str:
    project_root = project_files.ensure_project_dir(project.id)
    _ensure_workspace_switch_confirmation(
        project_root,
        confirm_workspace_switch=confirm_workspace_switch,
    )
    try:
        return github_git.clone_and_prepare_repo(
            project_root=project_root,
            repo_full_name=repo_full_name,
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
    confirm_workspace_switch: bool = False,
) -> dict:
    _ensure_not_connected(project)
    normalized_repo = normalize_repo_full_name(repo_full_name)
    repo = await _fetch_repo(access_token, normalized_repo)
    _ensure_push_permission(repo)
    requested_base = _resolve_requested_branch(repo, base_branch)
    working_branch = _working_branch_for_project(project.name)
    resolved_base = _sync_repository_workspace(
        project=project,
        repo_full_name=normalized_repo,
        access_token=access_token,
        requested_base=requested_base,
        working_branch=working_branch,
        confirm_workspace_switch=confirm_workspace_switch,
    )

    _apply_connection_state(
        project,
        repo_full_name=normalized_repo,
        resolved_base=resolved_base,
        working_branch=working_branch,
    )
    await session.flush()
    return connection_payload(project)


async def sync_project_repository(
    session: AsyncSession,
    *,
    project: Project,
    access_token: str,
    confirm_workspace_switch: bool = False,
) -> dict:
    repo_full_name = _connected_repo_name(project)
    repo = await _fetch_repo(access_token, repo_full_name)
    _ensure_push_permission(repo)
    requested_base = _resolve_requested_branch(repo, project.github_base_branch)
    working_branch = _working_branch_value(project)
    resolved_base = _sync_repository_workspace(
        project=project,
        repo_full_name=repo_full_name,
        access_token=access_token,
        requested_base=requested_base,
        working_branch=working_branch,
        confirm_workspace_switch=confirm_workspace_switch,
    )
    _apply_sync_state(project, resolved_base=resolved_base, working_branch=working_branch)
    await session.flush()
    return connection_payload(project)


async def disconnect_project_repository(session: AsyncSession, *, project: Project) -> dict:
    project.github_repo_full_name = None
    project.github_base_branch = None
    project.github_working_branch = None
    project.github_connected_at = None
    await session.flush()
    return connection_payload(project)


def _summary_payload(record: object | None) -> dict[str, object]:
    summary = getattr(record, "summary_json", None)
    if isinstance(summary, dict):
        return summary
    return {}


def _artifact_count(summary: dict[str, object], key: str) -> int | None:
    value = summary.get(key)
    if isinstance(value, int):
        return value
    return None


def _pull_request_title_for_source(
    *,
    ansible_generation,
    terraform_generation,
) -> tuple[str, str]:
    if ansible_generation is not None:
        return "chore: update infra from ansible generation", "ansible_generation"
    if terraform_generation is not None:
        return "chore: update infra from terraform generation", "terraform_generation"
    return "chore: update infrastructure", "fallback"


def _append_generation_context(
    lines: list[str],
    *,
    source: str,
    ansible_generation_id: str | None,
    terraform_generation_id: str | None,
) -> None:
    lines.extend(["## Generation Context", ""])
    if source == "fallback":
        lines.append("- No recent generation history was found for this project.")
    else:
        if terraform_generation_id:
            lines.append(f"- Terraform generation id: `{terraform_generation_id}`")
        if ansible_generation_id:
            lines.append(f"- Ansible generation id: `{ansible_generation_id}`")
    lines.append("")


def _append_generated_artifacts(
    lines: list[str],
    *,
    terraform_generation,
    ansible_generation,
) -> None:
    terraform_summary = _summary_payload(terraform_generation)
    ansible_summary = _summary_payload(ansible_generation)
    lines.extend(["## Generated Artifacts", ""])
    if terraform_generation is not None:
        module_count = _artifact_count(terraform_summary, "moduleCount")
        file_count = _artifact_count(terraform_summary, "fileCount")
        if module_count is not None and file_count is not None:
            lines.append(f"- Terraform modules/files: {module_count} modules, {file_count} files")
    if ansible_generation is not None:
        role_count = _artifact_count(ansible_summary, "roleCount")
        file_count = _artifact_count(ansible_summary, "fileCount")
        if role_count is not None and file_count is not None:
            lines.append(f"- Ansible roles/files: {role_count} roles, {file_count} files")
    if lines[-1] == "":
        lines.append("- No persisted Terraform or Ansible generation counts are available yet.")
    lines.append("")


def _append_review_notes(
    lines: list[str],
    *,
    base_branch: str,
    working_branch: str,
) -> None:
    lines.extend(
        [
            "## Review Notes",
            "",
            "This pull request includes all current workspace changes on the project working branch.",
            f"- Base branch: `{base_branch}`",
            f"- Working branch: `{working_branch}`",
            "",
        ]
    )


async def build_project_pull_request_defaults(
    session: AsyncSession,
    project: Project,
) -> dict[str, object]:
    from app.services.generation_history import get_latest_ansible_generation, get_latest_terraform_generation

    terraform_generation = await get_latest_terraform_generation(session, project.id)
    ansible_generation = await get_latest_ansible_generation(session, project.id)
    title, source = _pull_request_title_for_source(
        ansible_generation=ansible_generation,
        terraform_generation=terraform_generation,
    )
    base_branch, working_branch = _connected_branches(project)
    terraform_generation_id = getattr(terraform_generation, "id", None)
    ansible_generation_id = getattr(ansible_generation, "id", None)
    description_lines = [
        "## Summary",
        "",
        f"- Repository: `{project.github_repo_full_name}`",
        f"- Suggested source: `{source}`",
        "",
    ]
    _append_generation_context(
        description_lines,
        source=source,
        ansible_generation_id=ansible_generation_id,
        terraform_generation_id=terraform_generation_id,
    )
    _append_generated_artifacts(
        description_lines,
        terraform_generation=terraform_generation,
        ansible_generation=ansible_generation,
    )
    _append_review_notes(
        description_lines,
        base_branch=base_branch,
        working_branch=working_branch,
    )
    return {
        "title": title,
        "description": "\n".join(description_lines).strip(),
        "base_branch": base_branch,
        "working_branch": working_branch,
        "repo_full_name": project.github_repo_full_name,
        "source": source,
        "terraform_generation_id": terraform_generation_id,
        "ansible_generation_id": ansible_generation_id,
    }


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
        raise GitHubProjectError(
            "Base branch cannot be the same as working branch", status_code=400, code="invalid_base_branch"
        )
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


async def _create_pull_request(
    project: Project, access_token: str, title: str, body: str, target_base: str
) -> dict[str, object]:
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
