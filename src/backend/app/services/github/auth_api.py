from __future__ import annotations

from typing import Any

import httpx

from .auth_common import GITHUB_API_URL, GitHubAuthError


def _format_github_error(payload: Any) -> str:
    if not isinstance(payload, dict):
        return str(payload)

    message = str(payload.get("message", "")).strip() or "GitHub API error"
    errors = payload.get("errors")
    details: list[str] = []
    if isinstance(errors, list):
        for item in errors:
            if isinstance(item, str):
                details.append(item)
                continue
            if not isinstance(item, dict):
                continue
            item_msg = str(item.get("message", "")).strip()
            if item_msg:
                details.append(item_msg)
                continue
            resource = str(item.get("resource", "")).strip()
            field = str(item.get("field", "")).strip()
            code = str(item.get("code", "")).strip()
            parts = [part for part in (resource, field, code) if part]
            if parts:
                details.append("/".join(parts))
    elif isinstance(errors, str) and errors.strip():
        details.append(errors.strip())

    if details:
        message = f"{message}: {'; '.join(details)}"

    doc = str(payload.get("documentation_url", "")).strip()
    if doc:
        message = f"{message} ({doc})"
    return message


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
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {access_token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    payload = {"title": title, "body": body, "head": head, "base": base}
    async with httpx.AsyncClient(timeout=25) as client:
        response = await client.post(
            f"{GITHUB_API_URL}/repos/{repo_full_name}/pulls",
            json=payload,
            headers=headers,
        )
    if response.status_code >= 400:
        try:
            msg = _format_github_error(response.json())
        except Exception:
            msg = (response.text or "").strip() or f"Create pull request failed ({response.status_code})"
        raise GitHubAuthError(f"Create pull request failed: {msg}")
    data = response.json()
    if not isinstance(data, dict):
        raise GitHubAuthError("Invalid PR response")
    return data


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

    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {access_token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    payload = {
        "name": repo_name,
        "description": (description or "").strip(),
        "private": bool(private),
        "auto_init": False,
    }
    async with httpx.AsyncClient(timeout=25) as client:
        response = await client.post(
            f"{GITHUB_API_URL}/user/repos",
            json=payload,
            headers=headers,
        )
    if response.status_code >= 400:
        try:
            msg = _format_github_error(response.json())
        except Exception:
            msg = (response.text or "").strip() or f"Create repository failed ({response.status_code})"
        raise GitHubAuthError(f"Create repository failed: {msg}")

    data = response.json()
    if not isinstance(data, dict):
        raise GitHubAuthError("Invalid repository response")
    return data
