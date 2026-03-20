"""Ansible command execution and streaming runtime."""

from __future__ import annotations

import asyncio
import json
import re
import shlex
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
    resolve_ssm_bucket_name,
)
from .ssm_readiness import get_ssm_readiness, wait_for_ssm_readiness
from .ssm_transport import (
    SsmTransportError,
    apply_ssm_transport_config,
    build_ssm_transport_targets,
    transport_summary,
    write_ssm_inventory,
)
from .summary import resolve_post_deploy_checks, sanitize_post_deploy_text

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


def _failure_event(
    message: str,
    *,
    code: str = "config_failed",
    extra: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    terminal = {"type": "config.done", "status": "failed", "results": []}
    if extra:
        terminal.update(extra)
    return [
        {"type": "error", "code": code, "message": message},
        terminal,
    ]


def _latest_run_path(project_root: Path) -> Path:
    return project_root / ".ansible-runtime" / "latest-run.json"


def _history_path(project_root: Path) -> Path:
    return project_root / ".ansible-runtime" / "history.jsonl"


def _latest_post_deploy_path(project_root: Path) -> Path:
    return project_root / ".ansible-runtime" / "post-deploy-latest.json"


def _post_deploy_history_path(project_root: Path) -> Path:
    return project_root / ".ansible-runtime" / "post-deploy-history.jsonl"


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
    transport: dict[str, Any] | None,
) -> None:
    target = _latest_run_path(project_root)
    history = _history_path(project_root)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        provenance = _run_provenance(modules=modules, host_count=host_count, transport=transport)
        payload = {
            "run_id": run_id,
            "status": status,
            "attempts": attempts,
            "modules": modules,
            "host_count": host_count,
            "results": results,
            "finished_at": finished_at,
            **provenance,
        }
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        with history.open("a", encoding="utf-8") as history_file:
            history_file.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError:
        return


def _write_post_deploy_summary(*, project_root: Path, payload: dict[str, Any]) -> None:
    latest = _latest_post_deploy_path(project_root)
    history = _post_deploy_history_path(project_root)
    try:
        latest.parent.mkdir(parents=True, exist_ok=True)
        latest.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        with history.open("a", encoding="utf-8") as history_file:
            history_file.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError:
        return


def _run_provenance(
    *,
    modules: list[str],
    host_count: int,
    transport: dict[str, Any] | None,
) -> dict[str, Any]:
    target_ids = [str(item) for item in list((transport or {}).get("target_ids") or []) if str(item).strip()]
    target_count = int((transport or {}).get("target_count") or len(target_ids) or host_count)
    return {
        "transport": transport,
        "selected_modules": list(modules),
        "target_count": target_count,
        "target_ids": target_ids,
    }


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


def _results_payload(
    recap: dict[str, dict[str, int]],
    *,
    hosts: list[AnsibleHost] | None = None,
) -> list[dict[str, Any]]:
    host_lookup = {host.name: host for host in hosts or []}
    payload: list[dict[str, Any]] = []
    for host in sorted(recap.keys()):
        row = recap[host]
        item = {
            "host": host,
            "status": _host_status(row),
            "ok": row["ok"],
            "changed": row["changed"],
            "unreachable": row["unreachable"],
            "failed": row["failed"],
        }
        host_row = host_lookup.get(host)
        if host_row is not None:
            item["module"] = host_row.module
            if host_row.address:
                item["target_id"] = host_row.address
            if host_row.vars:
                display_name = str(host_row.vars.get("target_display_name") or "").strip()
                if display_name:
                    item["display_name"] = display_name
        payload.append(item)
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


def _transport_host(target: dict[str, Any]) -> AnsibleHost:
    source_modules = [str(item) for item in list(target.get("source_modules") or []) if str(item).strip()]
    metadata = {
        "target_display_name": str(target.get("display_name") or ""),
        "target_role": str(target.get("role") or ""),
    }
    if source_modules:
        metadata["target_source_modules"] = ",".join(source_modules)
    return AnsibleHost(
        module=source_modules[0] if source_modules else "all",
        name=str(target.get("inventory_name") or target.get("execution_id") or "target"),
        address=str(target.get("execution_id") or target.get("transport_instance_id") or ""),
        groups=tuple(str(item) for item in list(target.get("groups") or [])),
        vars=metadata,
    )


