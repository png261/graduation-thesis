"""Ansible command execution and streaming runtime."""

from __future__ import annotations

import asyncio
import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable
from uuid import uuid4

from app.core.config import Settings
from app.services.opentofu.runtime.shared import (
    discover_modules_from_project_dir,
    load_project,
    merge_run_env,
    opentofu_env,
    project_lock,
)
from app.services.project import credentials as project_credentials

from .inventory import AnsibleHost, AnsibleInventoryError, build_inventory_ini, parse_ansible_hosts_output
from .shared import (
    ansible_available,
    ansible_run_env,
    resolve_playbook_path,
    resolve_project_root,
    resolve_ssh_key_path,
)

_RECAP_RE = re.compile(
    r"^\s*(?P<host>[A-Za-z0-9_.-]+)\s*:\s*ok=(?P<ok>\d+)\s+changed=(?P<changed>\d+)\s+"
    r"unreachable=(?P<unreachable>\d+)\s+failed=(?P<failed>\d+)"
)
_UNREACHABLE_BACKOFFS = (5, 15, 30)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _run_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"{stamp}-{uuid4().hex[:8]}"


def _failure_event(message: str, *, code: str = "config_failed") -> list[dict[str, Any]]:
    return [
        {"type": "error", "code": code, "message": message},
        {"type": "config.done", "status": "failed", "results": []},
    ]


def _latest_run_path(project_root: Path) -> Path:
    return project_root / ".ansible-runtime" / "latest-run.json"


def _history_path(project_root: Path) -> Path:
    return project_root / ".ansible-runtime" / "history.jsonl"


def _write_latest_run_summary(
    *,
    project_root: Path,
    run_id: str,
    status: str,
    attempts: int,
    modules: list[str],
    results: list[dict[str, Any]],
    host_count: int,
    finished_at: str,
) -> None:
    target = _latest_run_path(project_root)
    history = _history_path(project_root)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "run_id": run_id,
            "status": status,
            "attempts": attempts,
            "modules": modules,
            "host_count": host_count,
            "results": results,
            "finished_at": finished_at,
        }
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        with history.open("a", encoding="utf-8") as history_file:
            history_file.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError:
        return


async def _run_command_stream(
    *,
    cmd: list[str],
    cwd: Path,
    env: dict[str, str],
    cancel_checker: Callable[[], Awaitable[bool]] | None = None,
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
        if cancel_checker is not None and await cancel_checker():
            if process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=3.0)
                except asyncio.TimeoutError:
                    process.kill()
                    await process.wait()
            yield {"type": "exit", "exit_code": 130}
            return
        try:
            raw = await asyncio.wait_for(process.stdout.readline(), timeout=1.0)
        except asyncio.TimeoutError:
            continue
        if not raw:
            break
        line = raw.decode(errors="replace").rstrip()
        if line:
            yield {"type": "line", "line": line}

    rc = await process.wait()
    yield {"type": "exit", "exit_code": rc}


def _ansible_runner_available() -> bool:
    try:
        import ansible_runner  # noqa: F401
    except Exception:
        return False
    return True


