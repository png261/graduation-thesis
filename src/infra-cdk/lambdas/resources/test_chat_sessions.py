from io import BytesIO
from test_pull_requests import load_index_module
from unittest import TestCase, main
from unittest.mock import Mock


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

    def test_sanitize_chat_session_preserves_image_attachment(self):
        data_url = "data:image/png;base64,iVBORw0KGgo="
        result = self.module._sanitize_chat_session(
            {
                "id": "session-1",
                "name": "Image chat",
                "history": [
                    {
                        "role": "user",
                        "content": "Review this image",
                        "timestamp": "2026-05-15T00:01:00.000Z",
                        "attachments": [
                            {
                                "id": "image-1",
                                "name": "diagram.png",
                                "type": "image/png",
                                "size": 128,
                                "dataUrl": data_url,
                            }
                        ],
                    }
                ],
                "startDate": "2026-05-15T00:00:00.000Z",
                "endDate": "2026-05-15T00:01:00.000Z",
                "repository": None,
                "pullRequest": None,
            }
        )

        attachment = result["history"][0]["attachments"][0]
        self.assertEqual(attachment["id"], "image-1")
        self.assertEqual(attachment["name"], "diagram.png")
        self.assertEqual(attachment["type"], "image/png")
        self.assertEqual(attachment["size"], 128)
        self.assertEqual(attachment["dataUrl"], data_url)

    def test_save_chat_session_stores_attachment_data_in_s3_when_bucket_configured(self):
        data_url = "data:text/plain;base64,aGVsbG8="
        self.module.CHAT_ATTACHMENT_BUCKET = "chat-attachment-bucket"
        self.module.s3 = Mock()

        result = self.module._sanitize_chat_session(
            {
                "id": "session-1",
                "name": "File chat",
                "history": [
                    {
                        "role": "user",
                        "content": "Review this file",
                        "timestamp": "2026-05-15T00:01:00.000Z",
                        "attachments": [
                            {
                                "id": "file-1",
                                "name": "notes.txt",
                                "type": "text/plain",
                                "size": 5,
                                "dataUrl": data_url,
                            }
                        ],
                    }
                ],
                "startDate": "2026-05-15T00:00:00.000Z",
                "endDate": "2026-05-15T00:01:00.000Z",
                "repository": None,
                "pullRequest": None,
            },
            user_id="user-1",
        )

        attachment = result["history"][0]["attachments"][0]
        self.assertNotIn("dataUrl", attachment)
        self.assertTrue(attachment["dataKey"].startswith("chat-attachments/"))
        self.assertEqual(attachment["size"], 5)
        self.module.s3.put_object.assert_called_once()
        self.assertEqual(self.module.s3.put_object.call_args.kwargs["Body"], b"hello")

    def test_list_chat_sessions_rehydrates_s3_attachment_data(self):
        self.module.CHAT_ATTACHMENT_BUCKET = "chat-attachment-bucket"
        self.module.s3 = Mock()
        self.module.s3.get_object.return_value = {
            "Body": BytesIO(b"hello"),
            "ContentType": "text/plain",
        }

        result = self.module._hydrate_session_attachments(
            {
                "id": "session-1",
                "history": [
                    {
                        "role": "user",
                        "content": "Review this file",
                        "timestamp": "2026-05-15T00:01:00.000Z",
                        "attachments": [
                            {
                                "id": "file-1",
                                "name": "notes.txt",
                                "type": "text/plain",
                                "size": 5,
                                "dataKey": "chat-attachments/user/session/message-000/file-1-notes.txt",
                            }
                        ],
                    }
                ],
            }
        )

        attachment = result["history"][0]["attachments"][0]
        self.assertEqual(attachment["dataUrl"], "data:text/plain;base64,aGVsbG8=")
        self.module.s3.get_object.assert_called_once_with(
            Bucket="chat-attachment-bucket",
            Key="chat-attachments/user/session/message-000/file-1-notes.txt",
        )


if __name__ == "__main__":
    main()
