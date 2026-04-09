from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from app import db
from app.celery_app import celery_app
from app.core.config import get_settings
from app.models import Project
from app.schemas.chat import ChatRequest
from app.services.agent.runtime.factory import clear_agent_cache
from app.services.ansible import deploy as ansible_deploy
from app.services.ansible.runtime.ssm_readiness import wait_for_ssm_readiness
from app.services.ansible.runtime.summary import default_post_deploy_checks
from app.services.chat import service as chat_service
from app.services.jobs import redis_bus as jobs_redis_bus
from app.services.jobs import service as jobs_service
from app.services.model.factory import close_agent_store
from app.services.opentofu import deploy as opentofu_deploy
from app.services.opentofu.runtime import review_gate
from app.services.opentofu.runtime import target_contract as target_contract_service
from app.services.project_execution import policy as execution_policy
from app.services.project_execution.contracts import ProjectExecutionRequest
from app.services.state_backends import service as state_backends_service

logger = logging.getLogger(__name__)

_db_ready = False
_FINAL_STATUSES = {"succeeded", "failed", "canceled"}
_worker_loop: asyncio.AbstractEventLoop | None = None


async def _teardown_runtime() -> None:
    global _db_ready
    try:
        await jobs_redis_bus.close_redis()
    except Exception:
        logger.exception("worker redis teardown failed")
    try:
        await close_agent_store()
    except Exception:
        logger.exception("worker agent store teardown failed")
    try:
        await db.close_db()
    except Exception:
        logger.exception("worker runtime teardown failed")
    _db_ready = False
    clear_agent_cache()


def _ensure_worker_loop() -> asyncio.AbstractEventLoop:
    global _worker_loop
    if _worker_loop is None or _worker_loop.is_closed():
        _worker_loop = asyncio.new_event_loop()
    return _worker_loop


def _run(coro):
    loop = _ensure_worker_loop()
    return loop.run_until_complete(coro)


async def _ensure_db() -> None:
    global _db_ready
    if _db_ready:
        return
    settings = get_settings()
    await db.init_db(settings.database_url, run_setup=False, run_schema_setup=False)
    _db_ready = True


async def _job_or_none(job_id: str) -> dict[str, Any] | None:
    await _ensure_db()
    return await jobs_service.get_job_by_global_id(job_id)


async def _should_cancel(job_id: str) -> bool:
    return await jobs_service.is_cancel_requested(job_id)


async def _emit(job_id: str, event: dict[str, Any]) -> None:
    await jobs_service.append_job_event_by_id(job_id, event)


async def _start_job(job_id: str) -> dict[str, Any] | None:
    job = await _job_or_none(job_id)
    if job is None:
        return None
    if job["status"] in {"succeeded", "failed", "canceled"}:
        return None
    await jobs_service.mark_job_running(job_id)
    return await _job_or_none(job_id)


async def _finish_stream_job(
    *,
    job_id: str,
    final_status: str,
    result: dict[str, Any],
    failed_message: str,
) -> None:
    if await _should_cancel(job_id):
        await jobs_service.mark_job_terminal(job_id=job_id, status="canceled", result=result, error=None)
        return
    if final_status == "ok":
        await jobs_service.mark_job_terminal(job_id=job_id, status="succeeded", result=result, error=None)
        return
    await jobs_service.mark_job_terminal(
        job_id=job_id,
        status="failed",
        result=result,
        error={"message": failed_message},
    )


def _parse_iso_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _selected_modules(params: dict[str, Any]) -> list[str]:
    return ProjectExecutionRequest.from_payload(params).selected_modules_list()


def _review_target(params: dict[str, Any], default: str = "apply") -> str:
    return ProjectExecutionRequest.from_payload(params).resolved_review_target(default)


def _scope_mode(params: dict[str, Any]) -> str:
    return ProjectExecutionRequest.from_payload(params).effective_scope_mode()


def _confirmation_payload(params: dict[str, Any]) -> dict[str, Any]:
    request = ProjectExecutionRequest.from_payload(params)
    return request.confirmation.to_payload() if request.confirmation is not None else {}


def _job_user_id(job: dict[str, Any]) -> str:
    return str(job.get("user_id") or "")


async def _latest_successful_plan_result(job: dict[str, Any]) -> dict[str, Any] | None:
    history = await jobs_service.list_jobs(
        project_id=job["project_id"],
        user_id=_job_user_id(job),
        status="succeeded",
        kind="plan",
        limit=1,
        offset=0,
    )
    latest = history["items"][0] if history["items"] else None
    result = latest.get("result") if isinstance(latest, dict) else None
    return result if isinstance(result, dict) else None


