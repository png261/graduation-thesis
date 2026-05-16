import asyncio
import base64
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
import zipfile
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _install_module(name: str, **attrs):
    module = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(module, key, value)
    sys.modules[name] = module
    return module


class FakeBedrockAgentCoreApp:
    def entrypoint(self, fn):
        return fn

    def run(self):
        return None


class FakeOpenAIModel:
    def __init__(self, *args, **kwargs):
        pass

    def format_request(self, *args, **kwargs):
        return {}


def fake_tool(*args, **kwargs):
    if args and callable(args[0]):
        return args[0]

    def decorator(fn):
        fn.__wrapped__ = fn
        return fn

    return decorator


_install_module("bedrock_agentcore")
_install_module("bedrock_agentcore.memory")
_install_module("bedrock_agentcore.memory.integrations")
_install_module("bedrock_agentcore.memory.integrations.strands")
_install_module(
    "bedrock_agentcore.memory.integrations.strands.config",
    AgentCoreMemoryConfig=object,
    RetrievalConfig=lambda **kwargs: kwargs,
)
_install_module(
    "bedrock_agentcore.memory.integrations.strands.session_manager",
    AgentCoreMemorySessionManager=object,
)
_install_module(
    "bedrock_agentcore.runtime",
    BedrockAgentCoreApp=FakeBedrockAgentCoreApp,
    RequestContext=object,
)
_install_module("strands", Agent=object, AgentSkills=object, ToolContext=object, tool=fake_tool)
_install_module("strands.models", OpenAIModel=FakeOpenAIModel)
_install_module("openai", AsyncOpenAI=object)
_install_module("strands_tools", file_read=object(), file_write=object())
_install_module("strands_tools.swarm", swarm=object())
_install_module("agents.artifacts", session_artifact_dir=lambda *args, **kwargs: None)
_install_module(
    "agents.iac_tools",
    checkov_scan=object(),
    infracost_breakdown=object(),
    terraform_init=object(),
    terraform_plan=object(),
    terraform_validate=object(),
    ministack_terratest=object(),
    tflint_scan=object(),
)
_install_module("agents.orchestator", __path__=[])
_install_module("agents.orchestator.agent", create_agent=lambda **kwargs: kwargs)
_install_module("agents.orchestator.tools", __path__=[])
_install_module("agents.orchestator.tools.gateway", create_gateway_mcp_client=lambda: object())
_install_module("agents.orchestator.tools.opentofu_mcp", create_opentofu_mcp_client=lambda: object())
_install_module("agents.orchestator.tools.safe_diagram", diagram=object())
_install_module(
    "utils.auth",
    extract_user_id_from_context=lambda _context: "user-1",
    get_openai_credentials=lambda: {"api_key": "key", "base_url": "https://example.com", "model_id": "model"},
)
_install_module(
    "utils.github_app",
    create_pull_request=lambda *args, **kwargs: {},
    generate_terraform_plan_graph=lambda *args, **kwargs: {},
    get_file_diff=lambda *args, **kwargs: {},
    list_installed_repositories=lambda *args, **kwargs: {},
    list_pull_requests=lambda *args, **kwargs: {},
    preview_pull_request=lambda *args, **kwargs: {},
    scratch_workspace_path=lambda _session_id: None,
    shared_files_base_path=lambda: None,
    setup_repository_workspace=lambda *_args, **_kwargs: None,
    workspace_path=lambda *_args, **_kwargs: None,
)

import main as agent_main


class FakeAgent:
    def __init__(self, fail: bool = False):
        self.fail = fail
        self.state = SimpleNamespace(set=lambda _key, _value: None)

    async def stream_async(self, _query):
        if self.fail:
            raise RuntimeError("stream failed")
        yield {"data": "ok"}


class FakeSessionManager:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


class FakeSnapshot:
    def __init__(self, kwargs):
        self.kwargs = kwargs

    def to_dict(self):
        return {
            "schema_version": "1.0",
            "data": {"messages": [], "state": {}},
            "app_data": self.kwargs.get("app_data", {}),
        }


class FakeCheckpointAgent:
    def __init__(self):
        self.take_snapshot_calls = []
        self.loaded_snapshot = None

    def take_snapshot(self, **kwargs):
        self.take_snapshot_calls.append(kwargs)
        return FakeSnapshot(kwargs)

    def load_snapshot(self, snapshot):
        self.loaded_snapshot = snapshot


