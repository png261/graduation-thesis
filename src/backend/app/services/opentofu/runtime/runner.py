"""OpenTofu command execution and streaming."""
from __future__ import annotations

import asyncio
import shutil
from pathlib import Path
from typing import Any, AsyncIterator

from app.core.config import Settings
from app.services.project import credentials as project_credentials
from app.services.project import files as project_files

from .selector import select_modules_for_deploy
from .shared import (
    collect_module_var_files,
    load_project,
    merge_run_env,
    opentofu_env,
    project_lock,
)
from .status import get_opentofu_status


async def _run_command_stream(
    *,
    cmd: list[str],
    cwd: Path,
    env: dict[str, str],
    module: str,
    stage: str,
) -> AsyncIterator[dict[str, Any]]:
    process = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env=env,
    )
    assert process.stdout is not None
    while True:
        raw = await process.stdout.readline()
        if not raw:
            break
        line = raw.decode(errors="replace").rstrip()
        if line:
            yield {"type": "log", "module": module, "stage": stage, "line": line}

    rc = await process.wait()
    yield {"type": "stage.done", "module": module, "stage": stage, "exit_code": rc}


async def run_modules_stream(
    *,
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    run_mode: str,
    intent: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    if run_mode not in {"apply", "plan"}:
        raise ValueError(f"Unsupported run_mode '{run_mode}'")
    event_prefix = "deploy" if run_mode == "apply" else "plan"

    status = await get_opentofu_status(project_id)
    if not status["project_found"]:
        yield {"type": "error", "message": "Project not found"}
        yield {"type": f"{event_prefix}.done", "status": "failed", "results": []}
        return
    if not status["opentofu_available"]:
        yield {"type": "error", "message": "OpenTofu CLI is not available"}
        yield {"type": f"{event_prefix}.done", "status": "failed", "results": []}
        return
    if run_mode == "apply" and not status["credential_ready"]:
        yield {
            "type": "error",
            "message": f"Missing credentials: {', '.join(status['missing_credentials'])}",
        }
        yield {"type": f"{event_prefix}.done", "status": "failed", "results": []}
        return

    discovered = status["modules"]
    requested = [module for module in selected_modules if module in discovered]
    if not requested:
        selection = await select_modules_for_deploy(
            project_id=project_id,
            settings=settings,
            provider=status.get("provider"),
            modules=discovered,
            intent=intent,
        )
        requested = selection["selected_modules"]

    if not requested:
        yield {"type": "error", "message": f"No modules selected for {run_mode}"}
        yield {"type": f"{event_prefix}.done", "status": "failed", "results": []}
        return

    project = await load_project(project_id)
    if project is None or not project.provider:
        yield {"type": "error", "message": "Project provider is not configured"}
        yield {"type": f"{event_prefix}.done", "status": "failed", "results": []}
        return

    creds = project_credentials.parse_credentials(project.credentials)

    tf_env = opentofu_env(project.provider, creds)
    run_env = merge_run_env(tf_env)
    results: list[dict[str, Any]] = []

    lock = project_lock(project_id)
    async with lock:
        project_root = project_files.ensure_project_dir(project_id)
        runtime_root = project_root / ".opentofu-runtime"
        state_root = runtime_root / "state"
        tfdata_root = runtime_root / "tfdata"
        state_root.mkdir(parents=True, exist_ok=True)
        tfdata_root.mkdir(parents=True, exist_ok=True)

        yield {"type": f"{event_prefix}.start", "modules": requested, "intent": intent or ""}
        for module in requested:
            module_dir = project_root / "modules" / module
            if not module_dir.exists():
                results.append({"module": module, "status": "failed", "reason": "Module path not found"})
                yield {"type": "module.done", "module": module, "status": "failed", "reason": "Module path not found"}
                yield {"type": f"{event_prefix}.done", "status": "failed", "results": results}
                return

            tf_data_dir = tfdata_root / module
            if run_mode == "plan" and tf_data_dir.exists():
                # Ensure plan runs don't inherit stale workspace/provider cache from prior runs.
                shutil.rmtree(tf_data_dir, ignore_errors=True)
            tf_data_dir.mkdir(parents=True, exist_ok=True)
            module_env = {**run_env, "TF_DATA_DIR": str(tf_data_dir)}
            state_path = state_root / f"{module}.tfstate"
            var_files = collect_module_var_files(
                project_root=project_root,
                module_dir=module_dir,
                module=module,
            )

            yield {"type": "module.start", "module": module}
            init_ok = True
            init_exit_code = 1
            init_last_log = ""
            init_log_tail: list[str] = []
            init_cmd: list[str] = ["tofu", "init", "-input=false", "-no-color"]
            # Plan mode should not require backend credentials just to evaluate changes.
            if run_mode == "plan":
                init_cmd.insert(2, "-backend=false")
            async for evt in _run_command_stream(
                cmd=init_cmd,
                cwd=module_dir,
                env=module_env,
                module=module,
                stage="init",
            ):
                if evt["type"] == "log":
                    line = str(evt.get("line") or "").strip()
                    if line:
                        init_last_log = line
                        init_log_tail.append(line)
                        if len(init_log_tail) > 6:
                            init_log_tail = init_log_tail[-6:]
                if evt["type"] == "stage.done":
                    raw_exit = evt.get("exit_code", 1)
                    init_exit_code = int(raw_exit) if raw_exit is not None else 1
                    if init_exit_code != 0:
                        init_ok = False
                yield evt
            if not init_ok:
                detail = " | ".join(init_log_tail[-3:]) if init_log_tail else init_last_log
                reason = (
                    f"stage init (exit {init_exit_code})"
                    + (f": {detail}" if detail else "")
                )
                results.append({"module": module, "status": "failed", "stage": "init"})
                yield {
                    "type": "module.done",
                    "module": module,
                    "status": "failed",
                    "stage": "init",
                    "exit_code": init_exit_code,
                    "reason": reason,
                }
                yield {"type": f"{event_prefix}.done", "status": "failed", "results": results}
                return

            run_ok = True
            run_stage = "apply" if run_mode == "apply" else "plan"
            run_exit_code = 1
            run_last_log = ""
            run_cmd: list[str] = (
                [
                    "tofu",
                    "apply",
                    "-auto-approve",
                    "-input=false",
                    "-no-color",
                    f"-state={state_path}",
                ]
                if run_mode == "apply"
                else [
                    "tofu",
                    "plan",
                    "-input=false",
                    "-no-color",
                    "-refresh=false",
                    f"-state={state_path}",
                ]
            )
            for var_file in var_files:
                run_cmd.append(f"-var-file={var_file}")
            if var_files:
                display_paths: list[str] = []
                for var_file in var_files:
                    try:
                        display_paths.append(str(var_file.relative_to(project_root)))
                    except ValueError:
                        display_paths.append(str(var_file))
                yield {
                    "type": "log",
                    "module": module,
                    "stage": run_stage,
                    "line": f"Using var files: {', '.join(display_paths)}",
                }
            async for evt in _run_command_stream(
                cmd=run_cmd,
                cwd=module_dir,
                env=module_env,
                module=module,
                stage=run_stage,
            ):
                if evt["type"] == "log":
                    line = str(evt.get("line") or "").strip()
                    if line:
                        run_last_log = line
                if evt["type"] == "stage.done":
                    raw_exit = evt.get("exit_code", 1)
                    run_exit_code = int(raw_exit) if raw_exit is not None else 1
                    if run_exit_code != 0:
                        run_ok = False
                yield evt
            if not run_ok:
                reason = (
                    f"stage {run_stage} (exit {run_exit_code})"
                    + (f": {run_last_log}" if run_last_log else "")
                )
                results.append({"module": module, "status": "failed", "stage": run_stage})
                yield {
                    "type": "module.done",
                    "module": module,
                    "status": "failed",
                    "stage": run_stage,
                    "exit_code": run_exit_code,
                    "reason": reason,
                }
                yield {"type": f"{event_prefix}.done", "status": "failed", "results": results}
                return

            done_status = "applied" if run_mode == "apply" else "planned"
            results.append({"module": module, "status": done_status})
            yield {"type": "module.done", "module": module, "status": done_status}

    yield {"type": f"{event_prefix}.done", "status": "ok", "results": results}


async def apply_modules_stream(
    *,
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    intent: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    async for event in run_modules_stream(
        project_id=project_id,
        settings=settings,
        selected_modules=selected_modules,
        run_mode="apply",
        intent=intent,
    ):
        yield event


async def plan_modules_stream(
    *,
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    intent: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    async for event in run_modules_stream(
        project_id=project_id,
        settings=settings,
        selected_modules=selected_modules,
        run_mode="plan",
        intent=intent,
    ):
        yield event


async def apply_modules_collect(
    *,
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    intent: str | None = None,
) -> dict[str, Any]:
    """Run apply and return aggregate data for non-stream callers (agent tools)."""
    logs: list[dict[str, Any]] = []
    final: dict[str, Any] = {"status": "failed", "results": []}
    async for event in apply_modules_stream(
        project_id=project_id,
        settings=settings,
        selected_modules=selected_modules,
        intent=intent,
    ):
        logs.append(event)
        if event.get("type") == "deploy.done":
            final = {"status": event.get("status", "failed"), "results": event.get("results", [])}
    return {"final": final, "events": logs}
