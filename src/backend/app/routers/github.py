"""GitHub endpoints backed by Clerk-linked OAuth access tokens."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.models import User
from app.routers import auth_dependencies as auth_deps
from app.routers import github_dependencies as github_deps
from app.services.github import auth as github_auth
from app.services.github.repo_payloads import repo_payload

router = APIRouter(prefix="/api/github", tags=["github"])


class CreateRepoBody(BaseModel):
    name: str
    description: str = ""
    private: bool = True


@router.get("/session")
async def github_session_status(
    current_user: User | None = Depends(auth_deps.get_current_user_optional),
    github_ctx: github_deps.GitHubAuthContext | None = Depends(
        github_deps.get_optional_github_auth_context
    ),
) -> dict:
    if current_user is None or github_ctx is None:
        return {"authenticated": False}
    return {
        "authenticated": True,
        "login": github_ctx.login,
        "githubUserId": github_ctx.github_user_id,
        "githubAccountId": None,
        "expiresAt": None,
    }


@router.get("/repos")
async def github_repos(
    github_ctx: github_deps.GitHubAuthContext = Depends(
        github_deps.require_authenticated_github_context
    ),
) -> dict:
    try:
        repos = await github_auth.github_list_repos(github_ctx.access_token)
    except github_auth.GitHubAuthError as exc:
        raise github_deps.to_github_auth_http_exception(
            exc,
            status_code=401,
            code="github_list_repos_failed",
        )

    result = [repo_payload(repo) for repo in repos]
    result.sort(key=lambda item: str(item.get("full_name", "")))
    return {"repos": result}


@router.post("/repos")
async def github_create_repo(
    body: CreateRepoBody,
    github_ctx: github_deps.GitHubAuthContext = Depends(
        github_deps.require_authenticated_github_context
    ),
) -> dict:
    try:
        repo = await github_auth.github_create_repo(
            github_ctx.access_token,
            name=body.name,
            description=body.description,
            private=body.private,
        )
    except github_auth.GitHubAuthError as exc:
        raise github_deps.to_github_auth_http_exception(
            exc,
            status_code=401,
            code="github_create_repo_failed",
        )

    return {"repo": repo_payload(repo)}