def _transport_failure(
    error: SsmTransportError,
    *,
    modules: list[str],
    readiness: dict[str, Any] | None = None,
    transport: dict[str, Any] | None = None,
) -> dict[str, Any]:
    readiness_targets = readiness.get("targets") if isinstance(readiness, dict) else []
    target_ids = [
        str(item.get("execution_id") or "")
        for item in readiness_targets
        if isinstance(item, dict) and str(item.get("execution_id") or "").strip()
    ]
    extra = {
        **_run_provenance(
            modules=modules,
            host_count=len(target_ids),
            transport=transport
            or {
                "mode": "ssm",
                "target_count": len(target_ids),
                "target_ids": target_ids,
                "display_names": [],
            },
        ),
        "ssm_readiness": readiness,
    }
    return {"failure": _failure_event(error.message, code=error.code, extra=extra)}


async def _resolve_aws_transport_readiness(
    *,
    project_id: str,
    settings: Settings,
    modules: list[str],
    require_ssm_ready: bool,
    cancel_checker: Callable[[], Awaitable[bool]] | None,
    status_readiness: dict[str, Any] | None,
) -> dict[str, Any]:
    readiness = dict(status_readiness or {})
    if require_ssm_ready:
        readiness = await wait_for_ssm_readiness(
            project_id,
            settings,
            modules,
            cancel_checker=cancel_checker,
        )
    elif not readiness or bool(readiness.get("blocking")):
        readiness = await get_ssm_readiness(project_id, settings, modules)
    if bool(readiness.get("blocking")):
        raise SsmTransportError(
            str(readiness.get("blocker_code") or "ssm_target_not_ready"),
            str(readiness.get("blocker_message") or "AWS Systems Manager readiness failed."),
        )
    return readiness


async def _prepare_aws_playbook_run(
    *,
    project_id: str,
    settings: Settings,
    project_root: Path,
    playbook_path: Path,
    modules: list[str],
    require_ssm_ready: bool,
    cancel_checker: Callable[[], Awaitable[bool]] | None,
    status_readiness: dict[str, Any] | None,
) -> dict[str, Any]:
    project = await load_project(project_id)
    if project is None:
        return {"failure": _failure_event("Project not found", code="project_not_found")}
    credentials = project_credentials.parse_credentials(project.credentials)
    targets: list[dict[str, Any]] = []
    try:
        readiness = await _resolve_aws_transport_readiness(
            project_id=project_id,
            settings=settings,
            modules=modules,
            require_ssm_ready=require_ssm_ready,
            cancel_checker=cancel_checker,
            status_readiness=status_readiness,
        )
        targets = build_ssm_transport_targets(readiness)
        targets = apply_ssm_transport_config(
            targets,
            aws_region=str(credentials.get("aws_region") or ""),
            bucket_name=str(resolve_ssm_bucket_name(settings) or ""),
        )
    except SsmTransportError as exc:
        readiness = dict(status_readiness or {})
        if not readiness:
            readiness = await get_ssm_readiness(project_id, settings, modules)
        return _transport_failure(
            exc,
            modules=modules,
            readiness=readiness,
            transport=transport_summary(targets) if targets else None,
        )
    run_id = _run_id()
    runtime_root = project_root / ".ansible-runtime" / run_id
    runtime_root.mkdir(parents=True, exist_ok=True)
    try:
        inventory_path = write_ssm_inventory(targets, runtime_root=runtime_root)
    except SsmTransportError as exc:
        return _transport_failure(
            exc,
            modules=modules,
            readiness=readiness,
            transport=transport_summary(targets),
        )
    return {
        "project_root": project_root,
        "runtime_root": runtime_root,
        "playbook_path": playbook_path,
        "inventory_path": inventory_path,
        "ssh_common_args": "",
        "modules": modules,
        "hosts": [_transport_host(target) for target in targets],
        "run_id": run_id,
        "base_cmd": ["ansible-playbook", "-i", str(inventory_path), str(playbook_path)],
        "env": ansible_run_env(settings, provider=project.provider, credentials=credentials),
        "transport": transport_summary(targets),
    }


