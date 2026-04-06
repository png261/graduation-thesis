from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.core.config import Settings
from app.services.opentofu.runtime import status


def build_settings() -> Settings:
    return Settings()


def build_status_payload(
    *,
    project_found: bool = True,
    opentofu_available: bool = True,
    provider: str | None = "aws",
    credential_ready: bool = True,
    missing_credentials: list[str] | None = None,
    modules: list[str] | None = None,
    can_deploy: bool | None = None,
) -> dict[str, object]:
    modules = [] if modules is None else modules
    missing_credentials = [] if missing_credentials is None else missing_credentials
    return {
        "project_found": project_found,
        "opentofu_available": opentofu_available,
        "provider": provider,
        "credential_ready": credential_ready,
        "missing_credentials": missing_credentials,
        "modules": modules,
        "can_deploy": (
            can_deploy if can_deploy is not None else opentofu_available and credential_ready and bool(modules)
        ),
    }


class OpenTofuStatusCleanupTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_opentofu_status_returns_not_found_payload(self) -> None:
        with (
            patch.object(status, "load_project", AsyncMock(return_value=None)),
            patch.object(status, "opentofu_available", return_value=True),
        ):
            result = await status.get_opentofu_status("project-1")

        self.assertEqual(
            result,
            {
                "project_found": False,
                "opentofu_available": True,
                "provider": None,
                "credential_ready": False,
                "missing_credentials": [],
                "modules": [],
                "can_deploy": False,
            },
        )

    async def test_get_opentofu_status_returns_ready_payload_when_inputs_are_complete(self) -> None:
        project = SimpleNamespace(provider="aws", credentials={"ignored": "value"})
        with (
            patch.object(status, "load_project", AsyncMock(return_value=project)),
            patch.object(
                status.project_credentials,
                "parse_credentials",
                return_value={"aws_access_key_id": "key", "aws_secret_access_key": "secret", "aws_region": "us-east-1"},
            ),
            patch.object(
                status,
                "required_credential_fields",
                return_value=["aws_access_key_id", "aws_secret_access_key", "aws_region"],
            ),
            patch.object(status, "discover_modules_from_project_dir", return_value=["network", "compute"]),
            patch.object(status, "opentofu_available", return_value=True),
        ):
            result = await status.get_opentofu_status("project-1")

        self.assertEqual(
            result,
            {
                "project_found": True,
                "opentofu_available": True,
                "provider": "aws",
                "credential_ready": True,
                "missing_credentials": [],
                "modules": ["network", "compute"],
                "can_deploy": True,
            },
        )

    async def test_preview_deploy_returns_not_found_error(self) -> None:
        with patch.object(
            status,
            "get_opentofu_status",
            AsyncMock(return_value=build_status_payload(project_found=False, provider=None, credential_ready=False)),
        ):
            result = await status.preview_deploy(project_id="project-1", settings=build_settings())

        self.assertEqual(result["status"], "error")
        self.assertEqual(result["message"], "Project not found")
        self.assertFalse(result["project_found"])

    async def test_preview_deploy_returns_cli_unavailable_error(self) -> None:
        with patch.object(
            status,
            "get_opentofu_status",
            AsyncMock(
                return_value=build_status_payload(opentofu_available=False, modules=["network"], can_deploy=False)
            ),
        ):
            result = await status.preview_deploy(project_id="project-1", settings=build_settings())

        self.assertEqual(result["status"], "error")
        self.assertEqual(result["message"], "OpenTofu CLI is not available")
        self.assertFalse(result["opentofu_available"])

    async def test_preview_deploy_merges_status_and_selection_payloads(self) -> None:
        current_status = build_status_payload(modules=["network", "compute"])
        selection = {
            "selected_modules": ["compute"],
            "reason": "User asked for compute only.",
            "selector": "llm",
        }
        with (
            patch.object(status, "get_opentofu_status", AsyncMock(return_value=current_status)),
            patch.object(status, "select_modules_for_deploy", AsyncMock(return_value=selection)) as mock_select,
        ):
            result = await status.preview_deploy(
                project_id="project-1",
                settings=build_settings(),
                intent="deploy compute",
            )

        mock_select.assert_awaited_once()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["intent"], "deploy compute")
        self.assertEqual(result["selected_modules"], ["compute"])
        self.assertEqual(result["modules"], ["network", "compute"])
        self.assertEqual(result["selector"], "llm")


if __name__ == "__main__":
    unittest.main()
