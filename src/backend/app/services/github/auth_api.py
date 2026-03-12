from __future__ import annotations

import asyncio
from typing import Any, Callable

from .auth_common import GitHubAuthError


def _load_pygithub() -> tuple[type[Any], type[Any], type[Any], type[Any], type[Any]]:
    try:
        from github import Auth, Github
        from github.GithubException import (
            BadCredentialsException,
            GithubException,
            UnknownObjectException,
        )
    except Exception as exc:  # pragma: no cover - import failure path
        raise GitHubAuthError("PyGithub is not installed") from exc
    return Github, Auth, GithubException, BadCredentialsException, UnknownObjectException


def _error_from_github_exception(exc: Exception) -> str:
    raw = str(exc).strip()
    if raw:
        return raw
    data = getattr(exc, "data", None)
    if isinstance(data, dict):
        message = str(data.get("message") or "").strip()
        if message:
            return message
    status = getattr(exc, "status", None)
    if isinstance(status, int) and status > 0:
        return f"GitHub API request failed ({status})"
    return "GitHub API request failed"


def _normalize_repo_name(full_name: str) -> str:
    name = (full_name or "").strip()
    if "/" not in name:
        raise GitHubAuthError("Invalid repository full name")
    return name


async def _run_with_github_client(
    access_token: str,
    action: Callable[[Any], Any],
) -> Any:
    Github, Auth, GithubException, BadCredentialsException, UnknownObjectException = _load_pygithub()

    def _run() -> Any:
        client = Github(auth=Auth.Token(access_token), per_page=100)
        try:
            return action(client)
        except BadCredentialsException as exc:
            raise GitHubAuthError("Invalid GitHub access token") from exc
        except UnknownObjectException as exc:
            raise GitHubAuthError("GitHub resource not found") from exc
        except GithubException as exc:
            raise GitHubAuthError(_error_from_github_exception(exc)) from exc
        except GitHubAuthError:
            raise
        except Exception as exc:
            raise GitHubAuthError(str(exc) or "GitHub API request failed") from exc
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                close()

    return await asyncio.to_thread(_run)


async def github_get_user(access_token: str) -> dict[str, Any]:
    data = await _run_with_github_client(access_token, lambda client: client.get_user().raw_data)
    if not isinstance(data, dict):
        raise GitHubAuthError("Invalid GitHub user response")
    return data


async def github_list_repos(access_token: str) -> list[dict[str, Any]]:
    repos = await _run_with_github_client(
        access_token,
        lambda client: [repo.raw_data for repo in client.get_user().get_repos(sort="updated", direction="desc")],
    )
    return [repo for repo in repos if isinstance(repo, dict)] if isinstance(repos, list) else []


async def github_get_repo(access_token: str, full_name: str) -> dict[str, Any]:
    repo_name = _normalize_repo_name(full_name)
    data = await _run_with_github_client(access_token, lambda client: client.get_repo(repo_name).raw_data)
    if not isinstance(data, dict):
        raise GitHubAuthError("Invalid GitHub repo response")
    return data


async def github_create_pull_request(
    access_token: str,
    *,
    repo_full_name: str,
    title: str,
    body: str,
    head: str,
    base: str,
) -> dict[str, Any]:
    repo_name = _normalize_repo_name(repo_full_name)
    payload = await _run_with_github_client(
        access_token,
        lambda client: client.get_repo(repo_name).create_pull(
            title=title,
            body=body,
            head=head,
            base=base,
        ).raw_data,
    )
    if not isinstance(payload, dict):
        raise GitHubAuthError("Invalid GitHub pull request response")
    return payload


async def github_create_repo(
    access_token: str,
    *,
    name: str,
    description: str = "",
    private: bool = True,
) -> dict[str, Any]:
    repo_name = (name or "").strip()
    if not repo_name:
        raise GitHubAuthError("Repository name is required")
    payload = await _run_with_github_client(
        access_token,
        lambda client: client.get_user().create_repo(
            name=repo_name,
            description=(description or "").strip(),
            private=bool(private),
            auto_init=False,
        ).raw_data,
    )
    if not isinstance(payload, dict):
        raise GitHubAuthError("Invalid GitHub repository response")
    return payload