async def _prepare_legacy_playbook_run(
    *,
    project_id: str,
    settings: Settings,
    project_root: Path,
    playbook_path: Path,
    modules: list[str],
) -> dict[str, Any]:
    key_path = resolve_ssh_key_path(settings)
    if key_path is None:
        return {"failure": _failure_event("ANSIBLE_SSH_KEY_PATH is not configured", code="missing_key_path")}
    if not key_path.is_file():
        return {"failure": _failure_event(f"SSH key file does not exist: {key_path}", code="missing_key_file")}
    hosts, host_errors = await collect_hosts_for_modules(
        project_id=project_id,
        settings=settings,
        modules=modules,
        strict_state=True,
    )
    if host_errors:
        return {"failure": _failure_event("; ".join(host_errors), code="invalid_outputs")}
    if not hosts:
        return {
            "failure": _failure_event(
                "No inventory hosts found in Terraform outputs (`ansible_hosts`)", code="empty_inventory"
            )
        }
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
        "env": ansible_run_env(settings),
        "transport": None,
    }


async def _prepare_playbook_run(
    *,
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    require_ssm_ready: bool = True,
    cancel_checker: Callable[[], Awaitable[bool]] | None = None,
) -> dict[str, Any] | None:
    if not ansible_available():
        return {"failure": _failure_event("Ansible CLI is not available", code="tool_unavailable")}

    project_root = resolve_project_root(project_id)
    playbook_path = resolve_playbook_path(project_root, settings)
    if not playbook_path.is_file():
        return {"failure": _failure_event(f"Playbook path not found: {playbook_path}", code="missing_playbook")}

    from .status import get_ansible_status

    status = await get_ansible_status(project_id, settings)
    generated_modules = [str(module) for module in status.get("targetModules", [])]
    if not status.get("latestGeneration"):
        return {
            "failure": _failure_event(
                "Generated Ansible is missing. Generate configuration before running it.",
                code="missing_generation",
            )
        }
    if status.get("generationStale"):
        return {
            "failure": _failure_event(
                "Generated Ansible is stale relative to the latest Terraform generation.",
                code="stale_generation",
            )
        }
    if not generated_modules:
        return {
            "failure": _failure_event(
                "Generated Ansible does not target any Terraform modules.",
                code="empty_generation",
            )
        }

    invalid_selected = [module for module in selected_modules if module not in generated_modules]
    if invalid_selected:
        return {
            "failure": _failure_event(
                f"Requested modules are outside the generated configuration scope: {', '.join(invalid_selected)}",
                code="invalid_generation_scope",
            )
        }

    modules = list(selected_modules) if selected_modules else generated_modules
    if not modules:
        return {"failure": _failure_event("No modules selected for configuration run", code="missing_modules")}
    provider = str(status.get("provider") or "").strip()
    if provider == "aws":
        return await _prepare_aws_playbook_run(
            project_id=project_id,
            settings=settings,
            project_root=project_root,
            playbook_path=playbook_path,
            modules=modules,
            require_ssm_ready=require_ssm_ready,
            cancel_checker=cancel_checker,
            status_readiness=status.get("ssm_readiness") if isinstance(status.get("ssm_readiness"), dict) else None,
        )
    return await _prepare_legacy_playbook_run(
        project_id=project_id,
        settings=settings,
        project_root=project_root,
        playbook_path=playbook_path,
        modules=modules,
    )


