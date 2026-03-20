from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        case_sensitive=False,
        extra="ignore",
    )

    llm_base_url: str = Field(default="http://127.0.0.1:8317/v1", alias="LLM_BASE_URL")
    llm_api_key: str = Field(default="developer", alias="LLM_API_KEY")
    llm_model: str = Field(default="gpt-5.4", alias="LLM_MODEL")
    cors_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        alias="CORS_ORIGINS",
    )
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
    file_url_signing_secret: str = Field(default="dev-file-url-secret", alias="FILE_URL_SIGNING_SECRET")
    file_url_ttl_seconds: int = Field(default=300, alias="FILE_URL_TTL_SECONDS")
    ansible_ssh_key_path: str | None = Field(default=None, alias="ANSIBLE_SSH_KEY_PATH")
    ansible_playbook_path: str = Field(default="playbooks/site.yml", alias="ANSIBLE_PLAYBOOK_PATH")
    ansible_aws_ssm_bucket_name: str | None = Field(default=None, alias="ANSIBLE_AWS_SSM_BUCKET_NAME")
    ansible_ssh_common_args: str = Field(default="", alias="ANSIBLE_SSH_COMMON_ARGS")
    ansible_host_key_checking: bool = Field(default=True, alias="ANSIBLE_HOST_KEY_CHECKING")
    telegram_bot_token: str | None = Field(default=None, alias="TELEGRAM_BOT_TOKEN")
    telegram_webhook_url: str | None = Field(default=None, alias="TELEGRAM_WEBHOOK_URL")
    telegram_webhook_secret: str | None = Field(default=None, alias="TELEGRAM_WEBHOOK_SECRET")
    zip_import_max_bytes: int = Field(default=20 * 1024 * 1024, alias="ZIP_IMPORT_MAX_BYTES")
    zip_import_max_files: int = Field(default=2000, alias="ZIP_IMPORT_MAX_FILES")
    zip_import_max_uncompressed_bytes: int = Field(
        default=80 * 1024 * 1024,
        alias="ZIP_IMPORT_MAX_UNCOMPRESSED_BYTES",
    )
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")
    celery_broker_url: str = Field(default="amqp://guest:guest@localhost:5672//", alias="CELERY_BROKER_URL")
    celery_result_backend: str = Field(default="redis://localhost:6379/1", alias="CELERY_RESULT_BACKEND")
    jobs_event_ttl_seconds: int = Field(default=86400, alias="JOBS_EVENT_TTL_SECONDS")
    jobs_event_tail_limit: int = Field(default=200, alias="JOBS_EVENT_TAIL_LIMIT")
    jobs_history_retention_days: int = Field(default=90, alias="JOBS_HISTORY_RETENTION_DAYS")
    runtime_cache_ttl_seconds: int = Field(default=300, alias="RUNTIME_CACHE_TTL_SECONDS")
    opentofu_mcp_enabled: bool = Field(default=True, alias="OPENTOFU_MCP_ENABLED")
    opentofu_mcp_url: str = Field(default="https://mcp.opentofu.org/sse", alias="OPENTOFU_MCP_URL")
    incident_confidence_threshold: float = Field(default=0.7, alias="INCIDENT_CONFIDENCE_THRESHOLD")
    agent_max_tool_calls: int = Field(default=25, alias="AGENT_MAX_TOOL_CALLS")
    alert_cooldown_seconds: int = Field(default=300, alias="ALERT_COOLDOWN_SECONDS")
    incident_memory_top_k: int = Field(default=5, alias="INCIDENT_MEMORY_TOP_K")
    incident_token_budget: int = Field(default=16000, alias="INCIDENT_TOKEN_BUDGET")
    state_encryption_key: str = Field(default="dev-state-encryption-key", alias="STATE_ENCRYPTION_KEY")
    state_sync_scan_interval_minutes: int = Field(default=60, alias="STATE_SYNC_SCAN_INTERVAL_MINUTES")
    state_sync_max_backends_per_tick: int = Field(default=25, alias="STATE_SYNC_MAX_BACKENDS_PER_TICK")
    state_alert_notify_severity: str = Field(
        default="critical,high",
        alias="STATE_ALERT_NOTIFY_SEVERITY",
    )
    gitlab_client_id: str | None = Field(default=None, alias="GITLAB_CLIENT_ID")
    gitlab_client_secret: str | None = Field(default=None, alias="GITLAB_CLIENT_SECRET")
    gitlab_redirect_uri: str | None = Field(default=None, alias="GITLAB_REDIRECT_URI")
    gitlab_oauth_authorize_url: str = Field(
        default="https://gitlab.com/oauth/authorize",
        alias="GITLAB_OAUTH_AUTHORIZE_URL",
    )
    gitlab_oauth_token_url: str = Field(
        default="https://gitlab.com/oauth/token",
        alias="GITLAB_OAUTH_TOKEN_URL",
    )
    gitlab_api_url: str = Field(default="https://gitlab.com/api/v4", alias="GITLAB_API_URL")

    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    def clerk_authorized_parties_list(self) -> List[str]:
        return [value.strip() for value in self.clerk_authorized_parties.split(",") if value.strip()]

    def clerk_audience_list(self) -> List[str]:
        return [value.strip() for value in self.clerk_audience.split(",") if value.strip()]

    def state_alert_notify_severity_list(self) -> List[str]:
        return [
            value.strip().lower()
            for value in self.state_alert_notify_severity.split(",")
            if value.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
