"""OpenTofu cost estimation via Infracost CLI."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from redis import Redis

from app.core.config import Settings, get_settings
from app.services.project import files as project_files

from .shared import collect_module_var_files, discover_modules_from_project_dir, load_project, project_lock

_CACHE_TTL_SECONDS = 300.0
_COST_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_redis_client: Redis | None = None
_redis_url: str | None = None
logger = logging.getLogger(__name__)


def _cache_ttl() -> int:
    return max(1, int(get_settings().runtime_cache_ttl_seconds))


def _redis() -> Redis:
    global _redis_client, _redis_url
    settings = get_settings()
    if _redis_client is not None and _redis_url == settings.redis_url:
        return _redis_client
    _redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
    _redis_url = settings.redis_url
    return _redis_client


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _cache_key(project_id: str, module_scope: str) -> str:
    return f"{project_id}|{module_scope}"


def _cache_get(key: str) -> dict[str, Any] | None:
    try:
        raw = _redis().get(f"cache:cost:{key}")
    except Exception:
        raw = None
    if raw:
        try:
            payload = json.loads(raw)
            if isinstance(payload, dict):
                return payload
        except json.JSONDecodeError:
            logger.warning("invalid redis cost cache payload key=%s", key)
    entry = _COST_CACHE.get(key)
    if entry is None:
        return None
    expires_at, payload = entry
    if time.time() >= expires_at:
        _COST_CACHE.pop(key, None)
        return None
    return payload


def _cache_set(key: str, payload: dict[str, Any]) -> None:
    try:
        _redis().set(
            f"cache:cost:{key}",
            json.dumps(payload, ensure_ascii=False),
            ex=_cache_ttl(),
        )
    except Exception:
        logger.exception("failed to store cost cache key=%s", key)
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
    components, total_quantity, quantity_unit = _normalise_components(
        module, name, resource.get("costComponents") or []
    )
    return {
        "id": f"{module}:{name}",
        "module": module,
        "resource_name": name,
        "resource_type": resource_type,
        "quantity": _to_money(total_quantity),
        "unit": quantity_unit,
        "monthly_cost": monthly_cost,
        "components": components,
    }


def _normalise_components(
    module: str,
    resource_name: str,
    raw_components: list[Any],
) -> tuple[list[dict[str, Any]], float, str]:
    components: list[dict[str, Any]] = []
    total_quantity = 0.0
    quantity_unit = ""
    for idx, component in enumerate(raw_components):
        if not isinstance(component, dict):
            continue
        row, quantity, unit = _normalise_component(module, resource_name, idx, component)
        if quantity:
            total_quantity += quantity
        if not quantity_unit and unit:
            quantity_unit = unit
        components.append(row)
    return components, total_quantity, quantity_unit


def _normalise_component(
    module: str, resource_name: str, index: int, component: dict[str, Any]
) -> tuple[dict[str, Any], float, str]:
    comp_quantity = _to_float(component.get("monthlyQuantity"))
    comp_unit = str(component.get("unit") or "").strip()
    return (
        {
            "id": f"{module}:{resource_name}:component:{index}",
            "name": str(component.get("name") or "component"),
            "monthly_quantity": comp_quantity,
            "unit": comp_unit,
            "monthly_cost": _to_money(_to_float(component.get("monthlyCost"))),
        },
        comp_quantity,
        comp_unit,
    )


def _error_payload(code: str, message: str, *, project_found: bool, modules: list[str] | None = None) -> dict[str, Any]:
    payload = {
        "status": "error",
        "code": code,
        "message": message,
        "project_found": project_found,
    }
    if modules is not None:
        payload["available_modules"] = modules
    return payload


def _ensure_costs_ready(
    project: Any,
    modules: list[str],
    scope: str,
    settings: Settings,
) -> dict[str, Any] | None:
    if scope != "all" and scope not in modules:
        return _error_payload("invalid_module", f"Unknown module '{scope}'", project_found=True, modules=modules)
    if not infracost_available():
        return _error_payload(
            "tool_unavailable",
            "Infracost CLI is not available. Install infracost and retry.",
            project_found=True,
            modules=modules,
        )
    if not (settings.infracost_api_key or "").strip():
        return _error_payload(
            "missing_api_key", "INFRACOST_API_KEY is not configured.", project_found=True, modules=modules
        )
    return None


def _infracost_command(module_dir: Path, var_files: list[Path]) -> list[str]:
    cmd = ["infracost", "breakdown", "--path", str(module_dir), "--format", "json", "--no-color"]
    for var_file in var_files:
        cmd.extend(["--terraform-var-file", str(var_file)])
    return cmd


def _infracost_env(api_key: str) -> dict[str, str]:
    return {**os.environ, "INFRACOST_API_KEY": api_key, "INFRACOST_LOG_LEVEL": "error"}


def _append_module_costs(
    module: str,
    payload: dict[str, Any],
    *,
    resource_rows: list[dict[str, Any]],
    module_rows: list[dict[str, Any]],
) -> tuple[Any, float]:
    payload_currency = payload.get("currency")
    breakdown_projects = payload.get("projects") or []
    module_cost = 0.0
    for project_item in breakdown_projects:
        if not isinstance(project_item, dict):
            continue
        breakdown = project_item.get("breakdown") or {}
        module_cost += _to_float(breakdown.get("totalMonthlyCost"))
        for resource in breakdown.get("resources") or []:
            if isinstance(resource, dict):
                resource_rows.append(_normalise_resource(module=module, resource=resource))
    module_cost = _to_money(module_cost)
    module_rows.append({"name": module, "monthly_cost": module_cost})
    return payload_currency, module_cost


async def _module_cost_breakdown(
    *,
    module: str,
    module_dir: Path,
    project_root: Path,
    api_key: str,
) -> tuple[dict[str, Any] | None, str | None]:
    var_files = collect_module_var_files(project_root=project_root, module_dir=module_dir, module=module)
    cmd = _infracost_command(module_dir, var_files)
    rc, stdout, stderr = await _run_command(cmd=cmd, cwd=project_root, env=_infracost_env(api_key))
    if rc != 0:
        tail = (stderr or stdout).strip().splitlines()
        return None, tail[-1] if tail else f"Exit code {rc}"
    try:
        return json.loads(stdout), None
    except json.JSONDecodeError:
        return None, "Invalid Infracost JSON output"


def _cost_result(
    *,
    scope: str,
    modules: list[str],
    module_rows: list[dict[str, Any]],
    resource_rows: list[dict[str, Any]],
    warnings: list[str],
    total_monthly_cost: float,
    currency: str,
) -> dict[str, Any]:
    module_rows.sort(key=lambda item: item["name"])
    resource_rows.sort(key=lambda item: (item["module"], item["resource_name"]))
    return {
        "status": "ok" if module_rows or not warnings else "error",
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


async def _collect_cost_rows(
    *,
    project_id: str,
    project_root: Path,
    selected_modules: list[str],
    api_key: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str], float, str]:
    resource_rows: list[dict[str, Any]] = []
    module_rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    total_monthly_cost = 0.0
    currency = "USD"
    lock = project_lock(project_id)
    async with lock:
        for module in selected_modules:
            payload, error = await _module_payload(module, project_root, api_key)
            if payload is None:
                warnings.append(f"Module '{module}' failed cost estimate: {error or 'unknown error'}")
                continue
            payload_currency, module_cost = _append_module_costs(
                module, payload, resource_rows=resource_rows, module_rows=module_rows
            )
            if isinstance(payload_currency, str) and payload_currency.strip():
                currency = payload_currency.strip().upper()
            total_monthly_cost += module_cost
    return module_rows, resource_rows, warnings, total_monthly_cost, currency


async def _module_payload(
    module: str,
    project_root: Path,
    api_key: str,
) -> tuple[dict[str, Any] | None, str | None]:
    module_dir = project_root / "modules" / module
    if not module_dir.exists():
        return None, "Module path does not exist on disk"
    return await _module_cost_breakdown(
        module=module,
        module_dir=module_dir,
        project_root=project_root,
        api_key=api_key,
    )


def _scope_and_cache_key(project_id: str, module_scope: str) -> tuple[str, str]:
    scope = (module_scope or "all").strip() or "all"
    return scope, _cache_key(project_id, scope)


def _cached_cost_result(cache_key: str, refresh: bool) -> dict[str, Any] | None:
    if refresh:
        return None
    return _cache_get(cache_key)


def peek_cached_costs(*, project_id: str, module_scope: str = "all") -> dict[str, Any] | None:
    _, cache_key = _scope_and_cache_key(project_id, module_scope)
    return _cache_get(cache_key)


async def _modules_or_error(
    *,
    project_id: str,
    scope: str,
    settings: Settings,
) -> tuple[list[str] | None, dict[str, Any] | None]:
    project = await load_project(project_id)
    if project is None:
        return None, _error_payload("project_not_found", "Project not found", project_found=False)
    modules = discover_modules_from_project_dir(project_id)
    readiness_error = _ensure_costs_ready(project, modules, scope, settings)
    if readiness_error is not None:
        return None, readiness_error
    return modules, None


def _selected_modules(scope: str, modules: list[str]) -> list[str]:
    return modules if scope == "all" else [scope]


async def _compute_cost_result(
    *,
    project_id: str,
    scope: str,
    modules: list[str],
    settings: Settings,
) -> dict[str, Any]:
    project_root = project_files.ensure_project_dir(project_id)
    (project_root / ".opentofu-runtime").mkdir(parents=True, exist_ok=True)
    module_rows, resource_rows, warnings, total_monthly_cost, currency = await _collect_cost_rows(
        project_id=project_id,
        project_root=project_root,
        selected_modules=_selected_modules(scope, modules),
        api_key=(settings.infracost_api_key or "").strip(),
    )
    return _cost_result(
        scope=scope,
        modules=modules,
        module_rows=module_rows,
        resource_rows=resource_rows,
        warnings=warnings,
        total_monthly_cost=total_monthly_cost,
        currency=currency,
    )


async def get_costs(
    *,
    project_id: str,
    settings: Settings,
    module_scope: str = "all",
    refresh: bool = False,
) -> dict[str, Any]:
    scope, cache_key = _scope_and_cache_key(project_id, module_scope)
    cached = _cached_cost_result(cache_key, refresh)
    if cached is not None:
        return cached
    modules, error = await _modules_or_error(project_id=project_id, scope=scope, settings=settings)
    if error is not None:
        return error
    result = await _compute_cost_result(project_id=project_id, scope=scope, modules=modules or [], settings=settings)
    if result["status"] == "ok":
        _cache_set(cache_key, result)
    return result
