import json
import unittest
from pathlib import Path
from unittest.mock import patch

from agents.iac_tools import _configure_infracost_api_key, _go_test_args, _ministack_env, _run, _run_ministack_terratest, _workspace_path


class IaCToolSafetyTests(unittest.TestCase):
    def test_workspace_path_rejects_parent_escape(self):
        with self.assertRaises(ValueError):
            _workspace_path("../outside")

    def test_missing_command_reports_not_installed(self):
        result = json.loads(_run(["definitely-not-an-infraq-command"], _workspace_path(".")))

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "not_installed")

    def test_infracost_configure_requires_api_key(self):
        with patch.dict("os.environ", {}, clear=True):
            result = _configure_infracost_api_key(Path.cwd())

        self.assertIsNotNone(result)
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "missing_api_key")

    def test_infracost_configure_redacts_api_key_in_result(self):
        class Completed:
            returncode = 1
            stdout = ""
            stderr = "failed"

        with (
            patch.dict("os.environ", {"INFRACOST_API_KEY": "secret-value"}, clear=True),
            patch("agents.iac_tools.shutil.which", return_value="/usr/local/bin/infracost"),
            patch("agents.iac_tools.subprocess.run", return_value=Completed()) as run,
        ):
            result = _configure_infracost_api_key(Path.cwd())

        self.assertEqual(run.call_args.args[0], ["infracost", "configure", "set", "api_key", "secret-value"])
        self.assertNotIn("secret-value", json.dumps(result))
        self.assertEqual(result["command"], ["infracost", "configure", "set", "api_key", "<redacted>"])

    def test_go_test_args_include_timeout_and_optional_pattern(self):
        self.assertEqual(_go_test_args("", 45), ["go", "test", "./...", "-timeout", "45s"])
        self.assertEqual(
            _go_test_args("TestCriticalPath", 45),
            ["go", "test", "./...", "-timeout", "45s", "-run", "TestCriticalPath"],
        )

    def test_ministack_env_sets_dummy_aws_endpoint_credentials(self):
        with patch.dict("os.environ", {}, clear=True):
            env = _ministack_env("http://127.0.0.1:4566")

        self.assertEqual(env["AWS_ENDPOINT_URL"], "http://127.0.0.1:4566")
        self.assertEqual(env["MINISTACK_ENDPOINT_URL"], "http://127.0.0.1:4566")
        self.assertEqual(env["AWS_ACCESS_KEY_ID"], "test")
        self.assertEqual(env["AWS_SECRET_ACCESS_KEY"], "test")
        self.assertEqual(env["AWS_DEFAULT_REGION"], "us-east-1")
        self.assertEqual(env["TF_INPUT"], "0")

    def test_ministack_terratest_runs_go_test_with_endpoint_env(self):
        class Completed:
            returncode = 0
            stdout = "ok"
            stderr = ""

        with (
            patch("agents.iac_tools.shutil.which", return_value="/usr/local/bin/go"),
            patch("agents.iac_tools._reset_ministack", return_value={"ok": True, "status": 200}),
            patch("agents.iac_tools.subprocess.run", return_value=Completed()) as run,
        ):
            result = json.loads(
                _run_ministack_terratest(
                    Path.cwd(),
                    "http://127.0.0.1:4566",
                    "TestCriticalPath",
                    120,
                    True,
                )
            )

        self.assertTrue(result["ok"])
        self.assertEqual(run.call_args.args[0], ["go", "test", "./...", "-timeout", "120s", "-run", "TestCriticalPath"])
        self.assertEqual(run.call_args.kwargs["env"]["AWS_ENDPOINT_URL"], "http://127.0.0.1:4566")
        self.assertEqual(run.call_args.kwargs["env"]["AWS_ACCESS_KEY_ID"], "test")


if __name__ == "__main__":
    unittest.main()
