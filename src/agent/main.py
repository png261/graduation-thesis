"""Strands agent with Gateway MCP tools and Memory."""

import base64
from datetime import datetime, timezone
import json
import logging
import mimetypes
import os
import re
import stat
from pathlib import Path

os.environ.setdefault("MPLCONFIGDIR", "/tmp/matplotlib")
os.environ.setdefault("XDG_CACHE_HOME", "/tmp/.cache")

from bedrock_agentcore.memory.integrations.strands.config import (
    AgentCoreMemoryConfig,
    RetrievalConfig,
)
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from strands import Agent, ToolContext, tool
from strands.models import OpenAIModel
from openai import AsyncOpenAI
from strands_tools import file_read, file_write
from strands_tools.swarm import swarm as strands_swarm
from agents.artifacts import session_artifact_dir
from agents.iac_tools import (
    checkov_scan,
    infracost_breakdown,
    terraform_init,
    terraform_plan,
    terraform_validate,
    tflint_scan,
)
from agents.orchestator.agent import create_agent as create_orchestrator_agent
from agents.orchestator.system_prompt import CHAT_AGENTS, LEGACY_AGENT_MENTIONS
from agents.orchestator.tools.gateway import create_gateway_mcp_client
from agents.orchestator.tools.opentofu_mcp import create_opentofu_mcp_client
from agents.orchestator.tools.safe_diagram import diagram as safe_diagram
from agents.runtime import AgentRuntimeTools
from utils.auth import extract_user_id_from_context, get_openai_credentials
from utils.github_app import (
    create_pull_request as create_github_pull_request,
    generate_terraform_plan_graph,
    get_file_diff,
    list_installed_repositories,
    list_pull_requests,
    preview_pull_request,
    scratch_workspace_path,
    shared_files_base_path,
    setup_repository_workspace,
    workspace_path,
)

logger = logging.getLogger(__name__)

app = BedrockAgentCoreApp()
MAX_FILE_PREVIEW_BYTES = int(os.environ.get("MAX_FILE_PREVIEW_BYTES", str(1024 * 1024)))


def _public_agent(agent: dict) -> dict:
    return {key: agent[key] for key in ["id", "mention", "name", "avatar", "className"]}


def _select_chat_agent(payload_agent: dict | None, prompt: str) -> dict:
    if isinstance(payload_agent, dict):
        agent_id = str(payload_agent.get("id") or "").strip()
        if agent_id in CHAT_AGENTS:
            return CHAT_AGENTS[agent_id]

    for agent in CHAT_AGENTS.values():
        if re.search(rf"(^|\s){re.escape(agent['mention'])}(?=\s|$)", prompt or ""):
            return agent

    for mention, agent_id in LEGACY_AGENT_MENTIONS.items():
        if re.search(rf"(^|\s){re.escape(mention)}(?=\s|$)", prompt or ""):
            return CHAT_AGENTS[agent_id]

    return CHAT_AGENTS["agent1"]