async def _run_ansible_runner_stream(
    *,
    runtime_root: Path,
    playbook_path: Path,
    inventory_path: Path,
    env: dict[str, str],
    ssh_common_args: str,
    cancel_checker: Callable[[], Awaitable[bool]] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    cancel_event = threading.Event()
    loop = asyncio.get_running_loop()

    def _publish(item: dict[str, Any] | None) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, item)

    def _event_handler(event: dict[str, Any]) -> bool:
        stdout = str(event.get("stdout") or "").strip()
        if stdout:
            _publish({"type": "line", "line": stdout})
        return not cancel_event.is_set()

    def _run() -> None:
        try:
            import ansible_runner

            cmdline = f"--ssh-common-args {ssh_common_args.strip()}" if ssh_common_args.strip() else None
            result = ansible_runner.interface.run(
                private_data_dir=str(runtime_root),
                playbook=str(playbook_path),
                inventory=str(inventory_path),
                envvars=env,
                cmdline=cmdline,
                event_handler=_event_handler,
                cancel_callback=lambda: cancel_event.is_set(),
                quiet=True,
            )
            rc = getattr(result, "rc", None)
            exit_code = int(rc) if rc is not None else 1
            _publish({"type": "exit", "exit_code": exit_code})
        except Exception as exc:
            _publish({"type": "line", "line": str(exc) or "ansible_runner_failed"})
            _publish({"type": "exit", "exit_code": 1})
        finally:
            _publish(None)

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    while True:
        if cancel_checker is not None and await cancel_checker():
            cancel_event.set()
        try:
            item = await asyncio.wait_for(queue.get(), timeout=1.0)
        except asyncio.TimeoutError:
            if not thread.is_alive():
                break
            continue
        if item is None:
            break
        yield item


def _parse_recap(lines: list[str]) -> dict[str, dict[str, int]]:
    recap: dict[str, dict[str, int]] = {}
    for line in lines:
        match = _RECAP_RE.match(line)
        if not match:
            continue
        recap[match.group("host")] = {
            "ok": int(match.group("ok")),
            "changed": int(match.group("changed")),
            "unreachable": int(match.group("unreachable")),
            "failed": int(match.group("failed")),
        }
    return recap


def _host_status(row: dict[str, int]) -> str:
    if row["failed"] > 0:
        return "failed"
    if row["unreachable"] > 0:
        return "unreachable"
    return "ok"


def _merge_host_results(
    aggregate: dict[str, dict[str, int]],
    recap: dict[str, dict[str, int]],
) -> dict[str, dict[str, int]]:
    merged = dict(aggregate)
    merged.update(recap)
    return merged


def _unreachable_hosts(recap: dict[str, dict[str, int]]) -> list[str]:
    return [host for host, row in recap.items() if row["unreachable"] > 0]


def _failed_hosts(recap: dict[str, dict[str, int]]) -> list[str]:
    return [host for host, row in recap.items() if row["failed"] > 0]


def _results_payload(recap: dict[str, dict[str, int]]) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for host in sorted(recap.keys()):
        row = recap[host]
        payload.append(
            {
                "host": host,
                "status": _host_status(row),
                "ok": row["ok"],
                "changed": row["changed"],
                "unreachable": row["unreachable"],
                "failed": row["failed"],
            }
        )
    return payload


async def _load_module_output(
    *,
    module: str,
    module_dir: Path,
    state_path: Path,
    run_env: dict[str, str],
) -> tuple[dict[str, Any] | None, str | None]:
    cmd = ["tofu", "output", "-json", f"-state={state_path}"]
    chunks: list[str] = []
    rc = 1
    async for event in _run_command_stream(cmd=cmd, cwd=module_dir, env=run_env):
        if event["type"] == "line":
            chunks.append(str(event["line"]))
            continue
        rc = int(event.get("exit_code", 1))

    if rc != 0:
        detail = chunks[-1] if chunks else "unable to read tofu output"
        return None, f"modules/{module}: {detail}"

    try:
        payload = json.loads("\n".join(chunks) if chunks else "{}")
    except json.JSONDecodeError:
        return None, f"modules/{module}: invalid JSON from `tofu output -json`"
    if not isinstance(payload, dict):
        return None, f"modules/{module}: unexpected output payload type"
    return payload, None


