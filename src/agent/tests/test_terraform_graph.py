import unittest
import os
import sys
import tempfile
import types
from pathlib import Path
from unittest.mock import patch


def _identity_decorator(*_args, **_kwargs):
    def decorator(function):
        return function

    return decorator


identity_auth = types.ModuleType("bedrock_agentcore.identity.auth")
identity_auth.requires_access_token = _identity_decorator
identity_auth.requires_api_key = _identity_decorator
runtime = types.ModuleType("bedrock_agentcore.runtime")
runtime.RequestContext = object
sys.modules.setdefault("bedrock_agentcore", types.ModuleType("bedrock_agentcore"))
sys.modules.setdefault("bedrock_agentcore.identity", types.ModuleType("bedrock_agentcore.identity"))
sys.modules.setdefault("bedrock_agentcore.identity.auth", identity_auth)
sys.modules.setdefault("bedrock_agentcore.runtime", runtime)

from utils import github_app
from utils.github_app import _parse_rover_graph_js, _plan_change_summary, generate_terraform_plan_graph


class TerraformGraphTests(unittest.TestCase):
    def test_parse_rover_graph_js(self):
        graph = _parse_rover_graph_js(
            'const graph = {"nodes":[{"data":{"id":"aws_s3_bucket.demo"}}],"edges":[]}'
        )

        self.assertEqual(graph["nodes"][0]["data"]["id"], "aws_s3_bucket.demo")

    def test_plan_change_summary_counts_replacements(self):
        summary = _plan_change_summary(
            {
                "resource_changes": [
                    {"change": {"actions": ["create"]}},
                    {"change": {"actions": ["update"]}},
                    {"change": {"actions": ["delete", "create"]}},
                    {"change": {"actions": ["delete"]}},
                    {"change": {"actions": ["no-op"]}},
                ]
            }
        )

        self.assertEqual(summary["create"], 1)
        self.assertEqual(summary["update"], 1)
        self.assertEqual(summary["replace"], 1)
        self.assertEqual(summary["delete"], 1)
        self.assertEqual(summary["no-op"], 1)
        self.assertEqual(summary["total"], 5)

    def test_generate_terraform_plan_graph_uses_plan_json_and_rover(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            repo_path = tmp_path / "repo"
            bin_path = tmp_path / "bin"
            repo_path.mkdir()
            bin_path.mkdir()

            command_log = tmp_path / "commands.log"
            tofu_path = bin_path / "tofu"
            tofu_path.write_text(
                """#!/usr/bin/env python3
import json
import os
import pathlib
import sys

with open(os.environ["GRAPH_TEST_LOG"], "a", encoding="utf-8") as log:
    log.write(" ".join(sys.argv[1:]) + "\\n")
if sys.argv[1] == "init":
    sys.exit(0)
if sys.argv[1] == "plan":
    out_path = pathlib.Path(sys.argv[sys.argv.index("-out") + 1])
    out_path.write_text("plan", encoding="utf-8")
    sys.exit(0)
if sys.argv[1] == "show":
    print(json.dumps({"resource_changes": [{"change": {"actions": ["create"]}}]}))
    sys.exit(0)
sys.exit(2)
""",
                encoding="utf-8",
            )
            tofu_path.chmod(0o755)

            rover_path = bin_path / "rover"
            rover_path.write_text(
                """#!/usr/bin/env python3
import pathlib
import sys
import zipfile

zip_base = pathlib.Path(sys.argv[sys.argv.index("-zipFileName") + 1])
with zipfile.ZipFile(str(zip_base) + ".zip", "w") as archive:
    archive.writestr("graph.js", 'const graph = {"nodes":[{"data":{"id":"aws_s3_bucket.demo"}}],"edges":[]}')
sys.exit(0)
""",
                encoding="utf-8",
            )
            rover_path.chmod(0o755)

            def which(name):
                if name == "tofu":
                    return str(tofu_path)
                if name == "rover":
                    return str(rover_path)
                return None

            with patch.object(github_app, "setup_repository_workspace", return_value=repo_path), patch.object(
                github_app.shutil,
                "which",
                side_effect=which,
            ), patch.dict(
                os.environ,
                {
                    "GRAPH_TEST_LOG": str(command_log),
                    "PATH": f"{bin_path}{os.pathsep}{os.environ.get('PATH', '')}",
                },
            ):
                result = generate_terraform_plan_graph(
                    {"owner": "test", "name": "repo"},
                    "session-1",
                    state_backend={"bucket": "tf-state", "key": "catalog/demo.tfstate", "region": "us-east-1"},
                )
            commands = command_log.read_text(encoding="utf-8").splitlines()

        self.assertEqual(result["tool"], "rover")
        self.assertEqual(result["summary"]["create"], 1)
        self.assertEqual(result["graph"]["nodes"][0]["data"]["id"], "aws_s3_bucket.demo")
        self.assertIn(
            "init -input=false -reconfigure -backend-config=bucket=tf-state -backend-config=key=catalog/demo.tfstate -backend-config=region=us-east-1",
            commands,
        )
        self.assertTrue(any(command.startswith("plan -input=false -no-color -out ") for command in commands))


if __name__ == "__main__":
    unittest.main()
