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


def _event_prefix(run_mode: str) -> str:
    return "deploy" if run_mode == "apply" else "plan"


def _done_event(event_prefix: str, status: str, results: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": f"{event_prefix}.done", "status": status, "results": results}


def _failure_events(event_prefix: str, message: str) -> list[dict[str, Any]]:
    return [{"type": "error", "message": message}, _done_event(event_prefix, "failed", [])]


def _status_failure_events(status: dict[str, Any], event_prefix: str, run_mode: str) -> list[dict[str, Any]] | None:
    if not status["project_found"]:
        return _failure_events(event_prefix, "Project not found")
    if not status["opentofu_available"]:
        return _failure_events(event_prefix, "OpenTofu CLI is not available")
    if run_mode == "apply" and not status["credential_ready"]:
        missing = ", ".join(status["missing_credentials"])
        return _failure_events(event_prefix, f"Missing credentials: {missing}")
    return None


async def _resolve_requested_modules(
    *,
    project_id: str,
    settings: Settings,
    status: dict[str, Any],
    selected_modules: list[str],
    intent: str | None,
) -> list[str]:
    discovered = status["modules"]
    requested = [module for module in selected_modules if module in discovered]
    if requested:
        return requested
    selection = await select_modules_for_deploy(
        project_id=project_id,
        settings=settings,
        provider=status.get("provider"),
        modules=discovered,
        intent=intent,
    )
    return selection["selected_modules"]


async def _runtime_context_or_error(project_id: str, run_mode: str) -> tuple[dict[str, Any] | None, str | None]:
    project = await load_project(project_id)
    if project is None or not project.provider:
        return None, "Project provider is not configured"
    creds = project_credentials.parse_credentials(project.credentials)
    run_env = merge_run_env(opentofu_env(project.provider, creds))
    project_root = project_files.ensure_project_dir(project_id)
    runtime_root = project_root / ".opentofu-runtime"
    state_root = runtime_root / "state"
    tfdata_root = runtime_root / "tfdata"
    state_root.mkdir(parents=True, exist_ok=True)
    tfdata_root.mkdir(parents=True, exist_ok=True)
    return {"project_root": project_root, "state_root": state_root, "tfdata_root": tfdata_root, "run_env": run_env, "run_mode": run_mode}, None


async def _stream_context_or_failure(
    *,
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    run_mode: str,
    intent: str | None,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]] | None]:
    event_prefix = _event_prefix(run_mode)
    status = await get_opentofu_status(project_id)
    failure = _status_failure_events(status, event_prefix, run_mode)
    if failure is not None:
        return None, failure
    requested = await _resolve_requested_modules(project_id=project_id, settings=settings, status=status, selected_modules=selected_modules, intent=intent)
    if not requested:
        return None, _failure_events(event_prefix, f"No modules selected for {run_mode}")
    runtime, error_message = await _runtime_context_or_error(project_id, run_mode)
    if error_message is not None:
        return None, _failure_events(event_prefix, error_message)
    return {"event_prefix": event_prefix, "requested": requested, "runtime": runtime or {}, "intent": intent or ""}, None


def _init_command(run_mode: str) -> list[str]:
    cmd = ["tofu", "init", "-input=false", "-no-color"]
    if run_mode == "plan":
        cmd.insert(2, "-backend=false")
    return cmd


def _run_command(run_mode: str, state_path: Path, var_files: list[Path]) -> list[str]:
    base_cmd = (
        ["tofu", "apply", "-auto-approve", "-input=false", "-no-color", f"-state={state_path}"]
        if run_mode == "apply"
        else ["tofu", "plan", "-input=false", "-no-color", "-refresh=false", f"-state={state_path}"]
    )
    for var_file in var_files:
        base_cmd.append(f"-var-file={var_file}")
    return base_cmd


def _var_files_log_event(module: str, run_stage: str, var_files: list[Path], project_root: Path) -> dict[str, Any] | None:
    if not var_files:
        return None
    display_paths: list[str] = []
    for var_file in var_files:
        try:
            display_paths.append(str(var_file.relative_to(project_root)))
        except ValueError:
            display_paths.append(str(var_file))
    return {"type": "log", "module": module, "stage": run_stage, "line": f"Using var files: {', '.join(display_paths)}"}


def _new_stage_state(*, track_tail: bool) -> dict[str, Any]:
    return {"ok": True, "exit_code": 1, "last_log": "", "tail": [], "track_tail": track_tail}


def _record_stage_event(state: dict[str, Any], evt: dict[str, Any]) -> None:
    if evt["type"] == "log":
        line = str(evt.get("line") or "").strip()
        if not line:
            return
        state["last_log"] = line
        if not state["track_tail"]:
            return
        state["tail"].append(line)
        if len(state["tail"]) > 6:
            state["tail"] = state["tail"][-6:]
        return
    if evt["type"] == "stage.done":
        raw_exit = evt.get("exit_code", 1)
        state["exit_code"] = int(raw_exit) if raw_exit is not None else 1
        state["ok"] = state["exit_code"] == 0


