"""Helpers for GitHub router endpoints."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import GitHubAccount
from app.routers import github_dependencies as github_deps
from app.services.auth.shared import cookie_kwargs
from app.services.github import auth as github_auth


async def account_access_token_or_http_error(
    session: AsyncSession,
    settings: Settings,
    account: GitHubAccount,
) -> str:
    try:
        return await github_auth.get_account_access_token(
            session,
            settings=settings,
            account=account,
        )
    except github_auth.GitHubAuthError as exc:
        raise github_deps.to_github_auth_http_exception(
            exc,
            status_code=400,
            code="github_token_error",
        )


def map_auth_error(
    exc: github_auth.GitHubAuthError,
    *,
    code: str,
    status_code: int = 400,
):
    return github_deps.to_github_auth_http_exception(
        exc,
        status_code=status_code,
        code=code,
    )
