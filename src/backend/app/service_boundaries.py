from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ServiceBoundary:
    name: str
    owned_data: tuple[str, ...]
    current_references: tuple[str, ...]
    sync_contracts: tuple[str, ...]
    async_contracts: tuple[str, ...]


SERVICE_BOUNDARIES: tuple[ServiceBoundary, ...] = (
    ServiceBoundary(
        name="gateway",
        owned_data=(),
        current_references=(
            "app.main",
            "app.gateway_routes",
        ),
        sync_contracts=(
            "identity-project.read_project",
            "conversation-agent.chat",
            "workflow.jobs",
            "provisioning.status-preview",
            "scm-integration.repository-link",
        ),
        async_contracts=("workflow.event-stream",),
    ),
    ServiceBoundary(
        name="identity-project",
        owned_data=("users", "projects"),
        current_references=(
            "app.identity_project_main",
            "app.identity_project_routes",
            "app.services.identity_project",
            "app.routers.auth_dependencies",
            "app.routers.projects_routes.project_crud",
            "app.routers.projects_routes.project_workspace",
        ),
        sync_contracts=("gateway.project-lookup", "scm-integration.project-link-update"),
        async_contracts=("project.updated",),
    ),
    ServiceBoundary(
        name="conversation-agent",
        owned_data=("threads", "thread_messages", "langgraph_checkpoints", "agent_sessions"),
        current_references=(
            "app.conversation_main",
            "app.conversation_routes",
            "app.services.conversation",
            "app.services.chat",
            "app.services.agent.runtime",
        ),
        sync_contracts=("gateway.chat", "identity-project.project-context"),
        async_contracts=("workflow.run-chat", "conversation.stream-event"),
    ),
    ServiceBoundary(
        name="workflow",
        owned_data=(),
        current_references=(
            "app.workflow_main",
            "app.workflow_routes",
        ),
        sync_contracts=(),
        async_contracts=(),
    ),
    ServiceBoundary(
        name="provisioning",
        owned_data=("opentofu_execution_state", "target_contract_state", "graph_cost_cache"),
        current_references=(
            "app.provisioning_main",
            "app.provisioning_routes",
            "app.services.provisioning",
            "app.services.opentofu",
            "app.routers.projects_routes.project_opentofu",
        ),
        sync_contracts=("gateway.status-preview", "workflow.command-receive"),
        async_contracts=("workflow.stage-event", "configuration-incident.target-ready"),
    ),
    ServiceBoundary(
        name="configuration-incident",
        owned_data=("ansible_execution_state", "ssm_readiness_state", "incident_summaries"),
        current_references=(
            "app.configuration_incident_main",
            "app.configuration_incident_routes",
            "app.services.ansible",
            "app.services.configuration_incident",
            "app.services.incident",
            "app.routers.projects_routes.project_ansible",
            "app.routers.projects_routes.project_incidents",
        ),
        sync_contracts=("gateway.incident-reads", "workflow.command-receive"),
        async_contracts=("workflow.stage-event", "incident.summary-ready"),
    ),
    ServiceBoundary(
        name="scm-integration",
        owned_data=("github_installations", "repository_sync_state"),
        current_references=(
            "app.scm_main",
            "app.scm_routes",
            "app.services.scm",
            "app.services.github",
            "app.routers.projects_routes.project_github",
        ),
        sync_contracts=("gateway.github-flow", "identity-project.project-link-lookup"),
        async_contracts=("project.repository-linked",),
    ),
)


SERVICE_BOUNDARIES_BY_NAME = {boundary.name: boundary for boundary in SERVICE_BOUNDARIES}
