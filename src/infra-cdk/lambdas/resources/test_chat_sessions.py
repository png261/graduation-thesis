from test_pull_requests import load_index_module
from unittest import TestCase, main


class ChatSessionPersistenceTests(TestCase):
    def setUp(self):
        self.module = load_index_module()

    def test_sanitize_chat_session_preserves_state_backend(self):
        result = self.module._sanitize_chat_session(
            {
                "id": "session-1",
                "name": "Terraform chat",
                "history": [],
                "startDate": "2026-05-15T00:00:00.000Z",
                "endDate": "2026-05-15T00:01:00.000Z",
                "repository": None,
                "stateBackend": {
                    "backendId": "backend-1",
                    "name": "Dev state",
                    "bucket": "terraform-state-demo",
                    "key": "env/dev.tfstate",
                    "region": "us-east-1",
                    "service": "s3",
                    "credentialId": "cred-1",
                    "credentialName": "Developer",
                    "repository": {
                        "fullName": "png261/hcp-terraform",
                        "owner": "png261",
                        "name": "hcp-terraform",
                        "defaultBranch": "main",
                    },
                },
                "pullRequest": None,
            }
        )

        self.assertEqual(result["stateBackend"]["backendId"], "backend-1")
        self.assertEqual(result["stateBackend"]["bucket"], "terraform-state-demo")
        self.assertEqual(result["stateBackend"]["key"], "env/dev.tfstate")
        self.assertEqual(result["stateBackend"]["credentialId"], "cred-1")
        self.assertEqual(result["stateBackend"]["repository"]["fullName"], "png261/hcp-terraform")


if __name__ == "__main__":
    main()