def _session_title_from_agent_response(response_text: str) -> str:
    text = re.sub(r"`([^`]+)`", r"\1", response_text or "")
    text = re.sub(r"[*_#>\[\]()]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return ""

    sentences = re.split(r"(?<=[.!?])\s+", text)
    for sentence in sentences:
        candidate = sentence.strip(" -:")
        if len(candidate) < 6:
            continue
        candidate = re.sub(r"^(I('| a)m|I have|I've|The file|This chat)\s+", "", candidate, flags=re.I)
        candidate = candidate.strip(" -:")
        if not candidate:
            continue
        if len(candidate) > 56:
            candidate = candidate[:56].rsplit(" ", 1)[0]
        return candidate[:56] or ""
    return text[:56].rsplit(" ", 1)[0] or text[:56]


def _pull_request_metadata_from_agent_response(response_text: str) -> tuple[str, str]:
    text = (response_text or "").replace("\r\n", "\n").strip()
    title_match = re.search(r"(?im)^\s*(?:#+\s*)?(?:PR\s*)?Title\s*:\s*(.+?)\s*$", text)
    body_match = re.search(
        r"(?ims)^\s*(?:#+\s*)?(?:PR\s*)?Body\s*:\s*(.+?)(?=^\s*(?:#+\s*)?(?:PR\s*)?Title\s*:|\Z)",
        text,
    )

    title = title_match.group(1).strip(" `*_#") if title_match else ""
    body = body_match.group(1).strip() if body_match else ""

    if not title:
        lowered = text.lower()
        if "terraform" in lowered and "drift" in lowered and "policy" in lowered:
            title = "Fix Terraform drift and policy findings"
        elif "terraform" in lowered and "drift" in lowered:
            title = "Fix Terraform drift findings"
        elif "policy" in lowered:
            title = "Fix policy compliance findings"
        else:
            title = _session_title_from_agent_response(text) or "AgentCore repository update"

    if len(title) > 72:
        title = title[:72].rsplit(" ", 1)[0] or title[:72]

    if not body:
        body = text or "Created by AgentCore from this chat session."

    return title, body


def _create_pull_request_tool(repository: dict, session_id: str, results: list[dict]):
    @tool
    def create_pull_request(title: str, body: str) -> str:
        """
        Create or update the GitHub pull request for this chat session.

        Use this after editing repository files. The title and body must summarize
        the actual Terraform/code changes made in this session.

        Args:
            title: Concise pull request title, under 72 characters.
            body: Markdown pull request body summarizing changed files and fixes.

        Returns:
            JSON string with pull request number, URL, branch, changed files, and status.
        """
        pr_title = (title or "AgentCore repository update").strip()
        pr_body = (body or "Created by AgentCore from this chat session.").strip()
        result = create_github_pull_request(repository, session_id, pr_title, pr_body)
        results.append(result)
        return json.dumps(result)

    return create_pull_request


def _normalize_handoff_questions(raw_questions: str | list | dict) -> list[dict]:
    if isinstance(raw_questions, str):
        try:
            parsed = json.loads(raw_questions)
        except json.JSONDecodeError:
            parsed = [{"question": raw_questions}]
    else:
        parsed = raw_questions

    if isinstance(parsed, dict):
        parsed_questions = parsed.get("questions") or [parsed]
    elif isinstance(parsed, list):
        parsed_questions = parsed
    else:
        parsed_questions = []

    questions: list[dict] = []
    for index, item in enumerate(parsed_questions[:5], start=1):
        if not isinstance(item, dict):
            item = {"question": str(item)}
        question = str(item.get("question") or item.get("prompt") or "").strip()
        if not question:
            continue
        raw_options = item.get("options")
        if not isinstance(raw_options, list):
            raw_options = []
        options = [str(option).strip() for option in raw_options if str(option).strip()]
        while len(options) < 3:
            defaults = ["Use the safest default", "Use the lowest-cost option", "Let me specify manually"]
            options.append(defaults[len(options)])
        questions.append(
            {
                "id": str(item.get("id") or f"q{index}"),
                "question": question,
                "options": options[:3],
            }
        )

    if not questions:
        questions.append(
            {
                "id": "q1",
                "question": "Please clarify the requirement before I continue.",
                "options": ["Use the safest default", "Use the lowest-cost option", "Let me specify manually"],
            }
        )

    return questions


def _create_handoff_to_user_tool(results: list[dict]):
    @tool(context=True)
    def handoff_to_user(questions: str, tool_context: ToolContext) -> str:
        """
        Ask the user for missing information before continuing.

        Use this when a decision is blocking and guessing could produce the wrong
        implementation. Pass questions as JSON, either:
        {"questions":[{"question":"...","options":["A","B","C"]}]}
        or a list of objects with question and exactly three options.

        Args:
            questions: JSON string containing one or more clarification questions.

        Returns:
            JSON string with the structured user handoff request.
        """
        handoff = {
            "type": "user_handoff",
            "questions": _normalize_handoff_questions(questions),
        }
        results.append(handoff)
        tool_context.agent.state.set("pending_user_handoff", handoff)
        tool_context.invocation_state["stop_event_loop"] = True
        return json.dumps(handoff)

    return handoff_to_user


def _use_shared_files_workdir(repository: dict | None = None, session_id: str | None = None) -> str:
    safe_session_id = session_id or "agentcore"
    os.environ["SHARED_FILES_SESSION_ID"] = safe_session_id
    if repository:
        repo_path = setup_repository_workspace(repository, safe_session_id)
        os.chdir(repo_path)
        return str(repo_path)

    workspace_path = str(scratch_workspace_path(safe_session_id))
    try:
        os.chdir(workspace_path)
    except FileNotFoundError:
        logger.warning("Shared files workspace path does not exist yet: %s", workspace_path)
    except PermissionError:
        logger.warning("Cannot use shared files workspace path as working directory: %s", workspace_path)
    return workspace_path


def _runtime_filesystem_root(repository: dict | None, session_id: str) -> Path:
    if repository:
        return workspace_path(repository, session_id)
    return scratch_workspace_path(session_id)


def _safe_runtime_path(root: Path, relative_path: str | None = None) -> Path:
    raw_path = (relative_path or "").strip()
    if raw_path.startswith("/"):
        raise ValueError("absolute paths are not allowed")
    candidate = (root / raw_path).resolve()
    resolved_root = root.resolve()
    try:
        candidate.relative_to(resolved_root)
    except ValueError as exc:
        raise ValueError("path escapes runtime filesystem root") from exc
    return candidate


def _iso_mtime(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat().replace("+00:00", "Z")


def _list_runtime_files(repository: dict | None, session_id: str, prefix: str = "") -> list[dict]:
    root = _runtime_filesystem_root(repository, session_id)
    if not root.exists():
        return []

    start = _safe_runtime_path(root, prefix)
    if not start.exists():
        return []

    candidates = [start] if start.is_file() else start.rglob("*")
    entries: list[dict] = []
    for path in candidates:
        if not path.is_file():
            continue
        relative_parts = path.relative_to(root).parts
        if ".git" in relative_parts:
            continue
        entries.append(
            {
                "key": path.relative_to(root).as_posix(),
                "size": path.stat().st_size,
                "lastModified": _iso_mtime(path),
                "eTag": None,
            }
        )
        if len(entries) >= 1000:
            break

    return sorted(entries, key=lambda item: item["key"])


def _get_runtime_file_content(repository: dict | None, session_id: str, key: str) -> dict:
    root = _runtime_filesystem_root(repository, session_id)
    path = _safe_runtime_path(root, key)
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(key)

    size = path.stat().st_size
    raw = path.read_bytes()[:MAX_FILE_PREVIEW_BYTES]
    content_type = mimetypes.guess_type(path.name)[0]
    try:
        content = raw.decode("utf-8")
        encoding = "utf-8"
        if size > MAX_FILE_PREVIEW_BYTES:
            content += f"\n\n[Preview truncated to {MAX_FILE_PREVIEW_BYTES} bytes of {size} bytes]"
    except UnicodeDecodeError:
        content = base64.b64encode(raw).decode("ascii")
        encoding = "base64"

    return {
        "key": path.relative_to(root).as_posix(),
        "content": content,
        "contentType": content_type,
        "encoding": encoding,
        "size": size,
        "lastModified": _iso_mtime(path),
    }


def _safe_attachment_name(name: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", os.path.basename(name or "").strip())
    cleaned = cleaned.strip("._")
    return cleaned[:120] or fallback


def _attachment_image_format(content_type: str, filename: str) -> str | None:
    lowered_type = content_type.lower().split(";", 1)[0].strip()
    if lowered_type in {"image/png", "image/gif", "image/webp"}:
        return lowered_type.rsplit("/", 1)[1]
    if lowered_type in {"image/jpeg", "image/jpg"}:
        return "jpeg"

    extension = os.path.splitext(filename.lower())[1].lstrip(".")
    if extension in {"png", "gif", "webp"}:
        return extension
    if extension in {"jpg", "jpeg"}:
        return "jpeg"
    return None


def _save_prompt_attachments(attachments: list | None, session_id: str) -> list[dict]:
    if not isinstance(attachments, list):
        return []

    saved = []
    attachment_dir = session_artifact_dir(session_id, "attachments", shared_files_base_path())

    for index, attachment in enumerate(attachments[:6], start=1):
        if not isinstance(attachment, dict):
            continue
        data_url = str(attachment.get("dataUrl") or "")
        if "," in data_url:
            _, encoded = data_url.split(",", 1)
        else:
            encoded = data_url
        try:
            content = base64.b64decode(encoded, validate=True)
        except Exception:
            logger.warning("Skipping invalid attachment payload at index %s", index)
            continue
        if len(content) > 4 * 1024 * 1024:
            logger.warning("Skipping oversized attachment at index %s", index)
            continue

        filename = _safe_attachment_name(str(attachment.get("name") or ""), f"attachment-{index}")
        path = attachment_dir / filename
        stem, ext = os.path.splitext(filename)
        suffix = 1
        while path.exists():
            path = attachment_dir / f"{stem}-{suffix}{ext}"
            suffix += 1

        path.write_bytes(content)

        saved.append(
            {
                "name": filename,
                "path": str(path),
                "type": str(attachment.get("type") or "application/octet-stream"),
                "size": len(content),
                "content": content,
            }
        )

    return saved


def _augment_prompt_with_attachments(prompt: str, attachments: list[dict]) -> str:
    if not attachments:
        return prompt

    lines = [
        prompt,
        "",
        "The user attached the following file(s). They have been saved outside the repository in session artifact storage:",
    ]
    image_count = 0
    for item in attachments:
        image_format = _attachment_image_format(item["type"], item["name"])
        if image_format:
            image_count += 1
        lines.append(f"- {item['name']} ({item['type']}, {item['size']} bytes): {item['path']}")
    lines.append("Use file_read for text attachments when useful.")
    lines.append("Do not copy attachment files into the connected repository unless the user explicitly asks for that exact file to be added.")
    if image_count:
        lines.append(
            "The image attachment content is included directly in this model message. "
            "Do not use file_read on image files to understand their visual content; inspect the attached image content directly."
        )
    return "\n".join(lines)


def _prompt_with_attachment_content_blocks(prompt: str, attachments: list[dict]) -> str | list[dict]:
    if not attachments:
        return prompt

    content_blocks: list[dict] = [{"text": _augment_prompt_with_attachments(prompt, attachments)}]
    for item in attachments:
        image_format = _attachment_image_format(item["type"], item["name"])
        if not image_format:
            continue
        content_blocks.append(
            {
                "image": {
                    "format": image_format,
                    "source": {"bytes": item["content"]},
                }
            }
        )

    return content_blocks


def _json_safe_context(value):
    if isinstance(value, bytes):
        return {"__bytes_base64__": base64.b64encode(value).decode("ascii")}
    if isinstance(value, list):
        return [_json_safe_context(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_safe_context(item) for key, item in value.items()}
    return value


def _empty_agent_response_message(saved_attachments: list[dict]) -> str:
    if any(_attachment_image_format(item["type"], item["name"]) for item in saved_attachments):
        return (
            "The pasted image was received, but the configured model returned an empty response. "
            "Try again with a vision-capable model if you need image analysis."
        )
    return "The configured model returned an empty response."


def _compact_stream_event(event: dict) -> dict | None:
    """Reduce Strands stream events to the frontend SSE contract.

    Raw Strands events can include full message history, tool config, system prompts,
    model objects, and trace objects on every streamed token. Forwarding those large
    payloads over AgentCore's HTTP/2 stream can break long chats. Keep only the
    fields consumed by the frontend parser.
    """
    if isinstance(event.get("data"), str):
        return {"data": event["data"]}

    if event.get("current_tool_use"):
        compact: dict = {
            "current_tool_use": _compact_tool_use(event["current_tool_use"]),
        }
        delta = _compact_tool_delta(event.get("delta"))
        if delta:
            compact["delta"] = delta
        return compact

    if event.get("type") == "tool_stream":
        return _compact_tool_stream_event(event)

    if event.get("message"):
        message = _compact_message(event["message"])
        if message:
            return {"message": message}
        return None

    if event.get("result") is not None:
        result = event["result"]
        stop_reason = getattr(result, "stop_reason", None)
        if isinstance(result, dict):
            stop_reason = result.get("stop_reason") or result.get("stopReason")
        return {"result": {"stop_reason": stop_reason or "end_turn"}}

    if event.get("init_event_loop"):
        return {"init_event_loop": True}
    if event.get("start_event_loop"):
        return {"start_event_loop": True}
    if event.get("start"):
        return {"start": True}
    if event.get("force_stop"):
        return {
            "force_stop": True,
            "force_stop_reason": str(event.get("force_stop_reason", "")),
        }
    if event.get("status") == "error":
        return {"status": "error", "error": str(event.get("error", ""))}

    return None


def _compact_tool_use(tool_use: dict) -> dict:
    return {
        "toolUseId": tool_use.get("toolUseId"),
        "name": tool_use.get("name"),
        "input": tool_use.get("input", ""),
    }


def _compact_tool_delta(delta: dict | None) -> dict | None:
    if not isinstance(delta, dict):
        return None
    tool_input = ((delta.get("toolUse") or {}).get("input"))
    if not isinstance(tool_input, str):
        return None
    return {"toolUse": {"input": tool_input}}


def _compact_tool_stream_event(event: dict) -> dict | None:
    stream_event = event.get("tool_stream_event")
    if not isinstance(stream_event, dict):
        return None
    tool_use = stream_event.get("tool_use")
    data = stream_event.get("data")
    if not isinstance(tool_use, dict) or not isinstance(data, dict):
        return None
    progress = data.get("specialistToolProgress")
    if not isinstance(progress, dict):
        return None
    return {
        "type": "tool_stream",
        "tool_stream_event": {
            "tool_use": _compact_tool_use(tool_use),
            "data": {
                "specialistToolProgress": {
                    "phase": str(progress.get("phase", "")),
                    "message": str(progress.get("message", "")),
                }
            },
        },
    }


def _compact_message(message: dict) -> dict | None:
    role = message.get("role")
    content = message.get("content")
    if role not in {"assistant", "user"} or not isinstance(content, list):
        return None

    compact_content = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if "toolUse" in block and isinstance(block["toolUse"], dict):
            compact_content.append({"toolUse": _compact_tool_use(block["toolUse"])})
        elif "toolResult" in block and isinstance(block["toolResult"], dict):
            compact_content.append({"toolResult": _compact_tool_result(block["toolResult"])})

    if role == "assistant":
        return {"role": role, "content": compact_content}
    if compact_content:
        return {"role": role, "content": compact_content}
    return None


def _compact_tool_result(tool_result: dict) -> dict:
    content = []
    for item in tool_result.get("content", []):
        if not isinstance(item, dict):
            continue
        if "text" in item:
            content.append({"text": str(item["text"])})
        elif "json" in item:
            content.append({"text": json.dumps(item["json"], default=str)})
    return {
        "toolUseId": tool_result.get("toolUseId"),
        "status": tool_result.get("status", "success"),
        "content": content,
    }


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


def create_strands_agent(
    user_id: str,
    session_id: str,
    repository: dict | None = None,
    chat_agent: dict | None = None,
    state_backend: dict | None = None,
    pull_request_results: list[dict] | None = None,
    handoff_results: list[dict] | None = None,
) -> Agent:
    """Create a Strands agent with Gateway tools and memory."""

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

    create_pull_request_tool = None
    if repository is not None and pull_request_results is not None:
        create_pull_request_tool = _create_pull_request_tool(repository, session_id, pull_request_results)

    runtime_tools = AgentRuntimeTools(
        gateway=create_gateway_mcp_client(),
        opentofu=create_opentofu_mcp_client(),
        handoff_to_user=_create_handoff_to_user_tool(handoff_results if handoff_results is not None else []),
        file_read=file_read,
        file_write=file_write,
        terraform_init=terraform_init,
        terraform_plan=terraform_plan,
        terraform_validate=terraform_validate,
        tflint_scan=tflint_scan,
        infracost_breakdown=infracost_breakdown,
        checkov_scan=checkov_scan,
        diagram=safe_diagram,
        swarm=strands_swarm,
        create_pull_request=create_pull_request_tool,
    )

    return create_orchestrator_agent(
        model=openai_model,
        repository=repository,
        chat_agent=chat_agent,
        state_backend=state_backend,
        runtime_tools=runtime_tools,
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
    state_backend = payload.get("stateBackend")

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
        if github_action == "setupRepositoryWorkspace":
            if not repository:
                yield {"status": "error", "error": "repository is required"}
                return
            repo_path = setup_repository_workspace(repository, session_id)
            yield {"status": "ok", "workspace": {"path": str(repo_path)}}
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
        if github_action == "generateTerraformGraph":
            if not repository:
                yield {"status": "error", "error": "repository is required"}
                return
            terraform_path = str(payload.get("terraformPath") or ".").strip() or "."
            yield {
                "status": "ok",
                "terraformGraph": generate_terraform_plan_graph(
                    repository,
                    session_id,
                    terraform_path,
                    state_backend,
                ),
            }
            return

        filesystem_action = payload.get("filesystemAction")
        if filesystem_action == "listFiles":
            prefix = str(payload.get("prefix") or "").strip()
            yield {"status": "ok", "files": _list_runtime_files(repository, session_id, prefix)}
            return
        if filesystem_action == "getFileContent":
            file_key = str(payload.get("fileKey") or payload.get("key") or "").strip()
            if not file_key:
                yield {"status": "error", "error": "fileKey is required"}
                return
            try:
                yield {"status": "ok", "file": _get_runtime_file_content(repository, session_id, file_key)}
            except FileNotFoundError:
                yield {"status": "error", "error": f"file not found: {file_key}"}
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
            base_path = shared_files_base_path()
            readme_path = base_path / "README.md"
            if not readme_path.exists():
                readme_path.write_text("AgentCore runtime filesystem initialized", encoding="utf-8")
            yield {
                "status": "ok",
                "userId": user_id,
                "mountPath": os.environ.get("SHARED_FILES_MOUNT_PATH", "/tmp/agentcore-runtime-files"),
                "activePath": str(base_path),
                "readme": readme_path.read_text(encoding="utf-8"),
            }
            return

        if payload.get("filesystemDiagnostic") is True:
            mount_path = os.environ.get("SHARED_FILES_MOUNT_PATH", "/tmp/agentcore-runtime-files")
            active_path = ""
            try:
                active_path = str(shared_files_base_path())
            except Exception as exc:
                active_path = f"unavailable: {exc}"
            paths = [mount_path, os.environ.get("SHARED_FILES_FALLBACK_PATH", "/tmp/agentcore-runtime-files")]
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
            for path in [
                mount_path,
                os.path.join(mount_path, "repos"),
                os.environ.get("SHARED_FILES_FALLBACK_PATH", "/tmp/agentcore-runtime-files"),
            ]:
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
                "activePath": active_path,
                "paths": diagnostics,
                "writeTests": write_tests,
            }
            return

        chat_agent = _select_chat_agent(payload.get("agent"), user_query)
        yield {"chatAgent": _public_agent(chat_agent)}

        pull_request_results: list[dict] = []
        handoff_results: list[dict] = []
        agent = create_strands_agent(
            user_id,
            session_id,
            repository,
            chat_agent,
            state_backend,
            pull_request_results,
            handoff_results,
        )
        saved_attachments = _save_prompt_attachments(payload.get("attachments"), session_id)
        agent_query = _prompt_with_attachment_content_blocks(user_query, saved_attachments)
        agent.state.set("original_user_prompt", user_query)
        agent.state.set("original_user_context", _json_safe_context(agent_query))

        assistant_chunks = []
        async for event in agent.stream_async(agent_query):
            event_dict = dict(event)
            if isinstance(event_dict.get("data"), str):
                assistant_chunks.append(event_dict["data"])
            compact_event = _compact_stream_event(event_dict)
            if compact_event is not None:
                yield compact_event

        if not "".join(assistant_chunks).strip() and not handoff_results:
            fallback_message = _empty_agent_response_message(saved_attachments)
            assistant_chunks.append(fallback_message)
            yield {"data": fallback_message}

        session_title = _session_title_from_agent_response("".join(assistant_chunks))
        if session_title:
            yield {"sessionTitle": session_title}

        if pull_request_results:
            yield {"pullRequest": pull_request_results[-1]}

        if handoff_results:
            yield {"userHandoff": handoff_results[-1]}

    except Exception as e:
        logger.exception("Agent run failed")
        yield {"status": "error", "error": str(e)}


if __name__ == "__main__":
    app.run()
