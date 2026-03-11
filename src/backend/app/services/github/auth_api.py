from __future__ import annotations

from typing import Any

import httpx

from .auth_common import GITHUB_API_URL, GitHubAuthError


def _detail_from_item(item: dict[str, Any]) -> str | None:
    item_msg = str(item.get("message", "")).strip()
    if item_msg:
        return item_msg
    parts = [str(item.get(key, "")).strip() for key in ("resource", "field", "code")]
    values = [part for part in parts if part]
    return "/".join(values) if values else None


def _error_details(errors: Any) -> list[str]:
    if isinstance(errors, str) and errors.strip():
        return [errors.strip()]
    if not isinstance(errors, list):
        return []
    details: list[str] = []
    for item in errors:
        if isinstance(item, str):
            details.append(item)
            continue
        if isinstance(item, dict):
            detail = _detail_from_item(item)
            if detail:
                details.append(detail)
    return details


def _append_docs(message: str, payload: dict[str, Any]) -> str:
    doc = str(payload.get("documentation_url", "")).strip()
    return f"{message} ({doc})" if doc else message


def _format_github_error(payload: Any) -> str:
    if not isinstance(payload, dict):
        return str(payload)

    message = str(payload.get("message", "")).strip() or "GitHub API error"
    details = _error_details(payload.get("errors"))
    if details:
        message = f"{message}: {'; '.join(details)}"
    return _append_docs(message, payload)


async def _github_get(access_token: str, path: str, params: dict[str, Any] | None = None) -> Any:
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {access_token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    async with httpx.AsyncClient(timeout=25) as client:
        response = await client.get(f"{GITHUB_API_URL}{path}", params=params, headers=headers)
    if response.status_code >= 400:
        try:
            data = response.json()
            msg = _format_github_error(data)
        except Exception:
            msg = (response.text or "").strip() or f"GitHub API request failed ({response.status_code})"
        raise GitHubAuthError(msg)
    return response.json()


def _github_headers(access_token: str) -> dict[str, str]:
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {access_token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }


async def _github_post(access_token: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=25) as client:
        response = await client.post(
            f"{GITHUB_API_URL}{path}",
            json=payload,
            headers=_github_headers(access_token),
        )
    if response.status_code >= 400:
        try:
            message = _format_github_error(response.json())
        except Exception:
            message = (response.text or "").strip() or f"GitHub API request failed ({response.status_code})"
        raise GitHubAuthError(message)
    data = response.json()
    if not isinstance(data, dict):
        raise GitHubAuthError("Invalid GitHub response")
    return data


async def github_get_user(access_token: str) -> dict[str, Any]:
    data = await _github_get(access_token, "/user")
    if not isinstance(data, dict):
        raise GitHubAuthError("Invalid GitHub user response")
    return data


async def github_list_repos(access_token: str) -> list[dict[str, Any]]:
    repos: list[dict[str, Any]] = []
    page = 1
    while True:
        data = await _github_get(
            access_token,
            "/user/repos",
            params={
                "affiliation": "owner,collaborator,organization_member",
                "sort": "updated",
                "per_page": 100,
                "page": page,
            },
        )
        if not isinstance(data, list) or not data:
            break
        repos.extend([item for item in data if isinstance(item, dict)])
        if len(data) < 100:
            break
        page += 1
    return repos


async def github_get_repo(access_token: str, full_name: str) -> dict[str, Any]:
    owner_repo = full_name.strip()
    if "/" not in owner_repo:
        raise GitHubAuthError("Invalid repository full name")
    data = await _github_get(access_token, f"/repos/{owner_repo}")
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
    payload = {"title": title, "body": body, "head": head, "base": base}
    try:
        return await _github_post(access_token, f"/repos/{repo_full_name}/pulls", payload)
    except GitHubAuthError as exc:
        raise GitHubAuthError(f"Create pull request failed: {exc}") from exc


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

    payload = {
        "name": repo_name,
        "description": (description or "").strip(),
        "private": bool(private),
        "auto_init": False,
    }
    try:
        return await _github_post(access_token, "/user/repos", payload)
    except GitHubAuthError as exc:
        raise GitHubAuthError(f"Create repository failed: {exc}") from exc
