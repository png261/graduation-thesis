import json
import unittest
from pathlib import Path
from unittest.mock import patch

from agents.iac_tools import _configure_infracost_api_key, _run, _workspace_path


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


if __name__ == "__main__":
    unittest.main()
