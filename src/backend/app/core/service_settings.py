from __future__ import annotations

from dataclasses import dataclass

from app.core.config import Settings


@dataclass(frozen=True)
class GatewaySettings:
    database_url: str
    cors_origins: str
    log_level: str
    file_url_signing_secret: str
    file_url_ttl_seconds: int


@dataclass(frozen=True)
class IdentityProjectSettings:
    database_url: str
    oauth_state_signing_secret: str
    cognito_region: str
    cognito_user_pool_id: str
    cognito_client_id: str


@dataclass(frozen=True)
class ConversationAgentSettings:
    database_url: str
    llm_base_url: str
    llm_api_key: str
    llm_model: str
    opentofu_mcp_enabled: bool
    opentofu_mcp_url: str
    agent_max_tool_calls: int
    incident_memory_top_k: int
    incident_token_budget: int


@dataclass(frozen=True)
class WorkflowSettings:
    database_url: str
    redis_url: str
    celery_broker_url: str
    celery_result_backend: str
    jobs_event_ttl_seconds: int
    jobs_event_tail_limit: int
    jobs_history_retention_days: int


@dataclass(frozen=True)
class BlueprintSettings:
    database_url: str
    file_url_signing_secret: str
    file_url_ttl_seconds: int
    zip_import_max_bytes: int
    zip_import_max_files: int
    zip_import_max_uncompressed_bytes: int


@dataclass(frozen=True)
class ProvisioningSettings:
    database_url: str
    redis_url: str
    infracost_api_key: str | None
    opentofu_mcp_enabled: bool
    opentofu_mcp_url: str
    state_encryption_key: str


@dataclass(frozen=True)
class ConfigurationIncidentSettings:
    database_url: str
    redis_url: str
    ansible_ssh_key_path: str | None
    ansible_playbook_path: str
    ansible_aws_ssm_bucket_name: str | None
    ansible_ssh_common_args: str
    ansible_host_key_checking: bool
    incident_confidence_threshold: float
    alert_cooldown_seconds: int


@dataclass(frozen=True)
class ScmIntegrationSettings:
    database_url: str
    oauth_state_signing_secret: str
    github_app_id: str
    github_app_install_url: str
    github_app_private_key: str


@dataclass(frozen=True)
class ServiceSettingsBundle:
    gateway: GatewaySettings
    identity_project: IdentityProjectSettings
    conversation_agent: ConversationAgentSettings
    workflow: WorkflowSettings
    blueprint: BlueprintSettings
    provisioning: ProvisioningSettings
    configuration_incident: ConfigurationIncidentSettings
    scm_integration: ScmIntegrationSettings


def _database_url(settings: Settings, override: str | None) -> str:
    return settings.service_database_url("shared", override)


def build_service_settings_bundle(settings: Settings) -> ServiceSettingsBundle:
    return ServiceSettingsBundle(
        gateway=GatewaySettings(
            database_url=settings.service_database_url("gateway", settings.gateway_database_url),
            cors_origins=settings.cors_origins,
            log_level=settings.log_level,
            file_url_signing_secret=settings.file_url_signing_secret,
            file_url_ttl_seconds=settings.file_url_ttl_seconds,
        ),
        identity_project=IdentityProjectSettings(
            database_url=settings.service_database_url("identity_project", settings.identity_project_database_url),
            oauth_state_signing_secret=settings.oauth_state_signing_secret,
            cognito_region=settings.cognito_region,
            cognito_user_pool_id=settings.cognito_user_pool_id,
            cognito_client_id=settings.cognito_client_id,
        ),
        conversation_agent=ConversationAgentSettings(
            database_url=settings.service_database_url("conversation", settings.conversation_database_url),
            llm_base_url=settings.llm_base_url,
            llm_api_key=settings.llm_api_key,
            llm_model=settings.llm_model,
            opentofu_mcp_enabled=settings.opentofu_mcp_enabled,
            opentofu_mcp_url=settings.opentofu_mcp_url,
            agent_max_tool_calls=settings.agent_max_tool_calls,
            incident_memory_top_k=settings.incident_memory_top_k,
            incident_token_budget=settings.incident_token_budget,
        ),
        workflow=WorkflowSettings(
            database_url=settings.service_database_url("workflow", settings.workflow_database_url),
            redis_url=settings.redis_url,
            celery_broker_url=settings.celery_broker_url,
            celery_result_backend=settings.celery_result_backend,
            jobs_event_ttl_seconds=settings.jobs_event_ttl_seconds,
            jobs_event_tail_limit=settings.jobs_event_tail_limit,
            jobs_history_retention_days=settings.jobs_history_retention_days,
        ),
        blueprint=BlueprintSettings(
            database_url=settings.service_database_url("blueprint", settings.blueprint_database_url),
            file_url_signing_secret=settings.file_url_signing_secret,
            file_url_ttl_seconds=settings.file_url_ttl_seconds,
            zip_import_max_bytes=settings.zip_import_max_bytes,
            zip_import_max_files=settings.zip_import_max_files,
            zip_import_max_uncompressed_bytes=settings.zip_import_max_uncompressed_bytes,
        ),
        provisioning=ProvisioningSettings(
            database_url=settings.service_database_url("provisioning", settings.provisioning_database_url),
            redis_url=settings.redis_url,
            infracost_api_key=settings.infracost_api_key,
            opentofu_mcp_enabled=settings.opentofu_mcp_enabled,
            opentofu_mcp_url=settings.opentofu_mcp_url,
            state_encryption_key=settings.state_encryption_key,
        ),
        configuration_incident=ConfigurationIncidentSettings(
            database_url=settings.service_database_url(
                "configuration_incident",
                settings.configuration_incident_database_url,
            ),
            redis_url=settings.redis_url,
            ansible_ssh_key_path=settings.ansible_ssh_key_path,
            ansible_playbook_path=settings.ansible_playbook_path,
            ansible_aws_ssm_bucket_name=settings.ansible_aws_ssm_bucket_name,
            ansible_ssh_common_args=settings.ansible_ssh_common_args,
            ansible_host_key_checking=settings.ansible_host_key_checking,
            incident_confidence_threshold=settings.incident_confidence_threshold,
            alert_cooldown_seconds=settings.alert_cooldown_seconds,
        ),
        scm_integration=ScmIntegrationSettings(
            database_url=settings.service_database_url("scm", settings.scm_database_url),
            oauth_state_signing_secret=settings.oauth_state_signing_secret,
            github_app_id=settings.github_app_id,
            github_app_install_url=settings.github_app_install_url,
            github_app_private_key=settings.github_app_private_key,
        ),
    )