async def collect_hosts_for_modules(
    *,
    project_id: str,
    settings: Settings,
    modules: list[str],
    strict_state: bool,
) -> tuple[list[AnsibleHost], list[str]]:
    project = await load_project(project_id)
    if project is None:
        return [], ["Project not found"]
    if not project.provider:
        return [], ["Project provider is not configured"]

    project_root = resolve_project_root(project_id)
    modules_root = project_root / "modules"
    state_root = project_root / ".opentofu-runtime" / "state"
    creds = project_credentials.parse_credentials(project.credentials)
    run_env = merge_run_env(opentofu_env(project.provider, creds))

    hosts: list[AnsibleHost] = []
    errors: list[str] = []

    for module in modules:
        module_dir = modules_root / module
        state_path = state_root / f"{module}.tfstate"
        if not module_dir.exists():
            errors.append(f"modules/{module}: module path not found")
            continue
        if not state_path.is_file():
            if strict_state:
                errors.append(f"modules/{module}: state file not found, run apply first")
            continue

        output_json, output_error = await _load_module_output(
            module=module,
            module_dir=module_dir,
            state_path=state_path,
            run_env=run_env,
        )
        if output_error is not None:
            errors.append(output_error)
            continue
        assert output_json is not None
        try:
            hosts.extend(parse_ansible_hosts_output(module, output_json))
        except AnsibleInventoryError as exc:
            errors.append(str(exc))

    return hosts, errors


def _resolve_modules(project_id: str, selected_modules: list[str]) -> list[str]:
    discovered = discover_modules_from_project_dir(project_id)
    requested = [module for module in selected_modules if module in discovered]
    if requested:
        return requested
    return discovered


async def _prepare_playbook_run(
    *,
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
) -> dict[str, Any] | None:
    if not ansible_available():
        return {"failure": _failure_event("Ansible CLI is not available", code="tool_unavailable")}

    key_path = resolve_ssh_key_path(settings)
    if key_path is None:
        return {"failure": _failure_event("ANSIBLE_SSH_KEY_PATH is not configured", code="missing_key_path")}
    if not key_path.is_file():
        return {"failure": _failure_event(f"SSH key file does not exist: {key_path}", code="missing_key_file")}

    project_root = resolve_project_root(project_id)
    playbook_path = resolve_playbook_path(project_root, settings)
    if not playbook_path.is_file():
        return {"failure": _failure_event(f"Playbook path not found: {playbook_path}", code="missing_playbook")}

    modules = _resolve_modules(project_id, selected_modules)
    if not modules:
        return {"failure": _failure_event("No modules selected for configuration run", code="missing_modules")}

    hosts, host_errors = await collect_hosts_for_modules(
        project_id=project_id,
        settings=settings,
        modules=modules,
        strict_state=True,
    )
    if host_errors:
        return {"failure": _failure_event("; ".join(host_errors), code="invalid_outputs")}
    if not hosts:
        return {"failure": _failure_event("No inventory hosts found in Terraform outputs (`ansible_hosts`)", code="empty_inventory")}

    run_id = _run_id()
    runtime_root = project_root / ".ansible-runtime" / run_id
    runtime_root.mkdir(parents=True, exist_ok=True)
    inventory_path = runtime_root / "inventory.ini"
    inventory_path.write_text(build_inventory_ini(hosts, ssh_key_path=str(key_path)), encoding="utf-8")

    base_cmd = ["ansible-playbook", "-i", str(inventory_path), str(playbook_path)]
    if (settings.ansible_ssh_common_args or "").strip():
        base_cmd.extend(["--ssh-common-args", settings.ansible_ssh_common_args.strip()])
    return {
        "project_root": project_root,
        "runtime_root": runtime_root,
        "playbook_path": playbook_path,
        "inventory_path": inventory_path,
        "ssh_common_args": settings.ansible_ssh_common_args or "",
        "modules": modules,
        "hosts": hosts,
        "run_id": run_id,
        "base_cmd": base_cmd,
    }


async def _emit_cancelled_run(
    *,
    attempt: int,
    run_id: str,
    aggregate_recap: dict[str, dict[str, int]],
) -> AsyncIterator[dict[str, Any]]:
    yield {"type": "error", "code": "config_canceled", "message": "Configuration run canceled"}
    yield {
        "type": "config.done",
        "status": "failed",
        "attempts": attempt,
        "results": _results_payload(aggregate_recap),
        "run_id": run_id,
        "at": _now_iso(),
    }