async def _emit_cancelled_run(
    *,
    attempt: int,
    run_id: str,
    modules: list[str],
    hosts: list[AnsibleHost],
    transport: dict[str, Any] | None,
    aggregate_recap: dict[str, dict[str, int]],
) -> AsyncIterator[dict[str, Any]]:
    yield {"type": "error", "code": "config_canceled", "message": "Configuration run canceled"}
    yield {
        "type": "config.done",
        "status": "failed",
        "attempts": attempt,
        "results": _results_payload(aggregate_recap, hosts=hosts),
        "run_id": run_id,
        "at": _now_iso(),
        **_run_provenance(modules=modules, host_count=len(hosts), transport=transport),
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
    transport: dict[str, Any] | None,
    attempt: int,
    exit_code: int,
    recap: dict[str, dict[str, int]],
    aggregate_recap: dict[str, dict[str, int]],
) -> list[dict[str, Any]]:
    final_results = _results_payload(aggregate_recap or recap, hosts=hosts)
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
        transport=transport,
    )
    provenance = _run_provenance(modules=modules, host_count=len(hosts), transport=transport)
    events: list[dict[str, Any]] = []
    if failed:
        reason = "Configuration run failed"
        if failed_hosts:
            reason = f"Failed hosts: {', '.join(failed_hosts)}"
        elif unreachable_hosts:
            reason = f"Unreachable hosts: {', '.join(unreachable_hosts)}"
        events.append({"type": "error", "code": "config_failed", "message": reason})
    events.append(
        {
            "type": "config.done",
            "status": status,
            "attempts": attempt,
            "results": final_results,
            "run_id": run_id,
            "at": finished_at,
            **provenance,
        }
    )
    return events


