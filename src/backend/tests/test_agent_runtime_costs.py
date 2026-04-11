from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.agent.runtime.context import build_infra_cost_context
from app.services.agent.runtime.tools import _build_local_project_tools, _get_infra_costs
from app.services.chat.service import _load_runtime_cost_context


class AgentRuntimeCostContextTests(unittest.TestCase):
    def test_build_infra_cost_context_preserves_scope_and_available_modules(self) -> None:
        context = build_infra_cost_context(
            {
                "status": "ok",
                "scope": "all",
                "currency": "usd",
                "total_monthly_cost": 42.5,
                "generated_at": "2026-04-10T00:00:00Z",
                "available_modules": ["network", "compute"],
                "modules": [
                    {"name": "network", "monthly_cost": 10.0},
                    {"name": "compute", "monthly_cost": 32.5},
                ],
                "warnings": ["cached result"],
            }
        )

        assert context is not None
        self.assertEqual(context.scope, "all")
        self.assertEqual(context.currency, "USD")
        self.assertEqual(context.total_monthly_cost, 42.5)
        self.assertEqual(context.available_modules, ("network", "compute"))
        self.assertEqual(
            [(module.name, module.monthly_cost) for module in context.modules],
            [("network", 10.0), ("compute", 32.5)],
        )
        self.assertEqual(context.warnings, ("cached result",))


class AgentRuntimeCostToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_infra_costs_uses_cached_lookup_by_default(self) -> None:
        settings = SimpleNamespace()
        with patch(
            "app.services.agent.runtime.tools.opentofu_deploy.get_costs",
            new=AsyncMock(return_value={"status": "ok", "scope": "all", "modules": []}),
        ) as mocked:
            payload = await _get_infra_costs("project-123", settings)

        mocked.assert_awaited_once_with(
            project_id="project-123",
            settings=settings,
            module_scope="all",
            refresh=False,
        )
        self.assertEqual(payload["source_tool"], "get_infra_costs")
        self.assertEqual(payload["cache_behavior"], "cached_by_default")
        self.assertFalse(payload["refresh"])
        self.assertEqual(payload["status"], "ok")

    async def test_get_infra_costs_can_force_refresh_and_preserves_error_payload(self) -> None:
        settings = SimpleNamespace()
        with patch(
            "app.services.agent.runtime.tools.opentofu_deploy.get_costs",
            new=AsyncMock(return_value={"status": "error", "code": "missing_api_key"}),
        ) as mocked:
            payload = await _get_infra_costs("project-123", settings, "network", True)

        mocked.assert_awaited_once_with(
            project_id="project-123",
            settings=settings,
            module_scope="network",
            refresh=True,
        )
        self.assertEqual(payload["source_tool"], "get_infra_costs")
        self.assertEqual(payload["requested_scope"], "network")
        self.assertTrue(payload["refresh"])
        self.assertEqual(payload["status"], "error")
        self.assertEqual(payload["code"], "missing_api_key")

    def test_local_project_tools_register_get_infra_costs(self) -> None:
        tool_names = [tool.name for tool in _build_local_project_tools(SimpleNamespace(), "project-123")]
        self.assertIn("get_infra_costs", tool_names)


class ChatRuntimeCostContextTests(unittest.IsolatedAsyncioTestCase):
    async def test_load_runtime_cost_context_reads_cached_costs_without_recompute(self) -> None:
        with (
            patch(
                "app.services.chat.service.opentofu_deploy.peek_cached_costs",
                return_value={
                    "status": "ok",
                    "scope": "all",
                    "currency": "USD",
                    "total_monthly_cost": 18.0,
                    "generated_at": "2026-04-10T00:00:00Z",
                    "available_modules": ["network"],
                    "modules": [{"name": "network", "monthly_cost": 18.0}],
                    "warnings": [],
                },
            ) as peek_cached,
            patch(
                "app.services.chat.service.opentofu_deploy.get_costs",
                new=AsyncMock(side_effect=AssertionError("chat runtime should not recompute costs")),
            ),
        ):
            context = await _load_runtime_cost_context("project-123")

        peek_cached.assert_called_once_with(project_id="project-123", module_scope="all")
        assert context is not None
        self.assertEqual(context.total_monthly_cost, 18.0)
        self.assertEqual(context.available_modules, ("network",))

    async def test_load_runtime_cost_context_returns_none_when_cache_missing(self) -> None:
        with (
            patch("app.services.chat.service.opentofu_deploy.peek_cached_costs", return_value=None) as peek_cached,
            patch(
                "app.services.chat.service.opentofu_deploy.get_costs",
                new=AsyncMock(side_effect=AssertionError("chat runtime should not recompute costs")),
            ),
        ):
            context = await _load_runtime_cost_context("project-123")

        peek_cached.assert_called_once_with(project_id="project-123", module_scope="all")
        self.assertIsNone(context)


if __name__ == "__main__":
    unittest.main()
