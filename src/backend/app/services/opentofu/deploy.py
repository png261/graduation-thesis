"""OpenTofu deploy service surface."""

from __future__ import annotations

from app.services.opentofu.runtime.costs import get_costs, peek_cached_costs
from app.services.opentofu.runtime.graph import get_graph
from app.services.opentofu.runtime.runner import (
    apply_modules_collect,
    apply_modules_stream,
    destroy_modules_stream,
    plan_modules_stream,
)
from app.services.opentofu.runtime.selector import select_modules_for_deploy
from app.services.opentofu.runtime.status import get_opentofu_status, preview_deploy

__all__ = [
    "select_modules_for_deploy",
    "get_opentofu_status",
    "preview_deploy",
    "get_costs",
    "peek_cached_costs",
    "get_graph",
    "apply_modules_stream",
    "plan_modules_stream",
    "destroy_modules_stream",
    "apply_modules_collect",
]
