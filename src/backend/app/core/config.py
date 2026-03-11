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
    clerk_secret_key: str | None = Field(default=None, alias="CLERK_SECRET_KEY")
    clerk_jwt_key: str | None = Field(default=None, alias="CLERK_JWT_KEY")
    clerk_authorized_parties: str = Field(default="", alias="CLERK_AUTHORIZED_PARTIES")
    clerk_audience: str = Field(default="", alias="CLERK_AUDIENCE")
    infracost_api_key: str | None = Field(default=None, alias="INFRACOST_API_KEY")

    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    def clerk_authorized_parties_list(self) -> List[str]:
        return [value.strip() for value in self.clerk_authorized_parties.split(",") if value.strip()]

    def clerk_audience_list(self) -> List[str]:
        return [value.strip() for value in self.clerk_audience.split(",") if value.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