async def _wait_retry_backoff(
    *,
    seconds: int,
    cancel_checker: Callable[[], Awaitable[bool]] | None,
) -> bool:
    for _ in range(seconds):
        if cancel_checker is not None and await cancel_checker():
            return True
        await asyncio.sleep(1)
    return False


def _terminal_run_events(
    *,
    project_root: Path,
    run_id: str,
    modules: list[str],
    hosts: list[AnsibleHost],
    attempt: int,
    exit_code: int,
    recap: dict[str, dict[str, int]],
    aggregate_recap: dict[str, dict[str, int]],
) -> list[dict[str, Any]]:
    final_results = _results_payload(aggregate_recap or recap)
    failed_hosts = _failed_hosts(recap)
    unreachable_hosts = _unreachable_hosts(recap)
    failed = exit_code != 0 or any(row["status"] != "ok" for row in final_results)
    status = "failed" if failed else "ok"
    finished_at = _now_iso()
    _write_latest_run_summary(
        project_root=project_root,
        run_id=run_id,
        status=status,
        attempts=attempt,
        modules=modules,
        results=final_results,
        host_count=len(hosts),
        finished_at=finished_at,
    )
    events: list[dict[str, Any]] = []
    if failed:
        reason = "Configuration run failed"
        if failed_hosts:
            reason = f"Failed hosts: {', '.join(failed_hosts)}"
        elif unreachable_hosts:
            reason = f"Unreachable hosts: {', '.join(unreachable_hosts)}"
        events.append({"type": "error", "code": "config_failed", "message": reason})
    events.append({"type": "config.done", "status": status, "attempts": attempt, "results": final_results, "run_id": run_id, "at": finished_at})
    return events


def _start_run_events(run_id: str, modules: list[str], hosts: list[AnsibleHost], attempt: int) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = [
        {
            "type": "config.start",
            "run_id": run_id,
            "intent": "",
            "modules": modules,
            "host_count": len(hosts),
            "at": _now_iso(),
        }
    ]
    events.extend({"type": "host.start", "host": host.name, "attempt": attempt} for host in hosts)
    return events


async def _run_playbook_attempt(
    *,
    attempt: int,
    runtime_root: Path,
    playbook_path: Path,
    inventory_path: Path,
    env: dict[str, str],
    ssh_common_args: str,
    base_cmd: list[str],
    project_root: Path,
    cancel_checker: Callable[[], Awaitable[bool]] | None,
) -> tuple[int, dict[str, dict[str, int]], list[dict[str, Any]]]:
    lines: list[str] = []
    task_events: list[dict[str, Any]] = []
    exit_code = 1
    if _ansible_runner_available():
        playbook_events = _run_ansible_runner_stream(
            runtime_root=runtime_root,
            playbook_path=playbook_path,
            inventory_path=inventory_path,
            env=env,
            ssh_common_args=ssh_common_args,
            cancel_checker=cancel_checker,
        )
    else:
        playbook_events = _run_command_stream(
            cmd=base_cmd,
            cwd=project_root,
            env=env,
            cancel_checker=cancel_checker,
        )
    async for event in playbook_events:
        if event["type"] == "line":
            line = str(event.get("line") or "")
            lines.append(line)
            task_events.append({"type": "task.log", "line": line, "attempt": attempt})
            continue
        exit_code = int(event.get("exit_code", 1))
    return exit_code, _parse_recap(lines), task_events