class AgentCoreMemoryLifecycleTests(unittest.TestCase):
    def test_memory_batch_size_is_configurable(self):
        captured = {}

        class FakeConfig:
            def __init__(self, **kwargs):
                captured.update(kwargs)

        with patch.dict(
            os.environ,
            {
                "MEMORY_ID": "mem-123",
                "MEMORY_BATCH_SIZE": "25",
            },
            clear=False,
        ), patch.object(agent_main, "AgentCoreMemoryConfig", FakeConfig), patch.object(
            agent_main,
            "AgentCoreMemorySessionManager",
            lambda agentcore_memory_config, region_name: {
                "config": agentcore_memory_config,
                "region": region_name,
            },
        ):
            agent_main._create_session_manager("user-1", "session-1")

        self.assertEqual(captured["batch_size"], 25)

    def test_invalid_memory_batch_size_falls_back_to_default(self):
        with patch.dict(os.environ, {"MEMORY_BATCH_SIZE": "invalid"}, clear=False):
            self.assertEqual(agent_main._memory_batch_size(), 10)

    def test_invocation_closes_memory_session_manager_after_streaming(self):
        session_manager = FakeSessionManager()

        async def collect():
            with patch.object(agent_main, "extract_user_id_from_context", return_value="user-1"), patch.object(
                agent_main,
                "_create_session_manager",
                return_value=session_manager,
            ), patch.object(
                agent_main,
                "create_strands_agent",
                return_value=FakeAgent(),
            ):
                events = []
                async for event in agent_main.invocations(
                    {"prompt": "hello", "runtimeSessionId": "session-123"},
                    object(),
                ):
                    events.append(event)
                return events

        events = asyncio.run(collect())

        self.assertTrue(session_manager.closed)
        self.assertIn({"data": "ok"}, events)

    def test_invocation_closes_memory_session_manager_when_stream_fails(self):
        session_manager = FakeSessionManager()

        async def collect():
            with patch.object(agent_main, "extract_user_id_from_context", return_value="user-1"), patch.object(
                agent_main,
                "_create_session_manager",
                return_value=session_manager,
            ), patch.object(
                agent_main,
                "create_strands_agent",
                return_value=FakeAgent(fail=True),
            ):
                events = []
                async for event in agent_main.invocations(
                    {"prompt": "hello", "runtimeSessionId": "session-123"},
                    object(),
                ):
                    events.append(event)
                return events

        events = asyncio.run(collect())

        self.assertTrue(session_manager.closed)
        self.assertEqual(events[-1]["status"], "error")
        self.assertIn("stream failed", events[-1]["error"])

    def test_save_agent_checkpoint_persists_snapshot_json(self):
        agent = FakeCheckpointAgent()
        with tempfile.TemporaryDirectory() as tmp:
            base_path = Path(tmp)

            def fake_session_artifact_dir(session_id, category, base):
                path = base / "sessions" / session_id / category
                path.mkdir(parents=True, exist_ok=True)
                return path

            with patch.object(agent_main, "shared_files_base_path", return_value=base_path), patch.object(
                agent_main,
                "session_artifact_dir",
                side_effect=fake_session_artifact_dir,
            ):
                path = agent_main._save_agent_checkpoint(
                    agent,
                    "session-123",
                    user_id="user-1",
                    label="after_invocation",
                )
                saved = Path(path).read_text(encoding="utf-8") if path else ""

        self.assertIsNotNone(path)
        self.assertIn('"checkpoint_label": "after_invocation"', saved)
        self.assertEqual(agent.take_snapshot_calls[0]["preset"], "session")
        self.assertIn("system_prompt", agent.take_snapshot_calls[0]["include"])
        self.assertEqual(agent.take_snapshot_calls[0]["app_data"]["checkpoint_label"], "after_invocation")

    def test_load_agent_checkpoint_restores_snapshot(self):
        agent = FakeCheckpointAgent()

        class FakeSnapshotClass:
            @staticmethod
            def from_dict(data):
                return {"restored": data}

        with tempfile.TemporaryDirectory() as tmp:
            base_path = Path(tmp)

            def fake_session_artifact_dir(session_id, category, base):
                path = base / "sessions" / session_id / category
                path.mkdir(parents=True, exist_ok=True)
                return path

            checkpoint_dir = fake_session_artifact_dir("session-123", "checkpoints", base_path)
            (checkpoint_dir / "latest.json").write_text('{"schema_version":"1.0","data":{"messages":[]}}', encoding="utf-8")
            with patch.object(agent_main, "shared_files_base_path", return_value=base_path), patch.object(
                agent_main,
                "session_artifact_dir",
                side_effect=fake_session_artifact_dir,
            ), patch.object(agent_main, "Snapshot", FakeSnapshotClass):
                restored = agent_main._load_agent_checkpoint(agent, "session-123")

        self.assertTrue(restored)
        self.assertEqual(agent.loaded_snapshot["restored"]["schema_version"], "1.0")

    def test_runtime_files_zip_archives_scratch_workspace_without_git_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "main.tf").write_text("resource test", encoding="utf-8")
            (root / ".git").mkdir()
            (root / ".git" / "config").write_text("private", encoding="utf-8")

            with patch.object(agent_main, "scratch_workspace_path", return_value=root):
                archive = agent_main._runtime_files_zip(None, "session-123")

            zip_path = root / "source.zip"
            zip_path.write_bytes(base64.b64decode(archive["content"]))
            with zipfile.ZipFile(zip_path) as zip_file:
                names = zip_file.namelist()

        self.assertEqual(archive["filename"], "session-123-source.zip")
        self.assertEqual(archive["fileCount"], 1)
        self.assertIn("main.tf", names)
        self.assertNotIn(".git/config", names)


if __name__ == "__main__":
    unittest.main()