async def _stream_stage(
    *,
    cmd: list[str],
    cwd: Path,
    env: dict[str, str],
    module: str,
    stage: str,
    state: dict[str, Any],
) -> AsyncIterator[dict[str, Any]]:
    async for evt in _run_command_stream(cmd=cmd, cwd=cwd, env=env, module=module, stage=stage):
        _record_stage_event(state, evt)
        yield evt


def _stage_failure_reason(stage: str, state: dict[str, Any], *, use_tail: bool) -> str:
    detail = " | ".join(state["tail"][-3:]) if use_tail and state["tail"] else state["last_log"]
    prefix = f"stage {stage} (exit {state['exit_code']})"
    return f"{prefix}: {detail}" if detail else prefix


def _module_done_failure(module: str, stage: str, state: dict[str, Any], *, use_tail: bool) -> dict[str, Any]:
    return {
        "type": "module.done",
        "module": module,
        "status": "failed",
        "stage": stage,
        "exit_code": state["exit_code"],
        "reason": _stage_failure_reason(stage, state, use_tail=use_tail),
    }


def _missing_module_event(module: str) -> dict[str, Any]:
    return {"type": "module.done", "module": module, "status": "failed", "reason": "Module path not found"}


def _module_success_event(module: str, run_mode: str) -> dict[str, Any]:
    return {"type": "module.done", "module": module, "status": "applied" if run_mode == "apply" else "planned"}


def _module_result(evt: dict[str, Any], module: str) -> dict[str, Any]:
    status = str(evt.get("status") or "failed")
    if status != "failed":
        return {"module": module, "status": status}
    if evt.get("stage"):
        return {"module": module, "status": "failed", "stage": evt["stage"]}
    return {"module": module, "status": "failed", "reason": evt.get("reason", "Module failed")}


def _module_runtime_context(
    *,
    runtime: dict[str, Any],
    module: str,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    project_root = runtime["project_root"]
    module_dir = project_root / "modules" / module
    if not module_dir.exists():
        return None, _missing_module_event(module)
    tf_data_dir = runtime["tfdata_root"] / module
    if runtime["run_mode"] == "plan" and tf_data_dir.exists():
        shutil.rmtree(tf_data_dir, ignore_errors=True)
    tf_data_dir.mkdir(parents=True, exist_ok=True)
    module_env = {**runtime["run_env"], "TF_DATA_DIR": str(tf_data_dir)}
    state_path = runtime["state_root"] / f"{module}.tfstate"
    var_files = collect_module_var_files(project_root=project_root, module_dir=module_dir, module=module)
    return {"module_dir": module_dir, "module_env": module_env, "state_path": state_path, "var_files": var_files}, None


async def _stream_module_events(
    *,
    runtime: dict[str, Any],
    module: str,
) -> AsyncIterator[dict[str, Any]]:
    module_ctx, missing_evt = _module_runtime_context(runtime=runtime, module=module)
    if missing_evt is not None:
        yield missing_evt
        return
    assert module_ctx is not None
    yield {"type": "module.start", "module": module}
    init_state = _new_stage_state(track_tail=True)
    async for evt in _stream_stage(cmd=_init_command(runtime["run_mode"]), cwd=module_ctx["module_dir"], env=module_ctx["module_env"], module=module, stage="init", state=init_state):
        yield evt
    if not init_state["ok"]:
        yield _module_done_failure(module, "init", init_state, use_tail=True)
        return
    run_stage = "apply" if runtime["run_mode"] == "apply" else "plan"
    var_log = _var_files_log_event(module, run_stage, module_ctx["var_files"], runtime["project_root"])
    if var_log is not None:
        yield var_log
    run_state = _new_stage_state(track_tail=False)
    run_cmd = _run_command(runtime["run_mode"], module_ctx["state_path"], module_ctx["var_files"])
    async for evt in _stream_stage(cmd=run_cmd, cwd=module_ctx["module_dir"], env=module_ctx["module_env"], module=module, stage=run_stage, state=run_state):
        yield evt
    if not run_state["ok"]:
        yield _module_done_failure(module, run_stage, run_state, use_tail=False)
        return
    yield _module_success_event(module, runtime["run_mode"])


async def _stream_orchestration(project_id: str, stream_context: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
    event_prefix = stream_context["event_prefix"]
    requested = stream_context["requested"]
    runtime = stream_context["runtime"]
    results: list[dict[str, Any]] = []
    async with project_lock(project_id):
        yield {"type": f"{event_prefix}.start", "modules": requested, "intent": stream_context["intent"]}
        for module in requested:
            module_failed = False
            async for event in _stream_module_events(runtime=runtime, module=module):
                if event["type"] == "module.done":
                    results.append(_module_result(event, module))
                    module_failed = event.get("status") == "failed"
                yield event
            if module_failed:
                yield _done_event(event_prefix, "failed", results)
                return
    yield _done_event(event_prefix, "ok", results)


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
    stream_context, failure_events = await _stream_context_or_failure(
        project_id=project_id,
        settings=settings,
        selected_modules=selected_modules,
        run_mode=run_mode,
        intent=intent,
    )
    if failure_events is not None:
        for event in failure_events:
            yield event
        return
    assert stream_context is not None
    async for event in _stream_orchestration(project_id, stream_context):
        yield event


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