async def _latest_failed_destroy_at(job: dict[str, Any]) -> datetime | None:
    history = await jobs_service.list_jobs(
        project_id=job["project_id"],
        user_id=_job_user_id(job),
        status="failed",
        kind="destroy",
        limit=1,
        offset=0,
    )
    latest = history["items"][0] if history["items"] else None
    if not isinstance(latest, dict):
        return None
    return _parse_iso_datetime(latest.get("finished_at")) or _parse_iso_datetime(latest.get("created_at"))


def _gate_error_event(code: str, message: str, **extra: Any) -> dict[str, Any]:
    return execution_policy.gate_error(code, message, **extra)


async def _fail_stream_job(
    *,
    job_id: str,
    done_type: str,
    code: str,
    message: str,
    result: dict[str, Any],
    extra: dict[str, Any] | None = None,
) -> None:
    payload = _gate_error_event(code, message, **(extra or {}))
    await _emit(job_id, payload)
    await _emit(job_id, {"type": done_type, "status": "failed"})
    await jobs_service.mark_job_terminal(
        job_id=job_id,
        status="failed",
        result=result,
        error={"code": code, "message": message},
    )


async def _saved_credentials_gate(job: dict[str, Any]) -> dict[str, Any] | None:
    status = await opentofu_deploy.get_opentofu_status(job["project_id"])
    credential_gate = execution_policy.build_credential_gate(status)
    if not credential_gate["blocking"]:
        return None
    return _gate_error_event(
        "saved_credentials_incomplete",
        "Saved AWS credentials are incomplete.",
        missing_fields=list(credential_gate["missing_fields"]),
    )


async def _generation_readiness_gate(job: dict[str, Any], settings) -> dict[str, Any] | None:
    opentofu_status = await opentofu_deploy.get_opentofu_status(job["project_id"])
    ansible_status = await ansible_deploy.get_ansible_status(job["project_id"], settings)
    target_contract = target_contract_service.get_target_contract_status(job["project_id"])
    generation_gate = execution_policy.build_generation_gate(opentofu_status, ansible_status, target_contract)
    generation_error = execution_policy.resolve_generation_gate_error(generation_gate, target_contract)
    if generation_error is None:
        return None
    missing_generation_assets: list[str] = []
    if not bool(generation_gate["terraform_ready"]):
        missing_generation_assets.append("terraform")
    if bool(generation_gate["ansible_required"]) and not bool(generation_gate["ansible_ready"]):
        missing_generation_assets.append("ansible")
    return _gate_error_event(
        str(generation_error["code"]),
        str(generation_error["message"]),
        missing_generation_assets=missing_generation_assets,
        **{key: value for key, value in generation_error.items() if key not in {"type", "stage", "code", "message"}},
    )


async def _review_gate_error(
    job: dict[str, Any],
    *,
    params: dict[str, Any],
    review_target_name: str,
) -> dict[str, Any] | None:
    request = ProjectExecutionRequest.from_payload(params)
    review_result = await _latest_successful_plan_result(job)
    resolved = review_gate.resolve_plan_review(
        project_id=job["project_id"],
        review_result=review_result,
        review_session_id=request.review_session_id,
        review_target=review_target_name,
        scope_mode=request.effective_scope_mode(),
        selected_modules=request.selected_modules_list(),
    )
    review_gate_payload = execution_policy.build_review_gate_payload(
        resolved_review=resolved,
        request=request,
        review_target=review_target_name,
        last_failed_destroy_at=await _latest_failed_destroy_at(job) if review_target_name == "destroy" else None,
    )
    return execution_policy.resolve_review_gate_error(review_gate_payload, review_target=review_target_name)


async def _drift_gate_error(params: dict[str, Any], project_id: str) -> dict[str, Any] | None:
    request = ProjectExecutionRequest.from_payload(params)
    drift_summary = await state_backends_service.get_project_deploy_drift_summary(project_id)
    return execution_policy.resolve_drift_gate_error(
        request=request,
        drift_refresh=drift_summary,
    )


def _destroy_confirmation_error(project_name: str, params: dict[str, Any]) -> dict[str, Any] | None:
    request = ProjectExecutionRequest.from_payload(params)
    return execution_policy.resolve_destroy_confirmation_error(
        project_name=project_name,
        request=request,
    )


