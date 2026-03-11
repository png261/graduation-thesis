"""GitHub API facade used by application services and routers."""
from __future__ import annotations

from .auth_api import (
    github_create_pull_request,
    github_create_repo,
    github_get_repo,
    github_get_user,
    github_list_repos,
)
from .auth_common import (
    GITHUB_API_URL,
    GitHubAuthError,
)

__all__ = [
    "GITHUB_API_URL",
    "GitHubAuthError",
    "github_create_pull_request",
    "github_create_repo",
    "github_get_repo",
    "github_get_user",
    "github_list_repos",
]
