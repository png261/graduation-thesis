"""Compatibility facade for OpenTofu deploy orchestration."""
from __future__ import annotations

from app.services.opentofu.runtime.runner import (
    apply_modules_collect,
    apply_modules_stream,
    plan_modules_stream,
    run_modules_stream as _run_modules_stream,
)
from app.services.opentofu.runtime.costs import (
    get_costs,
    infracost_available as _infracost_available,
)
from app.services.opentofu.runtime.graph import get_graph
from app.services.opentofu.runtime.selector import select_modules_for_deploy
from app.services.opentofu.runtime.shared import (
    collect_module_var_files as _collect_module_var_files,
    load_project as _load_project,
    opentofu_available as _opentofu_available,
    opentofu_env as _opentofu_env,
    parse_selector_json as _parse_selector_json,
    project_lock as _project_lock,
    required_credential_fields as _required_credential_fields,
)
from app.services.opentofu.runtime.status import get_opentofu_status, preview_deploy

__all__ = [
    "_required_credential_fields",
    "_opentofu_available",
    "_infracost_available",
    "_project_lock",
    "_opentofu_env",
    "_collect_module_var_files",
    "_parse_selector_json",
    "_load_project",
    "select_modules_for_deploy",
    "get_opentofu_status",
    "preview_deploy",
    "get_costs",
    "get_graph",
    "_run_modules_stream",
    "apply_modules_stream",
    "plan_modules_stream",
    "apply_modules_collect",
]