async def _run_plan_apply_job(job_id: str, *, mode: str) -> None:
    job = await _start_job(job_id)
    if job is None:
        return
    settings = get_settings()
    params = job.get("params") or {}
    request = ProjectExecutionRequest.from_payload(params)
    selected_modules = request.selected_modules_list()
    intent = request.intent
    policy_override = request.option_enabled("override_policy")
    stream: AsyncIterator[dict[str, Any]]
    done_type = "deploy.done" if mode == "apply" else "plan.done"
    if mode == "apply":
        for gate in (
            await _saved_credentials_gate(job),
            await _generation_readiness_gate(job, settings),
            await _review_gate_error(job, params=params, review_target_name="apply"),
            await _drift_gate_error(params, job["project_id"]),
        ):
            if gate is None:
                continue
            await _fail_stream_job(
                job_id=job_id,
                done_type=done_type,
                code=str(gate["code"]),
                message=str(gate["message"]),
                extra={key: value for key, value in gate.items() if key not in {"type", "stage", "code", "message"}},
                result={"status": "failed", "gate": gate},
            )
            return
    if mode == "apply":
        stream = opentofu_deploy.apply_modules_stream(
            project_id=job["project_id"],
            settings=settings,
            selected_modules=selected_modules,
            intent=intent,
            policy_override=policy_override,
            cancel_checker=lambda: _should_cancel(job_id),
        )
    else:
        stream = opentofu_deploy.plan_modules_stream(
            project_id=job["project_id"],
            settings=settings,
            selected_modules=selected_modules,
            intent=intent,
            destroy_plan=request.resolved_review_target() == "destroy",
            cancel_checker=lambda: _should_cancel(job_id),
        )
    final_status = "failed"
    final_results: list[dict[str, Any]] = []
    async for event in stream:
        await _emit(job_id, event)
        if event.get("type") == done_type:
            final_status = str(event.get("status") or "failed")
            final_results = event.get("results") if isinstance(event.get("results"), list) else []
    result_payload: dict[str, Any] = {"status": final_status, "results": final_results}
    if mode == "plan" and final_status == "ok":
        result_payload = review_gate.record_plan_review_metadata(
            project_id=job["project_id"],
            result=result_payload,
            review_session_id=request.review_session_id,
            review_target=request.review_target,
            scope_mode=request.scope_mode,
            selected_modules=selected_modules,
        )
    await _finish_stream_job(
        job_id=job_id,
        final_status=final_status,
        result=result_payload,
        failed_message=f"{mode} job failed",
    )


async def _run_ansible_job(job_id: str) -> None:
    job = await _start_job(job_id)
    if job is None:
        return
    settings = get_settings()
    params = job.get("params") or {}
    request = ProjectExecutionRequest.from_payload(params)
    selected_modules = request.selected_modules_list()
    intent = request.intent
    post_deploy_only = request.option_enabled("post_deploy_only")
    final_status = "failed"
    final_payload: dict[str, Any] = {
        "status": "failed",
        "results": [],
        "attempts": 1,
        **_ansible_provenance({"selected_modules": selected_modules}, selected_modules=selected_modules),
    }

    if post_deploy_only:
        post_deploy_result = await _run_post_deploy_stage(
            job_id=job_id,
            project_id=job["project_id"],
            settings=settings,
            selected_modules=selected_modules,
            successful_hosts=None,
            skipped_hosts=[],
        )
        final_status = "ok" if post_deploy_result.get("status") == "ok" else "failed"
        final_payload = {
            "status": final_status,
            "results": [],
            "attempts": 0,
            "configuration_skipped": True,
            "post_deploy": post_deploy_result,
            **_ansible_provenance({"selected_modules": selected_modules}, selected_modules=selected_modules),
        }
    else:
        async for event in ansible_deploy.run_playbook_stream(
            project_id=job["project_id"],
            settings=settings,
            selected_modules=selected_modules,
            intent=intent,
            cancel_checker=lambda: _should_cancel(job_id),
        ):
            await _emit(job_id, event)
            if event.get("type") == "config.done":
                final_status = str(event.get("status") or "failed")
                final_payload = {
                    "status": final_status,
                    "results": event.get("results") if isinstance(event.get("results"), list) else [],
                    "attempts": int(event.get("attempts", 1) or 1),
                    **_ansible_provenance(event, selected_modules=selected_modules),
                }
        successful_hosts = _successful_ansible_hosts(
            final_payload["results"] if isinstance(final_payload.get("results"), list) else []
        )
        skipped_hosts = _skipped_post_deploy_hosts(
            final_payload["results"] if isinstance(final_payload.get("results"), list) else []
        )
        if final_status == "ok" and not successful_hosts:
            successful_hosts = None
        post_deploy_result = await _run_post_deploy_stage(
            job_id=job_id,
            project_id=job["project_id"],
            settings=settings,
            selected_modules=selected_modules,
            successful_hosts=successful_hosts,
            skipped_hosts=skipped_hosts,
        )
        final_payload["post_deploy"] = post_deploy_result
        if final_status == "ok" and post_deploy_result.get("status") != "ok":
            final_status = "failed"
            final_payload["status"] = "failed"
        elif final_status == "ok":
            final_payload["status"] = "ok"

    await _finish_stream_job(
        job_id=job_id,
        final_status=final_status,
        result=final_payload,
        failed_message="post-deploy checks failed" if post_deploy_only else "ansible job failed",
    )