async def _stream_playbook_attempts(
    *,
    project_id: str,
    env: dict[str, str],
    project_root: Path,
    runtime_root: Path,
    playbook_path: Path,
    inventory_path: Path,
    ssh_common_args: str,
    run_id: str,
    modules: list[str],
    hosts: list[AnsibleHost],
    base_cmd: list[str],
    cancel_checker: Callable[[], Awaitable[bool]] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    attempt = 1
    max_attempts = len(_UNREACHABLE_BACKOFFS) + 1
    aggregate_recap: dict[str, dict[str, int]] = {}

    async with project_lock(project_id):
        for event in _start_run_events(run_id, modules, hosts, attempt):
            yield event

        while True:
            if cancel_checker is not None and await cancel_checker():
                async for event in _emit_cancelled_run(attempt=attempt, run_id=run_id, aggregate_recap=aggregate_recap):
                    yield event
                return

            exit_code, recap, task_events = await _run_playbook_attempt(
                attempt=attempt,
                runtime_root=runtime_root,
                playbook_path=playbook_path,
                inventory_path=inventory_path,
                env=env,
                ssh_common_args=ssh_common_args,
                base_cmd=base_cmd,
                project_root=project_root,
                cancel_checker=cancel_checker,
            )
            for event in task_events:
                yield event

            aggregate_recap = _merge_host_results(aggregate_recap, recap)
            for row in _results_payload(recap):
                yield {"type": "host.done", "attempt": attempt, **row}

            failed_hosts = _failed_hosts(recap)
            unreachable_hosts = _unreachable_hosts(recap)
            can_retry = bool(unreachable_hosts) and not failed_hosts and attempt < max_attempts
            if can_retry:
                backoff = _UNREACHABLE_BACKOFFS[attempt - 1]
                yield {"type": "task.log", "attempt": attempt, "line": f"Retrying unreachable hosts in {backoff}s: {', '.join(unreachable_hosts)}"}
                cancelled = await _wait_retry_backoff(seconds=backoff, cancel_checker=cancel_checker)
                if cancelled:
                    async for event in _emit_cancelled_run(attempt=attempt, run_id=run_id, aggregate_recap=aggregate_recap):
                        yield event
                    return
                attempt += 1
                for host in hosts:
                    if host.name in unreachable_hosts:
                        yield {"type": "host.start", "host": host.name, "attempt": attempt}
                continue

            terminal_events = _terminal_run_events(
                project_root=project_root,
                run_id=run_id,
                modules=modules,
                hosts=hosts,
                attempt=attempt,
                exit_code=exit_code,
                recap=recap,
                aggregate_recap=aggregate_recap,
            )
            for event in terminal_events:
                yield event
            return


async def run_playbook_stream(
    *,
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    intent: str | None = None,
    cancel_checker: Callable[[], Awaitable[bool]] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    prepared = await _prepare_playbook_run(project_id=project_id, settings=settings, selected_modules=selected_modules)
    if prepared is None:
        return
    failure = prepared.get("failure")
    if failure:
        for event in failure:
            yield event
        return

    env = ansible_run_env(settings)
    async for event in _stream_playbook_attempts(
        project_id=project_id,
        env=env,
        project_root=prepared["project_root"],
        runtime_root=prepared["runtime_root"],
        playbook_path=prepared["playbook_path"],
        inventory_path=prepared["inventory_path"],
        ssh_common_args=prepared["ssh_common_args"],
        run_id=prepared["run_id"],
        modules=prepared["modules"],
        hosts=prepared["hosts"],
        base_cmd=prepared["base_cmd"],
        cancel_checker=cancel_checker,
    ):
        if event.get("type") == "config.start":
            event["intent"] = intent or ""
        yield event


async def run_playbook_collect(
    *,
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    intent: str | None = None,
    cancel_checker: Callable[[], Awaitable[bool]] | None = None,
) -> dict[str, Any]:
    """Run playbook and collect all stream events for tool callers."""
    logs: list[dict[str, Any]] = []
    final: dict[str, Any] = {"status": "failed", "results": []}
    async for event in run_playbook_stream(
        project_id=project_id,
        settings=settings,
        selected_modules=selected_modules,
        intent=intent,
        cancel_checker=cancel_checker,
    ):
        logs.append(event)
        if event.get("type") == "config.done":
            final = {
                "status": event.get("status", "failed"),
                "results": event.get("results", []),
                "attempts": event.get("attempts", 1),
            }
    return {"final": final, "events": logs}
