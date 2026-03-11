"""Generate Terraform/OpenTofu dependency graph data for UI rendering."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
from collections import defaultdict
from pathlib import Path
from typing import Any

from app.core.config import Settings
from app.services.project import credentials as project_credentials
from app.services.project import files as project_files

from .graph_cache import cache_get, cache_key, cache_set, utcnow_iso
from .graph_dot import derive_node_metadata, parse_dot
from .shared import (
    collect_module_var_files,
    discover_modules_from_project_dir,
    load_project,
    merge_run_env,
    opentofu_env,
    project_lock,
)

_GRAPH_PAYLOAD_VERSION = "2"


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


def _runtime_cache_ready(tfdata_dir: Path) -> bool:
    if not tfdata_dir.exists():
        return False
    terraform_dir = tfdata_dir / ".terraform"
    if terraform_dir.exists():
        return True
    return any(tfdata_dir.iterdir())


def _compute_etag(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:16]


def _build_indexes(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, dict[str, list[str]]]:
    nodes_by_module: dict[str, list[str]] = defaultdict(list)
    nodes_by_kind: dict[str, list[str]] = defaultdict(list)
    outgoing: dict[str, list[str]] = defaultdict(list)
    incoming: dict[str, list[str]] = defaultdict(list)

    for node in nodes:
        node_id = str(node.get("id") or "")
        if not node_id:
            continue
        module = str(node.get("module") or "unknown")
        kind = str(node.get("kind") or "other")
        nodes_by_module[module].append(node_id)
        nodes_by_kind[kind].append(node_id)

    for edge in edges:
        source = str(edge.get("source") or "")
        target = str(edge.get("target") or "")
        if not source or not target:
            continue
        outgoing[source].append(target)
        incoming[target].append(source)

    for mapping in (nodes_by_module, nodes_by_kind, outgoing, incoming):
        for key, values in mapping.items():
            values.sort()

    return {
        "nodes_by_module": dict(sorted(nodes_by_module.items())),
        "nodes_by_kind": dict(sorted(nodes_by_kind.items())),
        "outgoing": dict(sorted(outgoing.items())),
        "incoming": dict(sorted(incoming.items())),
    }


def _build_stats(
    modules: list[dict[str, Any]],
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> dict[str, Any]:
    kind_counts: dict[str, int] = defaultdict(int)
    resource_count = 0
    for node in nodes:
        kind = str(node.get("kind") or "other")
        kind_counts[kind] += 1
        if kind == "resource":
            resource_count += 1

    return {
        "module_count": len(modules),
        "node_count": len(nodes),
        "edge_count": len(edges),
        "resource_count": resource_count,
        "kind_counts": dict(sorted(kind_counts.items())),
    }


def _graph_error(
    code: str,
    message: str,
    *,
    project_found: bool,
    available_modules: list[str] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": "error",
        "code": code,
        "message": message,
        "project_found": project_found,
    }
    if available_modules is not None:
        payload["available_modules"] = available_modules
    return payload


def _normalize_scope(module_scope: str) -> str:
    return (module_scope or "all").strip() or "all"


def _normalize_run_type(graph_type: str) -> str:
    return (graph_type or "plan").strip() or "plan"


def _invalid_graph_type_error(run_type: str) -> dict[str, Any] | None:
    valid_types = {"plan", "apply", "plan-refresh-only", "plan-destroy"}
    if run_type in valid_types:
        return None
    return _graph_error(
        "invalid_graph_type",
        f"Unsupported graph type '{run_type}'",
        project_found=True,
    )


def _cached_graph_result(key: str, refresh: bool) -> dict[str, Any] | None:
    if refresh:
        return None
    return cache_get(key)


def _tofu_unavailable_error() -> dict[str, Any] | None:
    if shutil.which("tofu") is not None:
        return None
    return _graph_error("tool_unavailable", "OpenTofu CLI is not available.", project_found=True)


def _provider_region(provider: str | None, creds: dict[str, str]) -> str:
    if provider == "aws":
        return creds.get("aws_region") or "unknown"
    if provider == "gcloud":
        return creds.get("gcp_region") or "unknown"
    return "unknown"


def _project_run_env(project: Any) -> tuple[dict[str, str], str, str]:
    creds = project_credentials.parse_credentials(project.credentials)
    provider = project.provider or "unknown"
    run_env: dict[str, str] = os.environ
    if project.provider:
        try:
            run_env = merge_run_env(opentofu_env(project.provider, creds))
        except ValueError:
            run_env = os.environ
    return run_env, provider, _provider_region(project.provider, creds)


def _ensure_graph_runtime_dirs(project_id: str) -> tuple[Path, Path]:
    project_root = project_files.ensure_project_dir(project_id)
    tfdata_root = project_root / ".opentofu-runtime" / "tfdata-graph"
    tfdata_root.mkdir(parents=True, exist_ok=True)
    return project_root, tfdata_root


def _module_rows_template(modules: list[str], provider: str, region: str) -> dict[str, dict[str, Any]]:
    return {
        module_name: {
            "name": module_name,
            "provider": provider,
            "region": region,
            "resource_count": 0,
            "node_count": 0,
            "edge_count": 0,
            "has_graph": False,
        }
        for module_name in modules
    }


async def _graph_context_or_error(
    *,
    project_id: str,
    scope: str,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    project = await load_project(project_id)
    if project is None:
        return None, _graph_error("project_not_found", "Project not found", project_found=False)
    tofu_error = _tofu_unavailable_error()
    if tofu_error is not None:
        return None, tofu_error
    modules = discover_modules_from_project_dir(project_id)
    if scope != "all" and scope not in modules:
        return None, _graph_error("invalid_module", f"Unknown module '{scope}'", project_found=True, available_modules=modules)
    project_root, tfdata_root = _ensure_graph_runtime_dirs(project_id)
    run_env, provider, region = _project_run_env(project)
    return {
        "modules": modules,
        "selected_modules": modules if scope == "all" else [scope],
        "project_root": project_root,
        "tfdata_root": tfdata_root,
        "run_env": run_env,
        "provider": provider,
        "region": region,
    }, None


def _tofu_graph_command(run_type: str, var_files: list[Path]) -> list[str]:
    cmd = ["tofu", "graph", f"-type={run_type}"]
    for var_file in var_files:
        cmd.append(f"-var-file={var_file}")
    return cmd


async def _tofu_init(module_dir: Path, module_env: dict[str, str]) -> tuple[bool, str]:
    rc, _, stderr = await _run_command(
        cmd=["tofu", "init", "-backend=false", "-input=false", "-no-color"],
        cwd=module_dir,
        env=module_env,
    )
    if rc == 0:
        return True, ""
    reason = stderr.strip().splitlines()
    return False, reason[-1] if reason else "unknown error"


def _module_init_warning(module: str, reason: str) -> str:
    return f"Module '{module}' init failed: {reason}"


def _module_graph_warning(module: str, rc: int, stderr: str) -> str:
    tail = stderr.strip().splitlines()
    reason = tail[-1] if tail else f"exit code {rc}"
    return f"Module '{module}' graph failed: {reason}"


async def _retry_graph_with_clean_cache(
    *,
    module: str,
    module_dir: Path,
    module_tfdata: Path,
    run_env: dict[str, str],
    graph_cmd: list[str],
) -> tuple[str | None, str | None]:
    shutil.rmtree(module_tfdata, ignore_errors=True)
    module_tfdata.mkdir(parents=True, exist_ok=True)
    module_env = {**run_env, "TF_DATA_DIR": str(module_tfdata)}
    init_ok, init_reason = await _tofu_init(module_dir, module_env)
    if not init_ok:
        return None, _module_init_warning(module, init_reason)
    rc, stdout, stderr = await _run_command(cmd=graph_cmd, cwd=module_dir, env=module_env)
    if rc != 0:
        return None, _module_graph_warning(module, rc, stderr)
    return stdout, None


async def _module_dot_or_warning(
    *,
    module: str,
    project_root: Path,
    tfdata_root: Path,
    run_env: dict[str, str],
    run_type: str,
    refresh: bool,
) -> tuple[str | None, str | None]:
    module_dir = project_root / "modules" / module
    if not module_dir.exists():
        return None, f"Module '{module}' does not exist on disk"
    module_tfdata = tfdata_root / module
    module_tfdata.mkdir(parents=True, exist_ok=True)
    module_env = {**run_env, "TF_DATA_DIR": str(module_tfdata)}
    init_needed = refresh or not _runtime_cache_ready(module_tfdata)
    if init_needed:
        init_ok, init_reason = await _tofu_init(module_dir, module_env)
        if not init_ok:
            return None, _module_init_warning(module, init_reason)
    graph_cmd = _tofu_graph_command(run_type, collect_module_var_files(project_root=project_root, module_dir=module_dir, module=module))
    rc, stdout, stderr = await _run_command(cmd=graph_cmd, cwd=module_dir, env=module_env)
    if rc == 0:
        return stdout, None
    if init_needed:
        return None, _module_graph_warning(module, rc, stderr)
    return await _retry_graph_with_clean_cache(module=module, module_dir=module_dir, module_tfdata=module_tfdata, run_env=run_env, graph_cmd=graph_cmd)


def _scoped_node_ids(module: str, parsed_nodes: list[dict[str, str]]) -> dict[str, str]:
    return {node["raw_id"]: f"{module}::{node['raw_id']}" for node in parsed_nodes}


def _degree_maps(parsed_edges: list[dict[str, str]], raw_to_scoped: dict[str, str]) -> tuple[dict[str, int], dict[str, int]]:
    in_degree: dict[str, int] = {}
    out_degree: dict[str, int] = {}
    for edge in parsed_edges:
        source = raw_to_scoped.get(edge["source"])
        target = raw_to_scoped.get(edge["target"])
        if not source or not target:
            continue
        out_degree[source] = out_degree.get(source, 0) + 1
        in_degree[target] = in_degree.get(target, 0) + 1
    return in_degree, out_degree


def _module_node_rows(
    *,
    module: str,
    parsed_nodes: list[dict[str, str]],
    raw_to_scoped: dict[str, str],
    in_degree: dict[str, int],
    out_degree: dict[str, int],
    provider: str,
    region: str,
) -> tuple[list[dict[str, Any]], int]:
    rows: list[dict[str, Any]] = []
    resource_count = 0
    for node in parsed_nodes:
        row, is_resource = _node_row(
            module=module,
            node=node,
            raw_to_scoped=raw_to_scoped,
            in_degree=in_degree,
            out_degree=out_degree,
            provider=provider,
            region=region,
        )
        resource_count += 1 if is_resource else 0
        rows.append(row)
    return rows, resource_count


def _node_row(
    *,
    module: str,
    node: dict[str, str],
    raw_to_scoped: dict[str, str],
    in_degree: dict[str, int],
    out_degree: dict[str, int],
    provider: str,
    region: str,
) -> tuple[dict[str, Any], bool]:
    raw_id = node["raw_id"]
    scoped_id = raw_to_scoped[raw_id]
    kind, resource_type, resource_name, address = derive_node_metadata(raw_id, node["label"])
    row = {
        "id": scoped_id,
        "module": module,
        "label": node["label"],
        "kind": kind,
        "resource_type": resource_type,
        "resource_name": resource_name,
        "address": address,
        "meta": {
            "raw_id": raw_id,
            "in_degree": in_degree.get(scoped_id, 0),
            "out_degree": out_degree.get(scoped_id, 0),
            "provider": provider,
            "region": region,
        },
    }
    return row, kind == "resource"


def _module_edge_rows(module: str, parsed_edges: list[dict[str, str]], raw_to_scoped: dict[str, str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for idx, edge in enumerate(parsed_edges):
        source = raw_to_scoped.get(edge["source"])
        target = raw_to_scoped.get(edge["target"])
        if not source or not target:
            continue
        rows.append(
            {"id": f"{module}:edge:{idx}:{source}:{target}", "source": source, "target": target, "module": module, "kind": "dependency"}
        )
    return rows


def _module_graph_payload(
    *,
    module: str,
    dot_output: str,
    provider: str,
    region: str,
) -> tuple[dict[str, Any] | None, str | None]:
    parsed_nodes, parsed_edges = parse_dot(dot_output)
    if not parsed_nodes and not parsed_edges:
        return None, f"Module '{module}' returned an empty graph"
    raw_to_scoped = _scoped_node_ids(module, parsed_nodes)
    in_degree, out_degree = _degree_maps(parsed_edges, raw_to_scoped)
    node_rows, resource_count = _module_node_rows(
        module=module,
        parsed_nodes=parsed_nodes,
        raw_to_scoped=raw_to_scoped,
        in_degree=in_degree,
        out_degree=out_degree,
        provider=provider,
        region=region,
    )
    edge_rows = _module_edge_rows(module, parsed_edges, raw_to_scoped)
    return {
        "raw_dot": dot_output,
        "nodes": node_rows,
        "edges": edge_rows,
        "resource_count": resource_count,
        "node_count": len(parsed_nodes),
        "edge_count": len(parsed_edges),
    }, None


async def _collect_graph_data(
    *,
    project_id: str,
    context: dict[str, Any],
    run_type: str,
    refresh: bool,
    module_rows_by_name: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str], dict[str, str]]:
    all_nodes: list[dict[str, Any]] = []
    all_edges: list[dict[str, Any]] = []
    warnings: list[str] = []
    raw_dot_by_module: dict[str, str] = {}
    async with project_lock(project_id):
        for module in context["selected_modules"]:
            dot_output, warning = await _module_dot_or_warning(module=module, project_root=context["project_root"], tfdata_root=context["tfdata_root"], run_env=context["run_env"], run_type=run_type, refresh=refresh)
            if warning is not None or dot_output is None:
                warnings.append(warning or f"Module '{module}' graph failed")
                continue
            payload, payload_warning = _module_graph_payload(module=module, dot_output=dot_output, provider=context["provider"], region=context["region"])
            if payload_warning is not None or payload is None:
                warnings.append(payload_warning or f"Module '{module}' returned invalid graph")
                continue
            raw_dot_by_module[module] = payload["raw_dot"]
            all_nodes.extend(payload["nodes"])
            all_edges.extend(payload["edges"])
            module_rows_by_name[module].update({k: payload[k] for k in ("resource_count", "node_count", "edge_count")})
            module_rows_by_name[module]["has_graph"] = True
    return all_nodes, all_edges, warnings, raw_dot_by_module


def _graph_payload(
    modules: list[str],
    module_rows_by_name: dict[str, dict[str, Any]],
    all_nodes: list[dict[str, Any]],
    all_edges: list[dict[str, Any]],
) -> dict[str, Any]:
    all_nodes.sort(key=lambda item: (item["module"], item["kind"], item["label"]))
    all_edges.sort(key=lambda item: (item["module"], item["source"], item["target"]))
    module_rows = [module_rows_by_name[module_name] for module_name in modules]
    return {
        "modules": module_rows,
        "nodes": all_nodes,
        "edges": all_edges,
        "stats": _build_stats(module_rows, all_nodes, all_edges),
        "indexes": _build_indexes(all_nodes, all_edges),
    }


def _graph_result(
    *,
    scope: str,
    run_type: str,
    graph_payload: dict[str, Any],
    warnings: list[str],
    refresh: bool,
    raw_dot_by_module: dict[str, str],
) -> dict[str, Any]:
    generated_at = utcnow_iso()
    etag = _compute_etag({"scope": scope, "type": run_type, "graph": graph_payload, "warnings": warnings})
    result: dict[str, Any] = {
        "version": _GRAPH_PAYLOAD_VERSION,
        "snapshot": {"generated_at": generated_at, "scope": scope, "type": run_type, "etag": etag},
        "graph": graph_payload,
        "warnings": warnings,
    }
    if refresh and raw_dot_by_module:
        result["raw_dot"] = {name: raw_dot_by_module[name] for name in sorted(raw_dot_by_module)}
    return result


async def get_graph(
    *,
    project_id: str,
    settings: Settings,
    module_scope: str = "all",
    graph_type: str = "plan",
    refresh: bool = False,
) -> dict[str, Any]:
    _ = settings
    scope = _normalize_scope(module_scope)
    run_type = _normalize_run_type(graph_type)
    validation_error = _invalid_graph_type_error(run_type)
    if validation_error is not None:
        return validation_error
    key = cache_key(project_id, scope, run_type)
    cached = _cached_graph_result(key, refresh)
    if cached is not None:
        return cached
    context, context_error = await _graph_context_or_error(project_id=project_id, scope=scope)
    if context_error is not None or context is None:
        return context_error or _graph_error("unknown", "Unknown graph error", project_found=True)
    modules = context["modules"]
    module_rows_by_name = _module_rows_template(modules, context["provider"], context["region"])
    all_nodes, all_edges, warnings, raw_dot_by_module = await _collect_graph_data(project_id=project_id, context=context, run_type=run_type, refresh=refresh, module_rows_by_name=module_rows_by_name)
    graph_payload = _graph_payload(modules, module_rows_by_name, all_nodes, all_edges)
    result = _graph_result(scope=scope, run_type=run_type, graph_payload=graph_payload, warnings=warnings, refresh=refresh, raw_dot_by_module=raw_dot_by_module)
    cache_set(key, result)
    return result
