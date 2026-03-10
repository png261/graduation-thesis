from __future__ import annotations

GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_API_URL = "https://api.github.com"
GITHUB_SCOPES = "repo read:user"

OAUTH_STATE_COOKIE = "gh_oauth_state"
SESSION_COOKIE = "gh_session"


class GitHubAuthError(Exception):
    pass
