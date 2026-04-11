"""Project-scoped tools exposed to the deep agent."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from pathlib import Path
from typing import Any

from langchain.tools import tool

from app.core.config import Settings
from app.services.ansible import deploy as ansible_deploy
from app.services.opentofu import deploy as opentofu_deploy
from app.services.opentofu.runtime.shared import merge_run_env, opentofu_available
from app.services.project import files as project_files

from .iac_templates import validate_iac_structure

logger = logging.getLogger(__name__)
_TF_PATTERN_COUNTS = {
    "resource": re.compile(r'^\s*resource\s+"[^"]+"\s+"[^"]+"', re.MULTILINE),
    "data": re.compile(r'^\s*data\s+"[^"]+"\s+"[^"]+"', re.MULTILINE),
    "module": re.compile(r'^\s*module\s+"[^"]+"', re.MULTILINE),
    "variable": re.compile(r'^\s*variable\s+"[^"]+"', re.MULTILINE),
    "output": re.compile(r'^\s*output\s+"[^"]+"', re.MULTILINE),
}
_YAML_TASK_PATTERN = re.compile(r"^\s*-\s+name:\s+", re.MULTILINE)
_YAML_DEFAULT_PATTERN = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:", re.MULTILINE)


def _artifact_payload(
    source_tool: str,
    payload: dict[str, Any],
    *,
    severity: str | None = None,
    fix_class: str | None = None,
) -> dict[str, Any]:
    artifact = {
        "schema_version": 1,
        "source_tool": source_tool,
        **payload,
    }
    if severity:
        artifact["severity"] = severity
    if fix_class:
        artifact["fix_class"] = fix_class
    return artifact


async def _opentofu_tool_preview(
    project_id: str,
    settings: Settings,
    intent: str | None = None,
) -> dict:
    result = await opentofu_deploy.preview_deploy(
        project_id=project_id,
        settings=settings,
        intent=intent,
    )
    return _artifact_payload("opentofu_preview_deploy", result)


async def _opentofu_tool_apply(
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    confirm: bool = False,
    intent: str | None = None,
    override_policy: bool = False,
) -> dict:
    if not confirm:
        return _artifact_payload(
            "opentofu_apply_deploy",
            {
                "status": "confirmation_required",
                "message": (
                    "OpenTofu apply requires explicit user confirmation. "
                    "Ask the user, then call opentofu_apply_deploy again with confirm=true."
                ),
                "selected_modules": selected_modules,
                "intent": intent or "",
            },
            severity="medium",
            fix_class="plan",
        )
    result = await opentofu_deploy.apply_modules_collect(
        project_id=project_id,
        settings=settings,
        selected_modules=selected_modules,
        intent=intent,
        policy_override=override_policy,
    )
    return _artifact_payload(
        "opentofu_apply_deploy",
        {"status": "ok" if result["final"]["status"] == "ok" else "failed", **result},
    )


async def _ansible_tool_run(
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    confirm: bool = False,
    intent: str | None = None,
) -> dict:
    if not confirm:
        return _artifact_payload(
            "ansible_run_config",
            {
                "status": "confirmation_required",
                "message": (
                    "Ansible configuration run requires explicit user confirmation. "
                    "Ask the user, then call ansible_run_config again with confirm=true."
                ),
                "selected_modules": selected_modules,
                "intent": intent or "",
            },
            severity="medium",
            fix_class="plan",
        )
    result = await ansible_deploy.run_playbook_collect(
        project_id=project_id,
        settings=settings,
        selected_modules=selected_modules,
        intent=intent,
    )
    final = result["final"] if isinstance(result.get("final"), dict) else {}
    return _artifact_payload(
        "ansible_run_config",
        {
            "status": "ok" if final.get("status") == "ok" else "failed",
            "transport": final.get("transport"),
            "selected_modules": final.get("selected_modules", []),
            "target_count": final.get("target_count", 0),
            "target_ids": final.get("target_ids", []),
            **result,
        },
    )


def _module_scope(module_scope: str | None) -> str:
    value = str(module_scope or "all").strip()
    return value or "all"


async def _get_infra_costs(
    project_id: str,
    settings: Settings,
    module_scope: str = "all",
    refresh: bool = False,
) -> dict:
    scope = _module_scope(module_scope)
    try:
        result = await opentofu_deploy.get_costs(
            project_id=project_id,
            settings=settings,
            module_scope=scope,
            refresh=refresh,
        )
    except Exception as exc:
        logger.warning("failed to load infra costs project_id=%s scope=%s", project_id, scope, exc_info=True)
        return _artifact_payload(
            "get_infra_costs",
            {"status": "error", "message": str(exc), "scope": scope, "refresh": refresh},
            severity="medium",
            fix_class="plan",
        )
    payload = result if isinstance(result, dict) else {"status": "error", "message": "Invalid cost payload"}
    return _artifact_payload(
        "get_infra_costs",
        {
            "cache_behavior": "cached_by_default",
            "refresh": refresh,
            "requested_scope": scope,
            **payload,
        },
    )


def _sanitize_selected_modules(selected_modules: list[str] | None) -> list[str]:
    if not selected_modules:
        return []
    names: list[str] = []
    for row in selected_modules:
        if not isinstance(row, str):
            continue
        value = row.strip()
        if value:
            names.append(value)
    return names


def _project_root(project_id: str) -> Path:
    return project_files.ensure_project_dir(project_id)


def _selected_module_set(selected_modules: list[str] | None) -> set[str] | None:
    modules = _sanitize_selected_modules(selected_modules)
    return set(modules) if modules else None


def _iter_project_files(project_id: str, roots: tuple[str, ...], suffixes: tuple[str, ...]) -> list[Path]:
    project_root = _project_root(project_id)
    files: list[Path] = []
    for root in roots:
        absolute_root = project_root / root
        if not absolute_root.exists():
            continue
        files.extend(path for path in absolute_root.rglob("*") if path.is_file() and path.suffix in suffixes)
    return sorted(files)


def _filter_module_paths(
    paths: list[Path], project_id: str, selected_modules: list[str] | None, marker: str
) -> list[Path]:
    wanted = _selected_module_set(selected_modules)
    if wanted is None:
        return paths
    project_root = _project_root(project_id)
    filtered: list[Path] = []
    for path in paths:
        relative = path.relative_to(project_root).parts
        if marker in relative:
            index = relative.index(marker)
            if index + 1 < len(relative) and relative[index + 1] in wanted:
                filtered.append(path)
                continue
        if marker not in relative and path.name == "site.yml":
            filtered.append(path)
    return filtered


def _read_text(path: Path) -> str:
    try:
        return path.read_text()
    except UnicodeDecodeError:
        return path.read_text(errors="ignore")


def _relative_path(project_id: str, path: Path) -> str:
    return "/" + path.relative_to(_project_root(project_id)).as_posix()


def _review_target_path(project_root: Path, path: Path) -> str:
    return "/" + path.relative_to(project_root).as_posix()


def _count_matches(content: str, patterns: dict[str, re.Pattern[str]]) -> dict[str, int]:
    return {name: len(pattern.findall(content)) for name, pattern in patterns.items()}


def _match_lines(content: str, pattern: re.Pattern[str]) -> list[str]:
    return [match.group(1) for match in pattern.finditer(content)]


def _trim_hits(hits: list[dict[str, Any]], max_results: int) -> list[dict[str, Any]]:
    return hits[: max(1, max_results)]


def _discover_opentofu_review_targets(project_root: Path, selected_modules: list[str] | None) -> list[dict[str, Any]]:
    targets: list[dict[str, Any]] = []
    selected = _selected_module_set(selected_modules)
    modules_root = project_root / "modules"
    if modules_root.exists():
        for module_dir in sorted(path for path in modules_root.iterdir() if path.is_dir()):
            if selected is not None and module_dir.name not in selected:
                continue
            if any(module_dir.rglob("*.tf")):
                targets.append({"kind": "module", "name": module_dir.name, "path": module_dir})
    stacks_root = project_root / "stacks"
    if selected is None and stacks_root.exists():
        for stack_dir in sorted(path for path in stacks_root.iterdir() if path.is_dir()):
            if any(stack_dir.rglob("*.tf")):
                targets.append({"kind": "stack", "name": stack_dir.name, "path": stack_dir})
    return targets


async def _run_review_command(cmd: list[str], cwd: Path, env: dict[str, str]) -> tuple[int, str, str]:
    process = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(cwd),
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    return (
        int(process.returncode or 0),
        stdout.decode("utf-8", errors="replace"),
        stderr.decode("utf-8", errors="replace"),
    )


def _read_validate_json(raw: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _diagnostic_line(diagnostic: dict[str, Any]) -> str:
    summary = str(diagnostic.get("summary") or "Validation error")
    detail = str(diagnostic.get("detail") or "").strip()
    range_payload = diagnostic.get("range")
    location = ""
    if isinstance(range_payload, dict):
        filename = range_payload.get("filename")
        start = range_payload.get("start")
        if isinstance(filename, str) and filename:
            location = filename
            if isinstance(start, dict) and isinstance(start.get("line"), int):
                location = f"{location}:{start['line']}"
    line = f"{location} - {summary}" if location else summary
    return f"{line}: {detail}" if detail else line


def _summarize_validate_output(stdout: str, stderr: str, exit_code: int) -> dict[str, Any]:
    payload = _read_validate_json(stdout)
    diagnostics = payload.get("diagnostics") if isinstance(payload, dict) else None
    diagnostic_lines = (
        [_diagnostic_line(item) for item in diagnostics if isinstance(item, dict)]
        if isinstance(diagnostics, list)
        else []
    )
    if isinstance(payload, dict):
        return {
            "valid": bool(payload.get("valid", exit_code == 0)),
            "error_count": int(payload.get("error_count") or len(diagnostic_lines)),
            "warning_count": int(payload.get("warning_count") or 0),
            "diagnostics": diagnostic_lines[:20],
            "stdout": stdout.strip()[:4000],
            "stderr": stderr.strip()[:4000],
        }
    combined = "\n".join(part for part in [stdout.strip(), stderr.strip()] if part).strip()
    lines = [line for line in combined.splitlines() if line][:20]
    return {
        "valid": exit_code == 0,
        "error_count": 0 if exit_code == 0 else max(1, len(lines)),
        "warning_count": 0,
        "diagnostics": lines,
        "stdout": stdout.strip()[:4000],
        "stderr": stderr.strip()[:4000],
    }


async def _run_opentofu_review_target(project_root: Path, target: dict[str, Any]) -> dict[str, Any]:
    target_path = target["path"]
    env = merge_run_env({"TF_IN_AUTOMATION": "1"})
    init_code, init_stdout, init_stderr = await _run_review_command(
        ["tofu", "init", "-backend=false", "-input=false", "-no-color"],
        target_path,
        env,
    )
    if init_code != 0:
        diagnostics = [line for line in "\n".join([init_stdout.strip(), init_stderr.strip()]).splitlines() if line][:20]
        return {
            "target": _review_target_path(project_root, target_path),
            "kind": target["kind"],
            "name": target["name"],
            "status": "fail",
            "init_exit_code": init_code,
            "validate_exit_code": None,
            "valid": False,
            "error_count": max(1, len(diagnostics)),
            "warning_count": 0,
            "diagnostics": diagnostics,
        }
    validate_code, validate_stdout, validate_stderr = await _run_review_command(
        ["tofu", "validate", "-json", "-no-color"],
        target_path,
        env,
    )
    summary = _summarize_validate_output(validate_stdout, validate_stderr, validate_code)
    return {
        "target": _review_target_path(project_root, target_path),
        "kind": target["kind"],
        "name": target["name"],
        "status": "pass" if summary["valid"] else "fail",
        "init_exit_code": init_code,
        "validate_exit_code": validate_code,
        **summary,
    }


async def _opentofu_validate_review(
    project_id: str,
    selected_modules: list[str] | None = None,
) -> dict:
    if not opentofu_available():
        return _artifact_payload(
            "opentofu_validate_review",
            {"status": "error", "message": "OpenTofu CLI is not available", "results": []},
            severity="high",
            fix_class="file",
        )
    project_root = _project_root(project_id)
    targets = _discover_opentofu_review_targets(project_root, selected_modules)
    if not targets:
        return _artifact_payload(
            "opentofu_validate_review",
            {
                "status": "error",
                "message": "No OpenTofu targets found to review under modules/ or stacks/.",
                "selected_modules": _sanitize_selected_modules(selected_modules),
                "results": [],
            },
            severity="medium",
            fix_class="file",
        )
    results = [await _run_opentofu_review_target(project_root, target) for target in targets]
    failed = [item for item in results if item["status"] != "pass"]
    payload = {
        "status": "pass" if not failed else "fail",
        "selected_modules": _sanitize_selected_modules(selected_modules),
        "checked_targets": [item["target"] for item in results],
        "result_count": len(results),
        "failed_count": len(failed),
        "results": results,
    }
    return _artifact_payload(
        "opentofu_validate_review",
        payload,
        severity="high" if failed else None,
        fix_class="file" if failed else None,
    )


async def _iac_structure_tool_validate(
    project_id: str,
    selected_modules: list[str] | None = None,
    require_ansible: bool = True,
) -> dict:
    root = project_files.ensure_project_dir(project_id)
    modules = _sanitize_selected_modules(selected_modules)
    return _artifact_payload(
        "validate_iac_structure",
        validate_iac_structure(root, selected_modules=modules, require_ansible=require_ansible),
    )


async def _inspect_opentofu_generated_code(project_id: str, selected_modules: list[str] | None = None) -> dict:
    files = _filter_module_paths(
        _iter_project_files(project_id, ("modules", "stacks"), (".tf", ".md")),
        project_id,
        selected_modules,
        "modules",
    )
    summaries = []
    for path in files:
        content = _read_text(path)
        summaries.append(
            {
                "path": _relative_path(project_id, path),
                "lineCount": len(content.splitlines()),
                "counts": _count_matches(content, _TF_PATTERN_COUNTS) if path.suffix == ".tf" else {},
            }
        )
    return _artifact_payload(
        "inspect_opentofu_generated_code",
        {"target": "opentofu", "selectedModules": _sanitize_selected_modules(selected_modules), "files": summaries},
    )


async def _inspect_ansible_generated_code(project_id: str, selected_modules: list[str] | None = None) -> dict:
    files = _filter_module_paths(
        _iter_project_files(project_id, ("playbooks", "roles"), (".yml", ".yaml", ".md")),
        project_id,
        selected_modules,
        "roles",
    )
    summaries = []
    for path in files:
        content = _read_text(path)
        summaries.append(
            {
                "path": _relative_path(project_id, path),
                "lineCount": len(content.splitlines()),
                "taskCount": len(_YAML_TASK_PATTERN.findall(content)) if path.suffix in {".yml", ".yaml"} else 0,
                "topLevelKeys": (
                    _trim_hits(
                        [{"name": key} for key in _match_lines(content, _YAML_DEFAULT_PATTERN)],
                        10,
                    )
                    if path.suffix in {".yml", ".yaml"}
                    else []
                ),
            }
        )
    return _artifact_payload(
        "inspect_ansible_generated_code",
        {"target": "ansible", "selectedModules": _sanitize_selected_modules(selected_modules), "files": summaries},
    )


async def _search_generated_iac_patterns(
    project_id: str,
    pattern: str,
    target: str = "all",
    selected_modules: list[str] | None = None,
    max_results: int = 50,
) -> dict:
    compiled = re.compile(pattern, re.MULTILINE)
    targets = {
        "opentofu": _filter_module_paths(
            _iter_project_files(project_id, ("modules", "stacks"), (".tf", ".md")),
            project_id,
            selected_modules,
            "modules",
        ),
        "ansible": _filter_module_paths(
            _iter_project_files(project_id, ("playbooks", "roles"), (".yml", ".yaml", ".md")),
            project_id,
            selected_modules,
            "roles",
        ),
    }
    selected_paths = (
        targets["opentofu"]
        if target == "opentofu"
        else targets["ansible"] if target == "ansible" else [*targets["opentofu"], *targets["ansible"]]
    )
    hits: list[dict[str, Any]] = []
    for path in selected_paths:
        for line_number, line in enumerate(_read_text(path).splitlines(), start=1):
            if not compiled.search(line):
                continue
            hits.append({"path": _relative_path(project_id, path), "line": line_number, "text": line.strip()})
            if len(hits) >= max(1, max_results):
                return _artifact_payload(
                    "search_generated_iac_patterns",
                    {"target": target, "pattern": pattern, "hits": hits},
                )
    return _artifact_payload(
        "search_generated_iac_patterns",
        {"target": target, "pattern": pattern, "hits": hits},
    )


def _build_local_project_tools(settings: Settings, project_id: str) -> list[Any]:
    @tool("get_infra_costs")
    async def get_infra_costs(module_scope: str = "all", refresh: bool = False) -> dict:
        """Return cached infra cost data for the project, optionally forcing a refresh."""
        return await _get_infra_costs(project_id, settings, module_scope, refresh)

    @tool("opentofu_preview_deploy")
    async def opentofu_preview_deploy(intent: str = "") -> dict:
        """Preview OpenTofu deploy targets for this project."""
        return await _opentofu_tool_preview(project_id, settings, intent or None)

    @tool("opentofu_apply_deploy")
    async def opentofu_apply_deploy(
        selected_modules: list[str],
        confirm: bool = False,
        intent: str = "",
        override_policy: bool = False,
    ) -> dict:
        """Apply selected OpenTofu modules after explicit confirmation."""
        return await _opentofu_tool_apply(
            project_id=project_id,
            settings=settings,
            selected_modules=selected_modules,
            confirm=confirm,
            intent=intent or None,
            override_policy=override_policy,
        )

    @tool("ansible_run_config")
    async def ansible_run_config(
        selected_modules: list[str],
        confirm: bool = False,
        intent: str = "",
    ) -> dict:
        """Run Ansible configuration for selected modules after explicit confirmation."""
        return await _ansible_tool_run(
            project_id=project_id,
            settings=settings,
            selected_modules=selected_modules,
            confirm=confirm,
            intent=intent or None,
        )

    @tool("validate_iac_structure")
    async def validate_iac_structure_tool(
        selected_modules: list[str] | None = None,
        require_ansible: bool = True,
    ) -> dict:
        """Validate Terraform + optional Ansible file structure against the template contract."""
        return await _iac_structure_tool_validate(project_id, selected_modules, require_ansible)

    @tool("opentofu_validate_review")
    async def opentofu_validate_review_tool(selected_modules: list[str] | None = None) -> dict:
        """Run OpenTofu init+validate review checks to catch syntax and module-loading errors."""
        return await _opentofu_validate_review(project_id, selected_modules)

    @tool("inspect_opentofu_generated_code")
    async def inspect_opentofu_generated_code(selected_modules: list[str] | None = None) -> dict:
        """Summarize generated OpenTofu files, block counts, and line counts for review evidence."""
        return await _inspect_opentofu_generated_code(project_id, selected_modules)

    @tool("inspect_ansible_generated_code")
    async def inspect_ansible_generated_code(selected_modules: list[str] | None = None) -> dict:
        """Summarize generated Ansible files, task counts, and top-level keys for review evidence."""
        return await _inspect_ansible_generated_code(project_id, selected_modules)

    @tool("search_generated_iac_patterns")
    async def search_generated_iac_patterns(
        pattern: str,
        target: str = "all",
        selected_modules: list[str] | None = None,
        max_results: int = 50,
    ) -> dict:
        """Search generated OpenTofu/Ansible files with a regex pattern to support review findings."""
        return await _search_generated_iac_patterns(project_id, pattern, target, selected_modules, max_results)

    return [
        get_infra_costs,
        opentofu_preview_deploy,
        opentofu_apply_deploy,
        ansible_run_config,
        validate_iac_structure_tool,
        opentofu_validate_review_tool,
        inspect_opentofu_generated_code,
        inspect_ansible_generated_code,
        search_generated_iac_patterns,
    ]


async def _load_opentofu_mcp_tools(settings: Settings) -> tuple[list[Any], bool]:
    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient

        client = MultiServerMCPClient(
            {
                "opentofu": {
                    "transport": "sse",
                    "url": settings.opentofu_mcp_url,
                }
            }
        )
        return list(await client.get_tools()), True
    except Exception:
        logger.warning(
            "OpenTofu MCP unavailable; continuing with local tools only (url=%s)",
            settings.opentofu_mcp_url,
            exc_info=True,
        )
        return [], False


async def build_project_tools(settings: Settings, project_id: str) -> tuple[list[Any], bool]:
    local_tools = _build_local_project_tools(settings, project_id)
    opentofu_tools: list[Any] = []
    opentofu_ready = True
    if settings.opentofu_mcp_enabled:
        opentofu_tools, opentofu_ready = await _load_opentofu_mcp_tools(settings)
    return [*local_tools, *opentofu_tools], opentofu_ready
