"""Strands agent with Gateway MCP tools, Memory, and Code Interpreter."""

import json
import logging
import os
import stat

from bedrock_agentcore.memory.integrations.strands.config import (
    AgentCoreMemoryConfig,
    RetrievalConfig,
)
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from strands import Agent
from strands.models import OpenAIModel
from openai import AsyncOpenAI
from strands_tools import file_read, file_write
from tools.gateway import create_gateway_mcp_client
from utils.auth import extract_user_id_from_context, get_openai_credentials
from utils.github_app import (
    create_pull_request,
    get_file_diff,
    list_installed_repositories,
    list_pull_requests,
    preview_pull_request,
    scratch_workspace_path,
    setup_repository_workspace,
)

from tools.code_interpreter import StrandsCodeInterpreterTools

logger = logging.getLogger(__name__)

app = BedrockAgentCoreApp()

SYSTEM_PROMPT = (
    "You are a helpful assistant with access to tools via the Gateway, Code Interpreter, "
    "and session-scoped S3-backed files mounted at /mnt/s3. "
    "Use the Strands file_write tool for creating or updating files, and file_read for "
    "reading, searching, or listing files. Your working directory is a dedicated folder for "
    "this chat session, so relative file paths are isolated from other chats and sync to "
    "the frontend file browser. "
    "When asked about your tools, list them and explain what they do."
)


def _repo_prompt(repository: dict | None) -> str:
    if not repository:
        return SYSTEM_PROMPT
    full_name = repository.get("fullName") or repository.get("full_name")
    return (
        f"{SYSTEM_PROMPT} You are working inside the cloned GitHub repository {full_name}. "
        "Only read and write files inside the current repository working directory. "
        "Do not use absolute paths outside the repository."
    )


def _use_shared_files_workdir(repository: dict | None = None, session_id: str | None = None) -> str:
    if repository:
        repo_path = setup_repository_workspace(repository, session_id or "agentcore")
        os.chdir(repo_path)
        return str(repo_path)

    mount_path = str(scratch_workspace_path(session_id or "agentcore"))
    try:
        os.chdir(mount_path)
    except FileNotFoundError:
        logger.warning("Shared files mount path does not exist yet: %s", mount_path)
    except PermissionError:
        logger.warning("Cannot use shared files mount path as working directory: %s", mount_path)
    return mount_path


class OpenRouterModel(OpenAIModel):
    """OpenAI-compatible model adapter that omits token-limit request fields."""

    def format_request(self, *args, **kwargs):
        request = super().format_request(*args, **kwargs)
        request.pop("max_tokens", None)
        request.pop("max_completion_tokens", None)
        return request


def _create_session_manager(
    user_id: str, session_id: str
) -> AgentCoreMemorySessionManager:
    """Create an AgentCore memory session manager, optionally with long-term semantic retrieval.

    When the USE_LONG_TERM_MEMORY environment variable is "true", configures retrieval
    from the /facts/{actorId} namespace so the agent recalls facts across sessions.
    When false (default), only short-term memory (conversation history) is active,
    avoiding the additional storage and retrieval costs of long-term memory.

    Args:
        user_id: Unique identifier for the user (actor), extracted from the JWT sub claim.
        session_id: Unique identifier for the current conversation session.

    Returns:
        An AgentCoreMemorySessionManager bound to the user and session.
    """
    memory_id = os.environ.get("MEMORY_ID")
    if not memory_id:
        raise ValueError("MEMORY_ID environment variable is required")

    use_ltm = os.environ.get("USE_LONG_TERM_MEMORY", "false").lower() == "true"

    top_k = int(os.environ.get("LTM_TOP_K", "10"))
    relevance_score = float(os.environ.get("LTM_RELEVANCE_SCORE", "0.3"))

    # Only pass retrieval_config when LTM is explicitly enabled.
    # Omitting it means the session manager uses short-term memory only,
    # which avoids the $0.50/1,000 retrieval and $0.75/1,000 storage costs.
    retrieval_config = (
        {
            "/facts/{actorId}": RetrievalConfig(
                top_k=top_k,
                relevance_score=relevance_score,
            )
        }
        if use_ltm
        else None
    )

    config = AgentCoreMemoryConfig(
        memory_id=memory_id,
        session_id=session_id,
        actor_id=user_id,
        retrieval_config=retrieval_config,
    )
    return AgentCoreMemorySessionManager(
        agentcore_memory_config=config,
        region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
    )


