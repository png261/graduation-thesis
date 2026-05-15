import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from agents.artifacts import session_artifact_dir
import agents.orchestator.tools.safe_diagram as safe_diagram


class ArtifactPathTests(unittest.TestCase):
    def test_session_artifact_dir_is_outside_repository_checkout(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_path = Path(tmp)
            repo_path = base_path / "sessions" / "chat-1" / "repos" / "owner" / "repo"

            artifact_dir = session_artifact_dir("chat-1", "attachments", base_path)

            self.assertEqual(artifact_dir, base_path / "sessions" / "chat-1" / "attachments")
            self.assertNotIn("repos", artifact_dir.parts)
            self.assertFalse(str(artifact_dir).startswith(str(repo_path)))

    def test_generic_diagram_output_dir_uses_session_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(
                os.environ,
                {
                    "SHARED_FILES_ACTIVE_PATH": tmp,
                    "SHARED_FILES_SESSION_ID": "chat/with spaces",
                },
                clear=False,
            ):
                output_dir = safe_diagram._diagram_output_dir()

            self.assertEqual(output_dir, Path(tmp) / "sessions" / "chat-with-spaces" / "generic-diagrams")
            self.assertNotIn("repos", output_dir.parts)

    def test_generic_diagram_tool_runs_from_session_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            previous_cwd = os.getcwd()
            calls = []

            def fake_diagram(**kwargs):
                calls.append((Path(os.getcwd()), kwargs))
                return "ok"

            with patch.dict(
                os.environ,
                {
                    "SHARED_FILES_ACTIVE_PATH": tmp,
                    "SHARED_FILES_SESSION_ID": "chat-2",
                },
                clear=False,
            ):
                with patch.object(safe_diagram, "strands_diagram", fake_diagram):
                    result = safe_diagram.diagram(diagram_type="graph", nodes=[])

            self.assertEqual(result, "ok")
            self.assertEqual(calls[0][0].resolve(), (Path(tmp) / "sessions" / "chat-2" / "generic-diagrams").resolve())
            self.assertNotIn("repos", calls[0][0].parts)
            self.assertEqual(os.getcwd(), previous_cwd)


if __name__ == "__main__":
    unittest.main()
