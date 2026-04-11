from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _json_string_map(raw: str | None, env_name: str) -> dict[str, str]:
    if not raw or not raw.strip():
        return {}
    value = json.loads(raw)
    if not isinstance(value, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in value.items()):
        raise ValueError(f"{env_name} must be a JSON object with string keys and values")
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        case_sensitive=False,
        extra="ignore",
    )

    llm_base_url: str = Field(alias="LLM_BASE_URL")
    llm_api_key: str = Field(alias="LLM_API_KEY")
    llm_model: str = Field(alias="LLM_MODEL")
    cors_origins: str = Field(alias="CORS_ORIGINS")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    database_url: str = Field(alias="DATABASE_URL")
    cognito_region: str | None = Field(default=None, alias="COGNITO_REGION")
    cognito_user_pool_id: str | None = Field(default=None, alias="COGNITO_USER_POOL_ID")
    cognito_client_id: str | None = Field(default=None, alias="COGNITO_CLIENT_ID")
    cognito_issuer: str | None = Field(default=None, alias="COGNITO_ISSUER")
    github_client_id: str | None = Field(default=None, alias="GITHUB_CLIENT_ID")
    github_client_secret: str | None = Field(default=None, alias="GITHUB_CLIENT_SECRET")
    github_redirect_uri: str | None = Field(default=None, alias="GITHUB_REDIRECT_URI")
    github_oauth_authorize_url: str = Field(alias="GITHUB_OAUTH_AUTHORIZE_URL")
    github_oauth_token_url: str = Field(alias="GITHUB_OAUTH_TOKEN_URL")
    infracost_api_key: str | None = Field(default=None, alias="INFRACOST_API_KEY")
    file_url_signing_secret: str = Field(default="dev-file-url-secret", alias="FILE_URL_SIGNING_SECRET")
    file_url_ttl_seconds: int = Field(default=300, alias="FILE_URL_TTL_SECONDS")
    ansible_ssh_key_path: str | None = Field(default=None, alias="ANSIBLE_SSH_KEY_PATH")
    ansible_playbook_path: str = Field(default="playbooks/site.yml", alias="ANSIBLE_PLAYBOOK_PATH")
    ansible_aws_ssm_bucket_name: str | None = Field(default=None, alias="ANSIBLE_AWS_SSM_BUCKET_NAME")
    ansible_ssh_common_args: str = Field(default="", alias="ANSIBLE_SSH_COMMON_ARGS")
    ansible_host_key_checking: bool = Field(default=True, alias="ANSIBLE_HOST_KEY_CHECKING")
    zip_import_max_bytes: int = Field(default=20 * 1024 * 1024, alias="ZIP_IMPORT_MAX_BYTES")
    zip_import_max_files: int = Field(default=2000, alias="ZIP_IMPORT_MAX_FILES")
    zip_import_max_uncompressed_bytes: int = Field(
        default=80 * 1024 * 1024,
        alias="ZIP_IMPORT_MAX_UNCOMPRESSED_BYTES",
    )
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")
    runtime_cache_ttl_seconds: int = Field(default=300, alias="RUNTIME_CACHE_TTL_SECONDS")
    opentofu_mcp_enabled: bool = Field(default=True, alias="OPENTOFU_MCP_ENABLED")
    opentofu_mcp_url: str = Field(default="https://mcp.opentofu.org/sse", alias="OPENTOFU_MCP_URL")
    incident_confidence_threshold: float = Field(default=0.7, alias="INCIDENT_CONFIDENCE_THRESHOLD")
    agent_max_tool_calls: int = Field(default=25, alias="AGENT_MAX_TOOL_CALLS")
    agent_async_subagents_enabled: bool = Field(default=False, alias="AGENT_ASYNC_SUBAGENTS_ENABLED")
    agent_async_subagents_url: str | None = Field(default=None, alias="AGENT_ASYNC_SUBAGENTS_URL")
    agent_async_subagents_graph_ids: str = Field(default="", alias="AGENT_ASYNC_SUBAGENT_GRAPH_IDS")
    agent_async_subagents_headers: str = Field(default="", alias="AGENT_ASYNC_SUBAGENT_HEADERS")
    alert_cooldown_seconds: int = Field(default=300, alias="ALERT_COOLDOWN_SECONDS")
    incident_memory_top_k: int = Field(default=5, alias="INCIDENT_MEMORY_TOP_K")
    incident_token_budget: int = Field(default=16000, alias="INCIDENT_TOKEN_BUDGET")
    state_encryption_key: str = Field(default="dev-state-encryption-key", alias="STATE_ENCRYPTION_KEY")
    state_sync_scan_interval_minutes: int = Field(default=60, alias="STATE_SYNC_SCAN_INTERVAL_MINUTES")
    state_sync_max_backends_per_tick: int = Field(default=25, alias="STATE_SYNC_MAX_BACKENDS_PER_TICK")

    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    def async_subagent_graph_ids(self) -> dict[str, str]:
        return _json_string_map(self.agent_async_subagents_graph_ids, "AGENT_ASYNC_SUBAGENT_GRAPH_IDS")

    def async_subagent_headers(self) -> dict[str, str]:
        return _json_string_map(self.agent_async_subagents_headers, "AGENT_ASYNC_SUBAGENT_HEADERS")


@lru_cache
def get_settings() -> Settings:
    return Settings()