async def _run_graph_job(job_id: str) -> None:
    job = await _start_job(job_id)
    if job is None:
        return
    settings = get_settings()
    params = job.get("params") or {}
    options = params.get("options") if isinstance(params.get("options"), dict) else {}
    module_scope = str(options.get("module") or "all")
    graph_type = str(options.get("type") or "plan")
    refresh = bool(options.get("refresh", False))
    await _emit(job_id, {"type": "graph.start", "scope": module_scope, "graph_type": graph_type, "refresh": refresh})
    data = await opentofu_deploy.get_graph(
        project_id=job["project_id"],
        settings=settings,
        module_scope=module_scope,
        graph_type=graph_type,
        refresh=refresh,
    )
    await _emit(job_id, {"type": "graph.done", "status": data.get("status", "ok")})
    status = "failed" if data.get("status") == "error" else "succeeded"
    await jobs_service.mark_job_terminal(
        job_id=job_id,
        status=status,
        result=data,
        error=None if status == "succeeded" else {"message": str(data.get("message") or "graph job failed")},
    )


async def _run_cost_job(job_id: str) -> None:
    job = await _start_job(job_id)
    if job is None:
        return
    settings = get_settings()
    params = job.get("params") or {}
    options = params.get("options") if isinstance(params.get("options"), dict) else {}
    module_scope = str(options.get("module") or "all")
    refresh = bool(options.get("refresh", False))
    await _emit(job_id, {"type": "cost.start", "scope": module_scope, "refresh": refresh})
    data = await opentofu_deploy.get_costs(
        project_id=job["project_id"],
        settings=settings,
        module_scope=module_scope,
        refresh=refresh,
    )
    await _emit(job_id, {"type": "cost.done", "status": data.get("status", "ok")})
    status = "failed" if data.get("status") == "error" else "succeeded"
    await jobs_service.mark_job_terminal(
        job_id=job_id,
        status=status,
        result=data,
        error=None if status == "succeeded" else {"message": str(data.get("message") or "cost job failed")},
    )


async def _load_project(project_id: str) -> Project | None:
    async with db.get_session() as session:
        return await session.get(Project, project_id)


def _stage_event(event: dict[str, Any], stage: str) -> dict[str, Any]:
    if event.get("stage"):
        return event
    return {**event, "stage": stage}


def _pipeline_missing_requirements(status: dict[str, Any]) -> list[str]:
    return execution_policy.pipeline_missing_requirements(status)


def _pipeline_preflight_message(status: dict[str, Any], apply_modules: list[str]) -> str:
    return execution_policy.pipeline_preflight_message(status, apply_modules)


def _ansible_provenance(
    payload: dict[str, Any],
    *,
    selected_modules: list[str] | None = None,
) -> dict[str, Any]:
    transport = payload.get("transport") if isinstance(payload.get("transport"), dict) else None
    selected_modules = [
        str(item)
        for item in (
            payload.get("selected_modules")
            if isinstance(payload.get("selected_modules"), list)
            else list(selected_modules or [])
        )
        if isinstance(item, str) and item.strip()
    ]
    target_ids = [str(item) for item in payload.get("target_ids", []) if isinstance(item, str) and item.strip()]
    target_count = int(payload.get("target_count") or len(target_ids) or 0)
    return {
        "transport": transport,
        "selected_modules": selected_modules,
        "target_count": target_count,
        "target_ids": target_ids,
    }


def _successful_ansible_hosts(results: list[dict[str, Any]]) -> list[str]:
    return [
        str(row["host"])
        for row in results
        if isinstance(row, dict) and isinstance(row.get("host"), str) and row.get("status") == "ok"
    ]