def _start_run_events(
    run_id: str,
    modules: list[str],
    hosts: list[AnsibleHost],
    attempt: int,
    transport: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    provenance = _run_provenance(modules=modules, host_count=len(hosts), transport=transport)
    events: list[dict[str, Any]] = [
        {
            "type": "config.start",
            "run_id": run_id,
            "intent": "",
            "modules": modules,
            "host_count": len(hosts),
            "at": _now_iso(),
            **provenance,
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
    transport: dict[str, Any] | None,
    base_cmd: list[str],
    cancel_checker: Callable[[], Awaitable[bool]] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    attempt = 1
    max_attempts = len(_UNREACHABLE_BACKOFFS) + 1
    aggregate_recap: dict[str, dict[str, int]] = {}

    async with project_lock(project_id):
        for event in _start_run_events(run_id, modules, hosts, attempt, transport):
            yield event

        while True:
            if cancel_checker is not None and await cancel_checker():
                async for event in _emit_cancelled_run(
                    attempt=attempt,
                    run_id=run_id,
                    modules=modules,
                    hosts=hosts,
                    transport=transport,
                    aggregate_recap=aggregate_recap,
                ):
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
            for row in _results_payload(recap, hosts=hosts):
                yield {"type": "host.done", "attempt": attempt, **row}

            failed_hosts = _failed_hosts(recap)
            unreachable_hosts = _unreachable_hosts(recap)
            can_retry = bool(unreachable_hosts) and not failed_hosts and attempt < max_attempts
            if can_retry:
                backoff = _UNREACHABLE_BACKOFFS[attempt - 1]
                yield {
                    "type": "task.log",
                    "attempt": attempt,
                    "line": f"Retrying unreachable hosts in {backoff}s: {', '.join(unreachable_hosts)}",
                }
                cancelled = await _wait_retry_backoff(seconds=backoff, cancel_checker=cancel_checker)
                if cancelled:
                    async for event in _emit_cancelled_run(
                        attempt=attempt,
                        run_id=run_id,
                        modules=modules,
                        hosts=hosts,
                        transport=transport,
                        aggregate_recap=aggregate_recap,
                    ):
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
                transport=transport,
                attempt=attempt,
                exit_code=exit_code,
                recap=recap,
                aggregate_recap=aggregate_recap,
            )
            for event in terminal_events:
                yield event
            return


def _extract_json_payload(output: str) -> dict[str, Any] | None:
    if "=>" not in output:
        return None
    payload = output.split("=>", 1)[1].strip()
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _extract_stdout_payload(output: str) -> str:
    if ">>" in output:
        return output.split(">>", 1)[1].strip()
    payload = _extract_json_payload(output)
    if isinstance(payload, dict):
        stdout = payload.get("stdout")
        if isinstance(stdout, str) and stdout.strip():
            return stdout.strip()
        msg = payload.get("msg")
        if isinstance(msg, str) and msg.strip():
            return msg.strip()
    return output.strip()


def _section_payload(items: list[dict[str, Any]], raw_payload: Any) -> dict[str, Any]:
    rendered = raw_payload if isinstance(raw_payload, str) else json.dumps(raw_payload, ensure_ascii=False, indent=2)
    sanitized = sanitize_post_deploy_text(rendered)
    return {
        "items": items,
        "raw": sanitized["content"],
        "truncated": sanitized["truncated"],
        "redacted": sanitized["redacted"],
        "truncated_reason": sanitized["truncated_reason"],
    }


async def _run_ansible_adhoc(
    *,
    project_root: Path,
    inventory_path: Path,
    host_name: str,
    env: dict[str, str],
    module: str,
    args: str = "",
    cancel_checker: Callable[[], Awaitable[bool]] | None = None,
) -> tuple[int, str]:
    cmd = ["ansible", "-i", str(inventory_path), host_name, "-m", module]
    if args.strip():
        cmd.extend(["-a", args])
    lines: list[str] = []
    exit_code = 1
    async for event in _run_command_stream(
        cmd=cmd,
        cwd=project_root,
        env=env,
        cancel_checker=cancel_checker,
    ):
        if event["type"] == "line":
            lines.append(str(event.get("line") or ""))
            continue
        exit_code = int(event.get("exit_code", 1))
    return exit_code, "\n".join(lines).strip()


def _root_mount_summary(mounts: Any) -> str:
    if not isinstance(mounts, list):
        return "unknown"
    for mount in mounts:
        if not isinstance(mount, dict):
            continue
        if mount.get("mount") != "/":
            continue
        size = mount.get("size_total")
        available = mount.get("size_available")
        if isinstance(size, int) and isinstance(available, int) and size > 0:
            used = size - available
            return f"{used // (1024 ** 3)}GiB used / {size // (1024 ** 3)}GiB total"
    return "unknown"


def _system_items(host: AnsibleHost, payload: dict[str, Any]) -> list[dict[str, Any]]:
    facts = payload.get("ansible_facts") if isinstance(payload.get("ansible_facts"), dict) else {}
    default_ipv4 = facts.get("ansible_default_ipv4") if isinstance(facts.get("ansible_default_ipv4"), dict) else {}
    os_name = " ".join(
        str(item)
        for item in [facts.get("ansible_distribution"), facts.get("ansible_distribution_version")]
        if isinstance(item, str) and item.strip()
    )
    cpu_value = (
        facts.get("ansible_processor_vcpus")
        or facts.get("ansible_processor_count")
        or facts.get("ansible_processor_cores")
    )
    items = [
        {"label": "Host", "value": facts.get("ansible_hostname") or host.name},
        {"label": "Address", "value": default_ipv4.get("address") or host.address},
        {"label": "OS", "value": os_name or "unknown"},
        {"label": "CPU", "value": str(cpu_value or "unknown")},
        {"label": "Memory", "value": f"{facts.get('ansible_memtotal_mb', 'unknown')} MB"},
        {"label": "Disk", "value": _root_mount_summary(facts.get("ansible_mounts"))},
    ]
    return items


def _service_items(services: list[str], payload: dict[str, Any]) -> list[dict[str, Any]]:
    facts = payload.get("ansible_facts") if isinstance(payload.get("ansible_facts"), dict) else {}
    service_facts = facts.get("services") if isinstance(facts.get("services"), dict) else {}
    items: list[dict[str, Any]] = []
    for service in services:
        raw = service_facts.get(service) or service_facts.get(f"{service}.service")
        if isinstance(raw, dict):
            items.append(
                {
                    "name": service,
                    "status": raw.get("state") or "unknown",
                    "enabled": raw.get("status") or "unknown",
                }
            )
            continue
        items.append({"name": service, "status": "missing", "enabled": "unknown"})
    return items


def _package_items(packages: list[str], payload: dict[str, Any]) -> list[dict[str, Any]]:
    facts = payload.get("ansible_facts") if isinstance(payload.get("ansible_facts"), dict) else {}
    package_facts = facts.get("packages") if isinstance(facts.get("packages"), dict) else {}
    items: list[dict[str, Any]] = []
    for package in packages:
        rows = package_facts.get(package)
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            first = rows[0]
            version = str(first.get("version") or "")
            release = str(first.get("release") or "")
            display = version if not release else f"{version}-{release}"
            items.append({"name": package, "version": display or "installed"})
            continue
        items.append({"name": package, "version": "not installed"})
    return items


def _health_command(check: dict[str, Any]) -> str:
    if str(check.get("type") or "command") == "http":
        url = str(check.get("url") or "")
        return "python3 -c " + shlex.quote(
            "import urllib.request; "
            f"response = urllib.request.urlopen({json.dumps(url)}, timeout=5); "
            "print(response.getcode())"
        )
    return str(check.get("command") or "true")


def _service_log_command(log_item: dict[str, Any]) -> str:
    command = log_item.get("command")
    if isinstance(command, str) and command.strip():
        return command
    service = str(log_item.get("service") or log_item.get("name") or "system").strip()
    safe_service = shlex.quote(service)
    return (
        f"journalctl -u {safe_service} -n 40 --no-pager 2>&1 "
        f"|| tail -n 40 /var/log/{safe_service}.log 2>&1 "
        "|| printf 'No logs available\\n'"
    )


async def _collect_post_deploy_host(
    *,
    project_root: Path,
    inventory_path: Path,
    host: AnsibleHost,
    env: dict[str, str],
    checks: dict[str, Any],
    cancel_checker: Callable[[], Awaitable[bool]] | None = None,
) -> dict[str, Any]:
    system_rc, system_output = await _run_ansible_adhoc(
        project_root=project_root,
        inventory_path=inventory_path,
        host_name=host.name,
        env=env,
        module="ansible.builtin.setup",
        cancel_checker=cancel_checker,
    )
    system_payload = _extract_json_payload(system_output) if system_rc == 0 else None
    system = _section_payload(
        _system_items(host, system_payload or {}),
        system_payload or {"error": system_output or "setup failed"},
    )

    services_rc, services_output = await _run_ansible_adhoc(
        project_root=project_root,
        inventory_path=inventory_path,
        host_name=host.name,
        env=env,
        module="ansible.builtin.service_facts",
        cancel_checker=cancel_checker,
    )
    services_payload = _extract_json_payload(services_output) if services_rc == 0 else None
    services = _section_payload(
        _service_items(list(checks["services"]), services_payload or {}),
        services_payload or {"error": services_output or "service facts failed"},
    )

    packages_rc, packages_output = await _run_ansible_adhoc(
        project_root=project_root,
        inventory_path=inventory_path,
        host_name=host.name,
        env=env,
        module="ansible.builtin.package_facts",
        args="manager=auto",
        cancel_checker=cancel_checker,
    )
    packages_payload = _extract_json_payload(packages_output) if packages_rc == 0 else None
    packages = _section_payload(
        _package_items(list(checks["package_versions"]), packages_payload or {}),
        packages_payload or {"error": packages_output or "package facts failed"},
    )

    health_items: list[dict[str, Any]] = []
    health_raw: dict[str, Any] = {}
    for check in checks["health_checks"]:
        command = _health_command(check)
        rc, output = await _run_ansible_adhoc(
            project_root=project_root,
            inventory_path=inventory_path,
            host_name=host.name,
            env=env,
            module="ansible.builtin.shell",
            args=command,
            cancel_checker=cancel_checker,
        )
        detail = sanitize_post_deploy_text(_extract_stdout_payload(output))
        check_type = str(check.get("type") or "command")
        if check_type == "http":
            expected_status = int(check.get("expected_status") or 200)
            ok = rc == 0 and detail["content"].strip() == str(expected_status)
        else:
            success_contains = str(check.get("success_contains") or "").strip()
            ok = rc == 0 and (not success_contains or success_contains in detail["content"])
        item = {
            "name": str(check.get("name") or "Health check"),
            "type": check_type,
            "status": "ok" if ok else "failed",
            "detail": detail["content"],
            "truncated": detail["truncated"],
            "redacted": detail["redacted"],
            "truncated_reason": detail["truncated_reason"],
        }
        if check_type == "http":
            item["target"] = str(check.get("url") or "")
        health_items.append(item)
        health_raw[item["name"]] = item
    health_checks = _section_payload(health_items, health_raw)

    log_items: list[dict[str, Any]] = []
    for log_item in checks["service_logs"]:
        rc, output = await _run_ansible_adhoc(
            project_root=project_root,
            inventory_path=inventory_path,
            host_name=host.name,
            env=env,
            module="ansible.builtin.shell",
            args=_service_log_command(log_item),
            cancel_checker=cancel_checker,
        )
        rendered = sanitize_post_deploy_text(_extract_stdout_payload(output or ""))
        log_items.append(
            {
                "name": str(log_item.get("name") or log_item.get("service") or "Service Log"),
                "status": "ok" if rc == 0 else "failed",
                "content": rendered["content"],
                "truncated": rendered["truncated"],
                "redacted": rendered["redacted"],
                "truncated_reason": rendered["truncated_reason"],
            }
        )
    service_logs = {
        "items": log_items,
        "raw": None,
        "truncated": any(bool(item.get("truncated")) for item in log_items),
        "redacted": any(bool(item.get("redacted")) for item in log_items),
        "truncated_reason": (
            "One or more log sections exceeded the per-section cap."
            if any(bool(item.get("truncated")) for item in log_items)
            else None
        ),
    }

    health_ready = all(str(item.get("status") or "failed") == "ok" for item in health_items)
    services_ready = all(
        str(item.get("status") or "").lower() in {"running", "active", "started", "ok"} for item in services["items"]
    )
    system_ready = system_rc == 0
    ready = system_ready and health_ready and services_ready
    return {
        "status": "ok" if ready else "failed",
        "ready": ready,
        "host": {
            "name": host.name,
            "address": host.address,
            "module": host.module,
            "target_id": host.address,
            "display_name": str((host.vars or {}).get("target_display_name") or host.name),
        },
        "system": system,
        "services": services,
        "packages": packages,
        "health_checks": health_checks,
        "service_logs": service_logs,
    }


def _post_deploy_health_summary(hosts: list[dict[str, Any]]) -> str:
    total = 0
    passed = 0
    for host in hosts:
        section = host.get("health_checks") if isinstance(host.get("health_checks"), dict) else {}
        items = section.get("items") if isinstance(section.get("items"), list) else []
        total += len(items)
        passed += sum(1 for item in items if isinstance(item, dict) and item.get("status") == "ok")
    if total < 1:
        return "No health checks collected."
    return f"{passed}/{total} checks passed"


async def collect_post_deploy_result(
    *,
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    checks: dict[str, Any] | None = None,
    successful_hosts: list[str] | None = None,
    skipped_hosts: list[dict[str, Any]] | None = None,
    cancel_checker: Callable[[], Awaitable[bool]] | None = None,
    progress: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
) -> dict[str, Any]:
    prepared = await _prepare_playbook_run(
        project_id=project_id,
        settings=settings,
        selected_modules=selected_modules,
        require_ssm_ready=False,
        cancel_checker=cancel_checker,
    )
    collected_at = _now_iso()
    pending_skips = list(skipped_hosts or [])
    if prepared is None:
        return {
            "status": "failed",
            "summary": {
                "status": "failed",
                "host_count": 0,
                "skipped_host_count": len(pending_skips),
                "service_count": len(resolve_post_deploy_checks(checks)["services"]),
                "health_summary": "Post-deploy collection could not start.",
                "ready": False,
            },
            "hosts": [],
            "skipped_hosts": pending_skips,
            "collected_at": collected_at,
        }
    failure = prepared.get("failure")
    if failure:
        error_event = failure[0] if isinstance(failure, list) and failure else {"message": "post-deploy failed"}
        payload = {
            "status": "failed",
            "summary": {
                "status": "failed",
                "host_count": 0,
                "skipped_host_count": len(pending_skips),
                "service_count": len(resolve_post_deploy_checks(checks)["services"]),
                "health_summary": str(error_event.get("message") or "Post-deploy collection failed."),
                "ready": False,
            },
            "hosts": [],
            "skipped_hosts": pending_skips,
            "collected_at": collected_at,
        }
        _write_post_deploy_summary(project_root=resolve_project_root(project_id), payload=payload)
        return payload

    requested_hosts = list(prepared["hosts"])
    if successful_hosts is None:
        target_hosts = requested_hosts
    else:
        allowed = set(successful_hosts)
        target_hosts = [host for host in requested_hosts if host.name in allowed]
        resolved_names = {host.name for host in target_hosts}
        for missing in sorted(allowed - resolved_names):
            pending_skips.append({"host": missing, "reason": "Host not found in current inventory"})

    if not target_hosts:
        payload = {
            "status": "skipped",
            "summary": {
                "status": "skipped",
                "host_count": 0,
                "skipped_host_count": len(pending_skips),
                "service_count": len(resolve_post_deploy_checks(checks)["services"]),
                "health_summary": "No successful hosts available for post-deploy collection.",
                "ready": False,
            },
            "hosts": [],
            "skipped_hosts": pending_skips,
            "collected_at": collected_at,
        }
        _write_post_deploy_summary(project_root=prepared["project_root"], payload=payload)
        return payload

    env = dict(prepared["env"])
    resolved_checks = resolve_post_deploy_checks(checks)
    host_results: list[dict[str, Any]] = []
    for host in target_hosts:
        if progress is not None:
            await progress(
                {"type": "post_deploy.host.start", "host": host.name, "module": host.module, "at": _now_iso()}
            )
        result = await _collect_post_deploy_host(
            project_root=prepared["project_root"],
            inventory_path=prepared["inventory_path"],
            host=host,
            env=env,
            checks=resolved_checks,
            cancel_checker=cancel_checker,
        )
        host_results.append(result)
        if progress is not None:
            await progress(
                {
                    "type": "post_deploy.host.done",
                    "host": host.name,
                    "module": host.module,
                    "status": result["status"],
                    "ready": result["ready"],
                    "at": _now_iso(),
                }
            )

    ready = all(bool(host.get("ready")) for host in host_results)
    payload = {
        "status": "ok" if ready else "failed",
        "summary": {
            "status": "ok" if ready else "failed",
            "host_count": len(host_results),
            "skipped_host_count": len(pending_skips),
            "service_count": len(resolved_checks["services"]),
            "health_summary": _post_deploy_health_summary(host_results),
            "ready": ready,
        },
        "hosts": host_results,
        "skipped_hosts": pending_skips,
        "collected_at": collected_at,
        "modules": prepared["modules"],
        **_run_provenance(
            modules=prepared["modules"],
            host_count=len(target_hosts),
            transport=prepared.get("transport"),
        ),
    }
    _write_post_deploy_summary(project_root=prepared["project_root"], payload=payload)
    return payload


async def run_playbook_stream(
    *,
    project_id: str,
    settings: Settings,
    selected_modules: list[str],
    intent: str | None = None,
    require_ssm_ready: bool = True,
    cancel_checker: Callable[[], Awaitable[bool]] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    prepared = await _prepare_playbook_run(
        project_id=project_id,
        settings=settings,
        selected_modules=selected_modules,
        require_ssm_ready=require_ssm_ready,
        cancel_checker=cancel_checker,
    )
    if prepared is None:
        return
    failure = prepared.get("failure")
    if failure:
        for event in failure:
            yield event
        return

    async for event in _stream_playbook_attempts(
        project_id=project_id,
        env=dict(prepared["env"]),
        project_root=prepared["project_root"],
        runtime_root=prepared["runtime_root"],
        playbook_path=prepared["playbook_path"],
        inventory_path=prepared["inventory_path"],
        ssh_common_args=prepared["ssh_common_args"],
        run_id=prepared["run_id"],
        modules=prepared["modules"],
        hosts=prepared["hosts"],
        transport=prepared.get("transport"),
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
                "transport": event.get("transport"),
                "selected_modules": event.get("selected_modules", []),
                "target_count": event.get("target_count", 0),
                "target_ids": event.get("target_ids", []),
            }
    return {"final": final, "events": logs}
