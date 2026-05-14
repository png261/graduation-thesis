import json
import unittest

from agents.iac_tools import _run, _workspace_path


class IaCToolSafetyTests(unittest.TestCase):
    def test_workspace_path_rejects_parent_escape(self):
        with self.assertRaises(ValueError):
            _workspace_path("../outside")

    def test_missing_command_reports_not_installed(self):
        result = json.loads(_run(["definitely-not-an-infraq-command"], _workspace_path(".")))

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "not_installed")


if __name__ == "__main__":
    unittest.main()
