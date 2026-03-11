"""Git operations for project-connected GitHub repositories via GitPython."""
from __future__ import annotations

from pathlib import Path

from git import GitCommandError as GitPythonCommandError
from git import Repo
from git.exc import InvalidGitRepositoryError, NoSuchPathError

from .git_helpers import (
    clone_auth_url,
    ensure_system_gitignore,
    move_all_entries_to_temp,
    origin_with_auth,
    public_repo_url,
    restore_entries_without_overwrite,
    sanitize_error_message,
    slugify,
)


class GitCommandError(Exception):
    pass


def _raise_git_error(exc: Exception, *, access_token: str | None = None) -> None:
    if isinstance(exc, GitPythonCommandError):
        message = (exc.stderr or exc.stdout or str(exc)).strip()
    else:
        message = str(exc)
    raise GitCommandError(sanitize_error_message(message, access_token=access_token)) from exc


def _has_head_commit(repo: Repo) -> bool:
    try:
        return bool(repo.head.is_valid())
    except Exception:
        return False


def normalize_branch_name(name: str | None) -> str:
    branch = (name or "").strip()
    if not branch:
        return ""

    changed = True
    while changed:
        changed = False
        for prefix in ("refs/heads/", "refs/remotes/origin/", "origin/"):
            if branch.startswith(prefix):
                branch = branch[len(prefix) :].strip()
                changed = True
    return branch


def _remote_branch_names(repo: Repo) -> set[str]:
    try:
        refs = repo.remotes.origin.refs
    except Exception:
        return set()

    names: set[str] = set()
    for ref in refs:
        remote_head = str(getattr(ref, "remote_head", "") or "").strip()
        if remote_head and remote_head != "HEAD":
            names.add(remote_head)
    return names


def _origin_head_branch(repo: Repo) -> str | None:
    try:
        symbolic = repo.git.symbolic_ref("refs/remotes/origin/HEAD").strip()
        prefix = "refs/remotes/origin/"
        if symbolic.startswith(prefix):
            branch = symbolic[len(prefix) :].strip()
            if branch:
                return branch
    except Exception:
        pass

    try:
        origin_head = repo.remotes.origin.refs.HEAD
        reference = getattr(origin_head, "reference", None)
        branch = str(getattr(reference, "remote_head", "") or "").strip()
        if branch and branch != "HEAD":
            return branch
    except Exception:
        pass
    return None


def resolve_base_branch(*, project_root: Path, preferred_base: str | None) -> str:
    try:
        repo = Repo(str(project_root))
    except (InvalidGitRepositoryError, NoSuchPathError) as exc:
        raise GitCommandError("Project is not a git repository") from exc

    requested = normalize_branch_name(preferred_base)
    remote_branches = _remote_branch_names(repo)

    if requested:
        if not remote_branches or requested in remote_branches:
            return requested

    origin_head = _origin_head_branch(repo)
    if origin_head and (not remote_branches or origin_head in remote_branches):
        return origin_head

    for candidate in ("main", "master"):
        if candidate in remote_branches:
            return candidate

    if remote_branches:
        return sorted(remote_branches)[0]
    return requested or "main"


def _clone_repo(project_root: Path, repo_full_name: str, access_token: str) -> Repo:
    try:
        repo = Repo.clone_from(clone_auth_url(repo_full_name, access_token), str(project_root))
    except Exception as exc:
        _raise_git_error(exc, access_token=access_token)
    repo.remotes.origin.set_url(public_repo_url(repo_full_name))
    return repo


def _checkout_working_branch(
    repo: Repo,
    *,
    access_token: str,
    base_branch: str | None,
    working_branch: str,
) -> str:
    if not _has_head_commit(repo):
        resolved_base = normalize_branch_name(base_branch) or "main"
        repo.git.checkout("--orphan", working_branch)
        return resolved_base

    current_branch = repo.git.rev_parse("--abbrev-ref", "HEAD").strip()
    requested_base = normalize_branch_name(base_branch)
    resolved_base = requested_base or current_branch
    if requested_base and requested_base != current_branch:
        with origin_with_auth(repo, access_token, GitCommandError) as remote:
            remote.fetch(requested_base)
        repo.git.checkout("-B", requested_base, f"origin/{requested_base}")
    repo.git.checkout("-B", working_branch, f"origin/{resolved_base}")
    return resolved_base


