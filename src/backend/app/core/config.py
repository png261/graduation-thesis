from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic import Field
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        case_sensitive=False,
    )

    google_api_key: str | None = Field(default=None, alias="GOOGLE_API_KEY")
    gemini_model: str = Field(
        default="gemini:gemini-2.5-flash", alias="GEMINI_MODEL")
    cors_origins: str = Field(
        default="http://localhost:5173", alias="CORS_ORIGINS")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    database_url: str = Field(
        default="postgresql://postgres:postgres@localhost:5432/deepagents",
        alias="DATABASE_URL",
    )
    github_client_id: str | None = Field(default=None, alias="GITHUB_CLIENT_ID")
    github_client_secret: str | None = Field(default=None, alias="GITHUB_CLIENT_SECRET")
    github_oauth_redirect_uri: str = Field(
        default="http://localhost:8000/api/github/callback",
        alias="GITHUB_OAUTH_REDIRECT_URI",
    )
    github_auth_oauth_redirect_uri: str = Field(
        default="http://localhost:8000/api/auth/github/callback",
        alias="GITHUB_AUTH_OAUTH_REDIRECT_URI",
    )
    github_oauth_success_redirect: str = Field(
        default="http://localhost:5173",
        alias="GITHUB_OAUTH_SUCCESS_REDIRECT",
    )
    github_token_encryption_key: str | None = Field(
        default=None, alias="GITHUB_TOKEN_ENCRYPTION_KEY"
    )
    github_session_ttl_hours: int = Field(default=24 * 7, alias="GITHUB_SESSION_TTL_HOURS")
    google_client_id: str | None = Field(default=None, alias="GOOGLE_CLIENT_ID")
    google_client_secret: str | None = Field(default=None, alias="GOOGLE_CLIENT_SECRET")
    google_oauth_redirect_uri: str = Field(
        default="http://localhost:8000/api/auth/google/callback",
        alias="GOOGLE_OAUTH_REDIRECT_URI",
    )
    auth_oauth_success_redirect: str = Field(
        default="http://localhost:5173",
        alias="AUTH_OAUTH_SUCCESS_REDIRECT",
    )
    auth_token_encryption_key: str | None = Field(
        default=None,
        alias="AUTH_TOKEN_ENCRYPTION_KEY",
    )
    auth_session_ttl_hours: int = Field(default=24 * 7, alias="AUTH_SESSION_TTL_HOURS")
    infracost_api_key: str | None = Field(default=None, alias="INFRACOST_API_KEY")

    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