def create_strands_agent(user_id: str, session_id: str, repository: dict | None = None) -> Agent:
    """Create a Strands agent with Gateway tools, memory, and Code Interpreter."""

    _use_shared_files_workdir(repository, session_id)

    # Get OpenAI credentials from AgentCore Identity
    openai_creds = get_openai_credentials()

    # Create OpenAI client with custom base_url and api_key
    openai_client = AsyncOpenAI(
        api_key=openai_creds["api_key"],
        base_url=openai_creds["base_url"],
    )

    # Create OpenAI model with the custom client and model_id from credentials
    openai_model = OpenRouterModel(
        client=openai_client,
        model_id=openai_creds["model_id"],
        params={"temperature": 0.1},
    )

    session_manager = _create_session_manager(user_id, session_id)

    region = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
    code_tools = StrandsCodeInterpreterTools(region)

    gateway_client = create_gateway_mcp_client()

    return Agent(
        name="strands_agent",
        system_prompt=_repo_prompt(repository),
        tools=[
            gateway_client,
            code_tools.execute_python_securely,
            file_read,
            file_write,
        ],
        model=openai_model,
        session_manager=session_manager,
        trace_attributes={"user.id": user_id, "session.id": session_id},
    )


@app.entrypoint
async def invocations(payload, context: RequestContext):
    """Main entrypoint — called by AgentCore Runtime on each request.

    Extracts user ID from the validated JWT token (not the payload body)
    to prevent impersonation via prompt injection.
    """
    user_query = payload.get("prompt")
    session_id = payload.get("runtimeSessionId")
    repository = payload.get("repository")

    if not all([user_query, session_id]):
        yield {
            "status": "error",
            "error": "Missing required fields: prompt or runtimeSessionId",
        }
        return

    try:
        user_id = extract_user_id_from_context(context)
        github_action = payload.get("githubAction")
        if github_action == "listInstalledRepositories":
            yield {"status": "ok", **list_installed_repositories()}
            return
        if github_action == "previewPullRequest":
            if not repository:
                yield {"status": "error", "error": "repository is required"}
                return
            yield {"status": "ok", "preview": preview_pull_request(repository, session_id)}
            return
        if github_action == "getFileDiff":
            if not repository:
                yield {"status": "error", "error": "repository is required"}
                return
            file_path = str(payload.get("filePath") or "").strip()
            if not file_path:
                yield {"status": "error", "error": "filePath is required"}
                return
            yield {"status": "ok", "fileDiff": get_file_diff(repository, session_id, file_path)}
            return
        if github_action == "createPullRequest":
            if not repository:
                yield {"status": "error", "error": "repository is required"}
                return
            pr_info = payload.get("pullRequest") or {}
            yield {
                "status": "ok",
                "pullRequest": create_pull_request(
                    repository,
                    session_id,
                    pr_info.get("title") or "AgentCore changes",
                    pr_info.get("body") or "Created by AgentCore.",
                ),
            }
            return
        if github_action == "listPullRequests":
            if not repository:
                yield {"status": "error", "error": "repository is required"}
                return
            yield {
                "status": "ok",
                "pullRequests": list_pull_requests(repository, payload.get("pullRequestState") or "open"),
            }
            return

        if payload.get("filesystemSmokeTest") is True:
            mount_path = os.environ.get("SHARED_FILES_MOUNT_PATH", "/mnt/s3")
            readme_path = os.path.join(mount_path, "README.md")
            with open(readme_path, "r", encoding="utf-8") as readme:
                content = readme.read()
            yield {
                "status": "ok",
                "userId": user_id,
                "mountPath": mount_path,
                "readme": content,
            }
            return

        if payload.get("filesystemDiagnostic") is True:
            mount_path = os.environ.get("SHARED_FILES_MOUNT_PATH", "/mnt/s3")
            paths = ["/mnt", mount_path]
            diagnostics = []
            for path in paths:
                try:
                    item_stat = os.stat(path)
                    diagnostics.append(
                        {
                            "path": path,
                            "exists": True,
                            "mode": stat.filemode(item_stat.st_mode),
                            "uid": item_stat.st_uid,
                            "gid": item_stat.st_gid,
                            "writable": os.access(path, os.W_OK),
                            "executable": os.access(path, os.X_OK),
                        }
                    )
                except Exception as exc:
                    diagnostics.append({"path": path, "exists": False, "error": str(exc)})

            write_tests = []
            for path in [mount_path, os.path.join(mount_path, "repos")]:
                try:
                    os.makedirs(path, exist_ok=True)
                    probe_path = os.path.join(path, ".agentcore-write-probe")
                    with open(probe_path, "w", encoding="utf-8") as probe:
                        probe.write("ok")
                    os.remove(probe_path)
                    write_tests.append({"path": path, "ok": True})
                except Exception as exc:
                    write_tests.append({"path": path, "ok": False, "error": str(exc)})

            yield {
                "status": "ok",
                "uid": os.getuid(),
                "gid": os.getgid(),
                "cwd": os.getcwd(),
                "mountPath": mount_path,
                "paths": diagnostics,
                "writeTests": write_tests,
            }
            return

        agent = create_strands_agent(user_id, session_id, repository)

        async for event in agent.stream_async(user_query):
            yield json.loads(json.dumps(dict(event), default=str))

    except Exception as e:
        logger.exception("Agent run failed")
        yield {"status": "error", "error": str(e)}


if __name__ == "__main__":
    app.run()