def clone_and_prepare_repo(
    *,
    project_root: Path,
    repo_full_name: str,
    access_token: str,
    base_branch: str | None,
    working_branch: str,
) -> str:
    project_root.mkdir(parents=True, exist_ok=True)
    tmp, moved = move_all_entries_to_temp(project_root)
    try:
        try:
            repo = _clone_repo(project_root, repo_full_name, access_token)
            resolved_base = _checkout_working_branch(
                repo,
                access_token=access_token,
                base_branch=base_branch,
                working_branch=working_branch,
            )
        except Exception as exc:
            _raise_git_error(exc, access_token=access_token)

        restore_entries_without_overwrite(project_root, tmp.name, moved)
        ensure_system_gitignore(project_root)
        return resolved_base
    finally:
        tmp.cleanup()


def _checkout_missing_working_branch(
    repo: Repo,
    *,
    access_token: str,
    working_branch: str,
    base_branch: str | None,
) -> None:
    target_base = normalize_branch_name(base_branch)
    if target_base:
        try:
            with origin_with_auth(repo, access_token, GitCommandError) as remote:
                remote.fetch(target_base)
            repo.git.checkout("-B", working_branch, f"origin/{target_base}")
            return
        except Exception:
            try:
                repo.git.checkout("-B", working_branch, target_base)
                return
            except Exception:
                pass
    try:
        repo.git.checkout("-B", working_branch)
    except Exception:
        repo.git.checkout("--orphan", working_branch)


def _commit_and_push(repo: Repo, access_token: str, working_branch: str, commit_title: str, github_login: str) -> None:
    with repo.config_writer() as writer:
        writer.set_value("user", "name", github_login or "deepagents-bot")
        writer.set_value("user", "email", f"{github_login or 'deepagents'}@users.noreply.github.com")
    repo.index.commit(commit_title)
    with origin_with_auth(repo, access_token, GitCommandError):
        repo.git.push("-u", "origin", working_branch)


def _load_repo(project_root: Path) -> Repo:
    try:
        return Repo(str(project_root))
    except (InvalidGitRepositoryError, NoSuchPathError) as exc:
        raise GitCommandError("Project is not a git repository") from exc


def _ensure_checkout(repo: Repo, *, access_token: str, working_branch: str, base_branch: str | None) -> None:
    try:
        repo.git.checkout(working_branch)
    except Exception as exc:
        message = sanitize_error_message(str(exc), access_token=access_token).lower()
        missing_branch = "pathspec" in message and "did not match any file" in message
        if not missing_branch:
            _raise_git_error(exc, access_token=access_token)
        _checkout_missing_working_branch(
            repo,
            access_token=access_token,
            working_branch=working_branch,
            base_branch=base_branch,
        )


def _stage_repo(repo: Repo, access_token: str) -> None:
    try:
        repo.git.add(A=True)
    except Exception as exc:
        _raise_git_error(exc, access_token=access_token)


def prepare_and_push_changes(
    *,
    project_root: Path,
    access_token: str,
    working_branch: str,
    base_branch: str | None = None,
    commit_title: str,
    github_login: str,
) -> bool:
    repo = _load_repo(project_root)
    _ensure_checkout(repo, access_token=access_token, working_branch=working_branch, base_branch=base_branch)
    ensure_system_gitignore(project_root)
    _stage_repo(repo, access_token)
    if not repo.is_dirty(untracked_files=True):
        return False
    try:
        _commit_and_push(repo, access_token, working_branch, commit_title, github_login)
    except Exception as exc:
        _raise_git_error(exc, access_token=access_token)
    return True