def _skipped_post_deploy_hosts(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    skipped: list[dict[str, Any]] = []
    for row in results:
        if not isinstance(row, dict) or not isinstance(row.get("host"), str):
            continue
        status = str(row.get("status") or "failed")
        if status == "ok":
            continue
        item = {"host": str(row["host"]), "reason": f"Configuration {status}"}
        if isinstance(row.get("target_id"), str) and str(row.get("target_id")).strip():
            item["target_id"] = str(row["target_id"])
        if isinstance(row.get("display_name"), str) and str(row.get("display_name")).strip():
            item["display_name"] = str(row["display_name"])
        skipped.append(item)
    return skipped


async def _post_deploy_checks_for_project(project_id: str) -> dict[str, Any] | None:
    project = await _load_project(project_id)
    if project is None:
        return None
    return default_post_deploy_checks()


def _skipped_post_deploy_result(skipped_hosts: list[dict[str, Any]], message: str) -> dict[str, Any]:
    return {
        "status": "skipped",
        "summary": {
            "status": "skipped",
            "host_count": 0,
            "skipped_host_count": len(skipped_hosts),
            "service_count": 0,
            "health_summary": message,
            "ready": False,
        },
        "hosts": [],
        "skipped_hosts": skipped_hosts,
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }


async def _run_post_deploy_stage(
    *,
    job_id: str,
    project_id: str,
    settings,
    selected_modules: list[str],
    successful_hosts: list[str] | None,
    skipped_hosts: list[dict[str, Any]],
) -> dict[str, Any]:
    if successful_hosts is not None and len(successful_hosts) < 1:
        result = _skipped_post_deploy_result(
            skipped_hosts,
            "No successful hosts available for post-deploy collection.",
        )
        await _emit(
            job_id,
            {
                "type": "post_deploy.start",
                "modules": selected_modules,
                "host_count": 0,
                "skipped_host_count": len(skipped_hosts),
                "at": datetime.now(timezone.utc).isoformat(),
            },
        )
        await _emit(
            job_id,
            {
                "type": "post_deploy.done",
                "status": result["status"],
                "summary": result["summary"],
                "hosts": result["hosts"],
                "skipped_hosts": result["skipped_hosts"],
                "collected_at": result["collected_at"],
                "at": datetime.now(timezone.utc).isoformat(),
            },
        )
        return result

    post_deploy_checks = await _post_deploy_checks_for_project(project_id)
    await _emit(
        job_id,
        {
            "type": "post_deploy.start",
            "modules": selected_modules,
            "host_count": len(successful_hosts or []),
            "skipped_host_count": len(skipped_hosts),
            "at": datetime.now(timezone.utc).isoformat(),
        },
    )
    result = await ansible_deploy.collect_post_deploy_result(
        project_id=project_id,
        settings=settings,
        selected_modules=selected_modules,
        checks=post_deploy_checks,
        successful_hosts=successful_hosts,
        skipped_hosts=skipped_hosts,
        cancel_checker=lambda: _should_cancel(job_id),
        progress=lambda event: _emit(job_id, _stage_event(event, "post_deploy")),
    )
    await _emit(
        job_id,
        {
            "type": "post_deploy.done",
            "status": result.get("status", "failed"),
            "summary": result.get("summary", {}),
            "hosts": result.get("hosts", []),
            "skipped_hosts": result.get("skipped_hosts", []),
            "collected_at": result.get("collected_at"),
            "at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return result


async def _run_pipeline_job(job_id: str) -> None:
    job = await _start_job(job_id)
    if job is None:
        return
    settings = get_settings()
    params = job.get("params") or {}
    request = ProjectExecutionRequest.from_payload(params)
    selected_modules = request.selected_modules_list()
    intent = request.intent
    policy_override = request.option_enabled("override_policy")
    await _emit(job_id, {"type": "pipeline.start", "selected_modules": selected_modules})
    for gate in (
        await _saved_credentials_gate(job),
        await _generation_readiness_gate(job, settings),
        await _review_gate_error(job, params=params, review_target_name="apply"),
        await _drift_gate_error(params, job["project_id"]),
    ):
        if gate is None:
            continue
        await _fail_stream_job(
            job_id=job_id,
            done_type="pipeline.done",
            code=str(gate["code"]),
            message=str(gate["message"]),
            extra={key: value for key, value in gate.items() if key not in {"type", "stage", "code", "message"}},
            result={
                "status": "failed",
                "preflight": {
                    "status": "failed",
                    "code": gate["code"],
                    "message": gate["message"],
                },
                "apply": None,
                "ssm_readiness": None,
                "ansible": None,
                "post_deploy": None,
            },
        )
        return
    ansible_status = await ansible_deploy.get_ansible_status(job["project_id"], settings)
    configuration_required = bool(ansible_status.get("configurationRequired", True))
    apply_modules = (
        list(selected_modules) if selected_modules else [str(module) for module in ansible_status.get("modules", [])]
    )
    ansible_modules = [str(module) for module in ansible_status.get("targetModules", [])]
    if configuration_required and (
        not ansible_status.get("generationReady")
        or bool(_pipeline_missing_requirements(ansible_status))
        or any(module not in apply_modules for module in ansible_modules)
    ):
        message = _pipeline_preflight_message(ansible_status, apply_modules)
        failed_result = {
            "status": "failed",
            "preflight": {
                "status": "failed",
                "message": message,
                "targetModules": ansible_modules,
                "applyModules": apply_modules,
            },
            "apply": None,
            "ssm_readiness": ansible_status.get("ssm_readiness"),
            "ansible": None,
            "post_deploy": None,
        }
        await _emit(job_id, {"type": "error", "stage": "preflight", "message": message})
        await _emit(job_id, {"type": "pipeline.done", "status": "failed"})
        await jobs_service.mark_job_terminal(
            job_id=job_id,
            status="failed",
            result=failed_result,
            error={"message": message},
        )
        return
    apply_status = "failed"
    apply_results: list[dict[str, Any]] = []
    async for event in opentofu_deploy.apply_modules_stream(
        project_id=job["project_id"],
        settings=settings,
        selected_modules=apply_modules,
        intent=intent,
        policy_override=policy_override,
        cancel_checker=lambda: _should_cancel(job_id),
    ):
        await _emit(job_id, _stage_event(event, "apply"))
        if event.get("type") == "deploy.done":
            apply_status = str(event.get("status") or "failed")
            apply_results = event.get("results") if isinstance(event.get("results"), list) else []
    if await _should_cancel(job_id):
        await jobs_service.mark_job_terminal(
            job_id=job_id,
            status="canceled",
            result={"status": "canceled", "apply": {"status": apply_status, "results": apply_results}},
            error=None,
        )
        return
    if apply_status != "ok":
        failed_result = {
            "status": "failed",
            "apply": {"status": apply_status, "results": apply_results},
            "ssm_readiness": None,
            "ansible": None,
            "post_deploy": None,
        }
        await _emit(job_id, {"type": "pipeline.done", "status": "failed"})
        await jobs_service.mark_job_terminal(
            job_id=job_id, status="failed", result=failed_result, error={"message": "pipeline apply stage failed"}
        )
        return
    if not configuration_required or not ansible_modules:
        ssm_readiness = {
            "status": "skipped",
            "blocking": False,
            "scope_mode": "full",
            "selected_modules": [],
            "checked_at": None,
            "timeout_seconds": 0,
            "target_count": 0,
            "ready_target_count": 0,
            "pending_target_count": 0,
            "failed_target_count": 0,
            "blocker_code": None,
            "blocker_message": "No configuration targets require Ansible.",
            "targets": [],
            "failed_targets": [],
        }
        post_deploy_result = _skipped_post_deploy_result([], "No configuration targets require post-deploy checks.")
        ansible_result = {
            "status": "skipped",
            "results": [],
            "attempts": 0,
            **_ansible_provenance({}, selected_modules=[]),
        }
        await _emit(job_id, {"type": "ssm_readiness.done", "stage": "ssm_readiness", **ssm_readiness})
        await _emit(
            job_id,
            {
                "type": "config.done",
                "stage": "ansible",
                "status": "ok",
                "results": [],
                "attempts": 0,
                "selected_modules": [],
                "target_count": 0,
                "target_ids": [],
                "message": "Skipped because no configuration targets were generated.",
                "skipped": True,
            },
        )
        await _emit(
            job_id,
            {
                "type": "post_deploy.done",
                "stage": "post_deploy",
                "status": post_deploy_result["status"],
                "summary": post_deploy_result["summary"],
                "hosts": post_deploy_result["hosts"],
                "skipped_hosts": post_deploy_result["skipped_hosts"],
                "collected_at": post_deploy_result["collected_at"],
                "at": datetime.now(timezone.utc).isoformat(),
            },
        )
        final_result = {
            "status": "ok",
            "apply": {"status": apply_status, "results": apply_results},
            "ssm_readiness": ssm_readiness,
            "ansible": ansible_result,
            "post_deploy": post_deploy_result,
        }
        await _emit(job_id, {"type": "pipeline.done", "status": "ok"})
        await jobs_service.mark_job_terminal(
            job_id=job_id,
            status="succeeded",
            result=final_result,
            error=None,
        )
        return
    readiness_started = False

    async def _emit_ssm_progress(snapshot: dict[str, Any]) -> None:
        nonlocal readiness_started
        event_type = "ssm_readiness.start" if not readiness_started else "ssm_readiness.progress"
        readiness_started = True
        await _emit(job_id, {"type": event_type, "stage": "ssm_readiness", **snapshot})

    ssm_readiness = await wait_for_ssm_readiness(
        job["project_id"],
        settings,
        ansible_modules,
        cancel_checker=lambda: _should_cancel(job_id),
        progress=_emit_ssm_progress,
    )
    if not readiness_started:
        await _emit(job_id, {"type": "ssm_readiness.start", "stage": "ssm_readiness", **ssm_readiness})
    await _emit(job_id, {"type": "ssm_readiness.done", "stage": "ssm_readiness", **ssm_readiness})
    if await _should_cancel(job_id):
        await jobs_service.mark_job_terminal(
            job_id=job_id,
            status="canceled",
            result={
                "status": "canceled",
                "apply": {"status": apply_status, "results": apply_results},
                "ssm_readiness": ssm_readiness,
                "ansible": None,
                "post_deploy": None,
            },
            error=None,
        )
        return
    if ssm_readiness.get("blocking"):
        message = str(ssm_readiness.get("blocker_message") or "AWS Systems Manager readiness failed.")
        failed_result = {
            "status": "failed",
            "apply": {"status": apply_status, "results": apply_results},
            "ssm_readiness": ssm_readiness,
            "ansible": None,
            "post_deploy": None,
        }
        await _emit(
            job_id,
            {
                "type": "error",
                "stage": "ssm_readiness",
                "code": str(ssm_readiness.get("blocker_code") or "ssm_target_not_ready"),
                "message": message,
            },
        )
        await _emit(job_id, {"type": "pipeline.done", "status": "failed"})
        await jobs_service.mark_job_terminal(
            job_id=job_id,
            status="failed",
            result=failed_result,
            error={"message": message},
        )
        return
    ansible_status = "failed"
    ansible_results: list[dict[str, Any]] = []
    ansible_attempts = 1
    ansible_provenance = _ansible_provenance({"selected_modules": ansible_modules}, selected_modules=ansible_modules)
    async for event in ansible_deploy.run_playbook_stream(
        project_id=job["project_id"],
        settings=settings,
        selected_modules=ansible_modules,
        intent=intent,
        require_ssm_ready=False,
        cancel_checker=lambda: _should_cancel(job_id),
    ):
        await _emit(job_id, _stage_event(event, "ansible"))
        if event.get("type") == "config.done":
            ansible_status = str(event.get("status") or "failed")
            ansible_results = event.get("results") if isinstance(event.get("results"), list) else []
            ansible_attempts = int(event.get("attempts", 1) or 1)
            ansible_provenance = _ansible_provenance(event, selected_modules=ansible_modules)
    successful_hosts = _successful_ansible_hosts(ansible_results)
    skipped_hosts = _skipped_post_deploy_hosts(ansible_results)
    if ansible_status == "ok" and not successful_hosts:
        successful_hosts = None
    post_deploy_result = await _run_post_deploy_stage(
        job_id=job_id,
        project_id=job["project_id"],
        settings=settings,
        selected_modules=ansible_modules,
        successful_hosts=successful_hosts,
        skipped_hosts=skipped_hosts,
    )
    final_ok = ansible_status == "ok" and post_deploy_result.get("status") == "ok"
    final_result = {
        "status": "ok" if final_ok else "failed",
        "apply": {"status": apply_status, "results": apply_results},
        "ssm_readiness": ssm_readiness,
        "ansible": {
            "status": ansible_status,
            "results": ansible_results,
            "attempts": ansible_attempts,
            **ansible_provenance,
        },
        "post_deploy": post_deploy_result,
    }
    await _emit(job_id, {"type": "pipeline.done", "status": final_result["status"]})
    await jobs_service.mark_job_terminal(
        job_id=job_id,
        status="succeeded" if final_ok else "failed",
        result=final_result,
        error=(
            None
            if final_ok
            else {
                "message": (
                    "pipeline config stage failed" if ansible_status != "ok" else "pipeline post-deploy stage failed"
                )
            }
        ),
    )


async def _run_destroy_job(job_id: str) -> None:
    job = await _start_job(job_id)
    if job is None:
        return
    settings = get_settings()
    params = job.get("params") or {}
    request = ProjectExecutionRequest.from_payload(params)
    selected_modules = request.selected_modules_list()
    intent = request.intent
    project = await _load_project(job["project_id"])
    project_name = str((project.name if project is not None else "") or "")
    for gate in (
        await _saved_credentials_gate(job),
        await _review_gate_error(job, params=params, review_target_name="destroy"),
        _destroy_confirmation_error(project_name, params),
    ):
        if gate is None:
            continue
        await _fail_stream_job(
            job_id=job_id,
            done_type="destroy.done",
            code=str(gate["code"]),
            message=str(gate["message"]),
            extra={key: value for key, value in gate.items() if key not in {"type", "stage", "code", "message"}},
            result={"status": "failed", "gate": gate},
        )
        return
    final_status = "failed"
    final_results: list[dict[str, Any]] = []
    async for event in opentofu_deploy.destroy_modules_stream(
        project_id=job["project_id"],
        settings=settings,
        selected_modules=selected_modules,
        intent=intent,
        cancel_checker=lambda: _should_cancel(job_id),
    ):
        await _emit(job_id, event)
        if event.get("type") == "destroy.done":
            final_status = str(event.get("status") or "failed")
            final_results = event.get("results") if isinstance(event.get("results"), list) else []
    await _finish_stream_job(
        job_id=job_id,
        final_status=final_status,
        result={"status": final_status, "results": final_results},
        failed_message="destroy job failed",
    )


def _chat_request_from_job(job: dict[str, Any]) -> ChatRequest:
    params = job.get("params") if isinstance(job.get("params"), dict) else {}
    raw_payload = {
        "project_id": params.get("project_id") or job.get("project_id"),
        "thread_id": params.get("thread_id"),
        "messages": params.get("messages") if isinstance(params.get("messages"), list) else [],
    }
    return ChatRequest.model_validate(raw_payload)


async def _run_chat_job(job_id: str) -> None:
    job = await _start_job(job_id)
    if job is None:
        return
    settings = get_settings()
    payload = _chat_request_from_job(job)
    text_parts: list[str] = []
    try:
        async for event in chat_service.stream_response_events(
            payload,
            settings,
            cancel_checker=lambda: _should_cancel(job_id),
        ):
            await _emit(job_id, event)
            if event.get("type") == "text.delta":
                text_parts.append(str(event.get("delta") or ""))
    except Exception as exc:
        if await _should_cancel(job_id):
            await jobs_service.mark_job_terminal(
                job_id=job_id,
                status="canceled",
                result={"status": "canceled", "thread_id": payload.thread_id},
                error=None,
            )
            return
        await jobs_service.mark_job_terminal(
            job_id=job_id,
            status="failed",
            result={"status": "failed", "project_id": payload.project_id, "thread_id": payload.thread_id},
            error={"message": str(exc)},
        )
        return
    if await _should_cancel(job_id):
        await jobs_service.mark_job_terminal(
            job_id=job_id,
            status="canceled",
            result={"status": "canceled", "thread_id": payload.thread_id},
            error=None,
        )
        return
    result = {
        "status": "ok",
        "project_id": payload.project_id,
        "thread_id": payload.thread_id,
        "text": "".join(text_parts),
    }
    await jobs_service.mark_job_terminal(
        job_id=job_id,
        status="succeeded",
        result=result,
        error=None,
    )


async def _run_safe(job_id: str, runner) -> None:
    try:
        await runner()
    except Exception as exc:
        logger.exception("job runner failed job_id=%s", job_id)
        current = await _job_or_none(job_id)
        if current is None or current["status"] in _FINAL_STATUSES:
            return
        if await _should_cancel(job_id):
            await jobs_service.mark_job_terminal(
                job_id=job_id,
                status="canceled",
                result={"status": "canceled"},
                error=None,
            )
            return
        await jobs_service.mark_job_terminal(
            job_id=job_id,
            status="failed",
            result=None,
            error={"message": str(exc)},
        )


@celery_app.task(name="jobs.run_plan", max_retries=0)
def run_plan(job_id: str) -> None:
    _run(_run_safe(job_id, lambda: _run_plan_apply_job(job_id, mode="plan")))


@celery_app.task(name="jobs.run_apply", max_retries=0)
def run_apply(job_id: str) -> None:
    _run(_run_safe(job_id, lambda: _run_plan_apply_job(job_id, mode="apply")))


@celery_app.task(name="jobs.run_destroy", max_retries=0)
def run_destroy(job_id: str) -> None:
    _run(_run_safe(job_id, lambda: _run_destroy_job(job_id)))


@celery_app.task(name="jobs.run_ansible", max_retries=0)
def run_ansible(job_id: str) -> None:
    _run(_run_safe(job_id, lambda: _run_ansible_job(job_id)))


@celery_app.task(name="jobs.run_graph", max_retries=0)
def run_graph(job_id: str) -> None:
    _run(_run_safe(job_id, lambda: _run_graph_job(job_id)))


@celery_app.task(name="jobs.run_cost", max_retries=0)
def run_cost(job_id: str) -> None:
    _run(_run_safe(job_id, lambda: _run_cost_job(job_id)))


@celery_app.task(name="jobs.run_pipeline", max_retries=0)
def run_pipeline(job_id: str) -> None:
    _run(_run_safe(job_id, lambda: _run_pipeline_job(job_id)))


@celery_app.task(name="jobs.run_chat", max_retries=0)
def run_chat(job_id: str) -> None:
    _run(_run_safe(job_id, lambda: _run_chat_job(job_id)))


@celery_app.task(name="jobs.cleanup_history", max_retries=0)
def cleanup_history() -> int:
    async def _cleanup() -> int:
        await _ensure_db()
        settings = get_settings()
        return await jobs_service.cleanup_old_jobs(settings)

    return _run(_cleanup())
