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


async def get_graph(
    *,
    project_id: str,
    settings: Settings,
    module_scope: str = "all",
    graph_type: str = "plan",
    refresh: bool = False,
) -> dict[str, Any]:
    _ = settings
    scope = (module_scope or "all").strip() or "all"
    run_type = (graph_type or "plan").strip() or "plan"
    if run_type not in {"plan", "apply", "plan-refresh-only", "plan-destroy"}:
        return {
            "status": "error",
            "code": "invalid_graph_type",
            "message": f"Unsupported graph type '{run_type}'",
            "project_found": True,
        }

    key = cache_key(project_id, scope, run_type)
    if not refresh:
        cached = cache_get(key)
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

    if shutil.which("tofu") is None:
        return {
            "status": "error",
            "code": "tool_unavailable",
            "message": "OpenTofu CLI is not available.",
            "project_found": True,
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

    selected_modules = modules if scope == "all" else [scope]

    creds = project_credentials.parse_credentials(project.credentials)
    run_env = os.environ
    if project.provider:
        try:
            run_env = merge_run_env(opentofu_env(project.provider, creds))
        except ValueError:
            run_env = os.environ

    region = "unknown"
    if project.provider == "aws":
        region = creds.get("aws_region") or "unknown"
    elif project.provider == "gcloud":
        region = creds.get("gcp_region") or "unknown"

    project_root = project_files.ensure_project_dir(project_id)
    runtime_root = project_root / ".opentofu-runtime"
    tfdata_root = runtime_root / "tfdata-graph"
    tfdata_root.mkdir(parents=True, exist_ok=True)

    all_nodes: list[dict[str, Any]] = []
    all_edges: list[dict[str, Any]] = []
    warnings: list[str] = []
    raw_dot_by_module: dict[str, str] = {}

    module_rows_by_name: dict[str, dict[str, Any]] = {
        module_name: {
            "name": module_name,
            "provider": project.provider or "unknown",
            "region": region,
            "resource_count": 0,
            "node_count": 0,
            "edge_count": 0,
            "has_graph": False,
        }
        for module_name in modules
    }

    lock = project_lock(project_id)
    async with lock:
        for module in selected_modules:
            module_dir = project_root / "modules" / module
            if not module_dir.exists():
                warnings.append(f"Module '{module}' does not exist on disk")
                continue

            module_tfdata = tfdata_root / module
            module_tfdata.mkdir(parents=True, exist_ok=True)
            module_env = {**run_env, "TF_DATA_DIR": str(module_tfdata)}

            init_needed = refresh or not _runtime_cache_ready(module_tfdata)
            if init_needed:
                init_rc, _, init_stderr = await _run_command(
                    cmd=["tofu", "init", "-backend=false", "-input=false", "-no-color"],
                    cwd=module_dir,
                    env=module_env,
                )
                if init_rc != 0:
                    reason = init_stderr.strip().splitlines()
                    warnings.append(
                        f"Module '{module}' init failed: {reason[-1] if reason else 'unknown error'}"
                    )
                    continue

            graph_cmd = ["tofu", "graph", f"-type={run_type}"]
            var_files = collect_module_var_files(
                project_root=project_root,
                module_dir=module_dir,
                module=module,
            )
            for var_file in var_files:
                graph_cmd.append(f"-var-file={var_file}")

            rc, stdout, stderr = await _run_command(cmd=graph_cmd, cwd=module_dir, env=module_env)
            if rc != 0 and not init_needed:
                # Retry once with a clean TF_DATA_DIR when stale runtime cache breaks graph rendering.
                shutil.rmtree(module_tfdata, ignore_errors=True)
                module_tfdata.mkdir(parents=True, exist_ok=True)
                module_env = {**run_env, "TF_DATA_DIR": str(module_tfdata)}
                init_rc, _, init_stderr = await _run_command(
                    cmd=["tofu", "init", "-backend=false", "-input=false", "-no-color"],
                    cwd=module_dir,
                    env=module_env,
                )
                if init_rc != 0:
                    reason = init_stderr.strip().splitlines()
                    warnings.append(
                        f"Module '{module}' init failed: {reason[-1] if reason else 'unknown error'}"
                    )
                    continue
                rc, stdout, stderr = await _run_command(cmd=graph_cmd, cwd=module_dir, env=module_env)
            if rc != 0:
                tail = stderr.strip().splitlines()
                warnings.append(
                    f"Module '{module}' graph failed: {tail[-1] if tail else f'exit code {rc}'}"
                )
                continue

            raw_dot_by_module[module] = stdout
            parsed_nodes, parsed_edges = parse_dot(stdout)
            if not parsed_nodes and not parsed_edges:
                warnings.append(f"Module '{module}' returned an empty graph")
                continue

            raw_to_scoped: dict[str, str] = {}
            for node in parsed_nodes:
                raw_id = node["raw_id"]
                scoped_id = f"{module}::{raw_id}"
                raw_to_scoped[raw_id] = scoped_id

            in_degree: dict[str, int] = {}
            out_degree: dict[str, int] = {}
            for edge in parsed_edges:
                source = raw_to_scoped.get(edge["source"])
                target = raw_to_scoped.get(edge["target"])
                if not source or not target:
                    continue
                out_degree[source] = out_degree.get(source, 0) + 1
                in_degree[target] = in_degree.get(target, 0) + 1

            module_resource_count = 0
            for node in parsed_nodes:
                raw_id = node["raw_id"]
                scoped_id = raw_to_scoped[raw_id]
                kind, resource_type, resource_name, address = derive_node_metadata(raw_id, node["label"])
                if kind == "resource":
                    module_resource_count += 1

                all_nodes.append(
                    {
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
                            "provider": project.provider or "unknown",
                            "region": region,
                        },
                    }
                )

            for idx, edge in enumerate(parsed_edges):
                source = raw_to_scoped.get(edge["source"])
                target = raw_to_scoped.get(edge["target"])
                if not source or not target:
                    continue
                all_edges.append(
                    {
                        "id": f"{module}:edge:{idx}:{source}:{target}",
                        "source": source,
                        "target": target,
                        "module": module,
                        "kind": "dependency",
                    }
                )

            module_rows_by_name[module].update(
                {
                    "resource_count": module_resource_count,
                    "node_count": len(parsed_nodes),
                    "edge_count": len(parsed_edges),
                    "has_graph": True,
                }
            )

    all_nodes.sort(key=lambda item: (item["module"], item["kind"], item["label"]))
    all_edges.sort(key=lambda item: (item["module"], item["source"], item["target"]))
    module_rows = [module_rows_by_name[module_name] for module_name in modules]

    graph_payload = {
        "modules": module_rows,
        "nodes": all_nodes,
        "edges": all_edges,
        "stats": _build_stats(module_rows, all_nodes, all_edges),
        "indexes": _build_indexes(all_nodes, all_edges),
    }
    generated_at = utcnow_iso()
    etag = _compute_etag(
        {
            "scope": scope,
            "type": run_type,
            "graph": graph_payload,
            "warnings": warnings,
        }
    )

    result: dict[str, Any] = {
        "version": _GRAPH_PAYLOAD_VERSION,
        "snapshot": {
            "generated_at": generated_at,
            "scope": scope,
            "type": run_type,
            "etag": etag,
        },
        "graph": graph_payload,
        "warnings": warnings,
    }

    if refresh and raw_dot_by_module:
        result["raw_dot"] = {module_name: raw_dot_by_module[module_name] for module_name in sorted(raw_dot_by_module)}

    cache_set(key, result)
    return result
