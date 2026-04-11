from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.project import credentials as project_credentials
from app.services.state_backends import service as state_service


class ProjectCredentialSerializationTests(unittest.TestCase):
    def test_serialize_credentials_keeps_profile_selection_out_of_runtime_credentials(self) -> None:
        payload = project_credentials.serialize_credentials(
            {
                "aws_access_key_id": "AKIA123",
                "aws_secret_access_key": "secret",
                "aws_region": "us-east-1",
            },
            selected_profile_id="profile-1",
        )

        self.assertEqual(
            project_credentials.parse_credentials(payload),
            {
                "aws_access_key_id": "AKIA123",
                "aws_secret_access_key": "secret",
                "aws_region": "us-east-1",
            },
        )
        self.assertEqual(project_credentials.parse_selected_profile_id(payload), "profile-1")


class StateBackendCredentialProfileTests(unittest.IsolatedAsyncioTestCase):
    async def test_browse_cloud_buckets_resolves_saved_profile_credentials(self) -> None:
        adapter = SimpleNamespace(list_buckets=lambda: ["state-a", "state-b"])
        settings = SimpleNamespace(state_encryption_key="secret")
        with (
            patch.object(
                state_service,
                "resolve_profile_credentials",
                AsyncMock(
                    return_value=(
                        "aws",
                        {
                            "aws_access_key_id": "AKIA123",
                            "aws_secret_access_key": "secret",
                        },
                    )
                ),
            ) as resolve_profile,
            patch.object(state_service, "get_cloud_adapter", return_value=adapter) as get_adapter,
        ):
            buckets = await state_service.browse_cloud_buckets(
                user_id="user-1",
                provider="aws",
                credential_profile_id="profile-1",
                settings=settings,
            )

        self.assertEqual(buckets, ["state-a", "state-b"])
        resolve_profile.assert_awaited_once()
        get_adapter.assert_called_once_with(
            "aws",
            {
                "aws_access_key_id": "AKIA123",
                "aws_secret_access_key": "secret",
            },
        )

    async def test_browse_cloud_objects_rejects_provider_mismatch(self) -> None:
        settings = SimpleNamespace(state_encryption_key="secret")
        with patch.object(
            state_service,
            "resolve_profile_credentials",
            AsyncMock(return_value=("gcs", {"gcp_credentials_json": "{}"})),
        ):
            with self.assertRaisesRegex(ValueError, "profile_provider_mismatch"):
                await state_service.browse_cloud_objects(
                    user_id="user-1",
                    provider="aws",
                    credential_profile_id="profile-1",
                    bucket="bucket-a",
                    prefix="",
                    settings=settings,
                )


if __name__ == "__main__":
    unittest.main()
