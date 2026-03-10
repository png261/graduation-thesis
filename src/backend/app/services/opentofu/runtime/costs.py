"""OpenTofu cost estimation via Infracost CLI."""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.config import Settings
from app.services.project import files as project_files

from .shared import collect_module_var_files, discover_modules_from_project_dir, load_project, project_lock

_CACHE_TTL_SECONDS = 300.0
_COST_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _cache_key(project_id: str, module_scope: str) -> str:
    return f"{project_id}|{module_scope}"


def _cache_get(key: str) -> dict[str, Any] | None:
    entry = _COST_CACHE.get(key)
    if entry is None:
        return None
    expires_at, payload = entry
    if time.time() >= expires_at:
        _COST_CACHE.pop(key, None)
        return None
    return payload


def _cache_set(key: str, payload: dict[str, Any]) -> None:
    _COST_CACHE[key] = (time.time() + _CACHE_TTL_SECONDS, payload)


def infracost_available() -> bool:
    return shutil.which("infracost") is not None


def _to_float(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def _to_money(value: float) -> float:
    return round(value + 0.0, 4)


async def _run_command(*, cmd: list[str], cwd: Path, env: dict[str, str]) -> tuple[int, str, str]:
    process = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    stdout_raw, stderr_raw = await process.communicate()
    return (
        process.returncode,
        stdout_raw.decode(errors="replace"),
        stderr_raw.decode(errors="replace"),
    )


def _normalise_resource(
    *,
    module: str,
    resource: dict[str, Any],
) -> dict[str, Any]:
    name = str(resource.get("name") or "unknown")
    resource_type = str(resource.get("resourceType") or "unknown")
    monthly_cost = _to_money(_to_float(resource.get("monthlyCost")))

    components: list[dict[str, Any]] = []
    total_quantity = 0.0
    quantity_unit = ""
    for idx, component in enumerate(resource.get("costComponents") or []):
        if not isinstance(component, dict):
            continue
        comp_quantity = _to_float(component.get("monthlyQuantity"))
        comp_unit = str(component.get("unit") or "").strip()
        if comp_quantity:
            total_quantity += comp_quantity
        if not quantity_unit and comp_unit:
            quantity_unit = comp_unit
        components.append(
            {
                "id": f"{module}:{name}:component:{idx}",
                "name": str(component.get("name") or "component"),
                "monthly_quantity": comp_quantity,
                "unit": comp_unit,
                "monthly_cost": _to_money(_to_float(component.get("monthlyCost"))),
            }
        )

    normalised = {
        "id": f"{module}:{name}",
        "module": module,
        "resource_name": name,
        "resource_type": resource_type,
        "quantity": _to_money(total_quantity),
        "unit": quantity_unit,
        "monthly_cost": monthly_cost,
        "components": components,
    }
    return normalised


async def get_costs(
    *,
    project_id: str,
    settings: Settings,
    module_scope: str = "all",
    refresh: bool = False,
) -> dict[str, Any]:
    scope = (module_scope or "all").strip() or "all"
    cache_key = _cache_key(project_id, scope)
    if not refresh:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    project = await load_project(project_id)
    if project is None:
        return {
            "status": "error",
            "code": "project_not_found",
            "message": "Project not found",
            "project_found": False,
        }

    modules = discover_modules_from_project_dir(project_id)
    if scope != "all" and scope not in modules:
        return {
            "status": "error",
            "code": "invalid_module",
            "message": f"Unknown module '{scope}'",
            "project_found": True,
            "available_modules": modules,
        }

    if not infracost_available():
        return {
            "status": "error",
            "code": "tool_unavailable",
            "message": "Infracost CLI is not available. Install infracost and retry.",
            "project_found": True,
            "available_modules": modules,
        }

    api_key = (settings.infracost_api_key or "").strip()
    if not api_key:
        return {
            "status": "error",
            "code": "missing_api_key",
            "message": "INFRACOST_API_KEY is not configured.",
            "project_found": True,
            "available_modules": modules,
        }

    selected_modules = modules if scope == "all" else [scope]

    project_root = project_files.ensure_project_dir(project_id)
    runtime_root = project_root / ".opentofu-runtime"
    runtime_root.mkdir(parents=True, exist_ok=True)

    resource_rows: list[dict[str, Any]] = []
    module_rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    total_monthly_cost = 0.0
    currency = "USD"

    lock = project_lock(project_id)
    async with lock:
        for module in selected_modules:
            module_dir = project_root / "modules" / module
            if not module_dir.exists():
                warnings.append(f"Module '{module}' does not exist on disk")
                continue

            cmd = [
                "infracost",
                "breakdown",
                "--path",
                str(module_dir),
                "--format",
                "json",
                "--no-color",
            ]
            var_files = collect_module_var_files(
                project_root=project_root,
                module_dir=module_dir,
                module=module,
            )
            for var_file in var_files:
                cmd.extend(["--terraform-var-file", str(var_file)])

            env = {
                **os.environ,
                "INFRACOST_API_KEY": api_key,
                "INFRACOST_LOG_LEVEL": "error",
            }

            rc, stdout, stderr = await _run_command(cmd=cmd, cwd=project_root, env=env)
            if rc != 0:
                tail = (stderr or stdout).strip().splitlines()
                reason = tail[-1] if tail else f"Exit code {rc}"
                warnings.append(f"Module '{module}' failed cost estimate: {reason}")
                continue

            try:
                payload = json.loads(stdout)
            except json.JSONDecodeError:
                warnings.append(f"Module '{module}' returned invalid Infracost JSON output")
                continue

            payload_currency = payload.get("currency")
            if isinstance(payload_currency, str) and payload_currency.strip():
                currency = payload_currency.strip().upper()

            projects = payload.get("projects") or []
            module_cost = 0.0
            for project_item in projects:
                if not isinstance(project_item, dict):
                    continue
                breakdown = project_item.get("breakdown") or {}
                module_cost += _to_float(breakdown.get("totalMonthlyCost"))
                for resource in breakdown.get("resources") or []:
                    if not isinstance(resource, dict):
                        continue
                    row = _normalise_resource(module=module, resource=resource)
                    resource_rows.append(row)

            module_cost = _to_money(module_cost)
            total_monthly_cost += module_cost
            module_rows.append(
                {
                    "name": module,
                    "monthly_cost": module_cost,
                }
            )

    module_rows.sort(key=lambda item: item["name"])
    resource_rows.sort(key=lambda item: (item["module"], item["resource_name"]))

    status = "ok" if module_rows or not warnings else "error"
    result = {
        "status": status,
        "project_found": True,
        "scope": scope,
        "generated_at": _utcnow_iso(),
        "currency": currency,
        "modules": module_rows,
        "total_monthly_cost": _to_money(total_monthly_cost),
        "resources": resource_rows,
        "warnings": warnings,
        "available_modules": modules,
    }
    if status == "ok":
        _cache_set(cache_key, result)
    return result
