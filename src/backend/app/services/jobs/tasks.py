from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterator

from app import db
from app.celery_app import celery_app
from app.core.config import get_settings
from app.models import Project
from app.services.ansible import deploy as ansible_deploy
from app.services.chat import service as chat_service
from app.services.jobs import service as jobs_service
from app.services.opentofu import deploy as opentofu_deploy
from app.schemas.chat import ChatRequest
from app.services.telegram import notifications as telegram_notifications

logger = logging.getLogger(__name__)

_db_ready = False
_FINAL_STATUSES = {"succeeded", "failed", "canceled"}


def _run(coro):
    return asyncio.run(coro)


async def _ensure_db() -> None:
    global _db_ready
    if _db_ready:
        return
    settings = get_settings()
    await db.init_db(settings.database_url)
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


async def _run_plan_apply_job(job_id: str, *, mode: str) -> None:
    job = await _start_job(job_id)
    if job is None:
        return
    settings = get_settings()
    params = job.get("params") or {}
    selected_modules = params.get("selected_modules") or []
    intent = params.get("intent")
    options = params.get("options") if isinstance(params.get("options"), dict) else {}
    policy_override = bool(options.get("override_policy", False))
    stream: AsyncIterator[dict[str, Any]]
    done_type = "deploy.done" if mode == "apply" else "plan.done"
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
            cancel_checker=lambda: _should_cancel(job_id),
        )
    final_status = "failed"
    final_results: list[dict[str, Any]] = []
    async for event in stream:
        await _emit(job_id, event)
        if event.get("type") == done_type:
            final_status = str(event.get("status") or "failed")
            final_results = event.get("results") if isinstance(event.get("results"), list) else []
    await _finish_stream_job(
        job_id=job_id,
        final_status=final_status,
        result={"status": final_status, "results": final_results},
        failed_message=f"{mode} job failed",
    )


async def _run_ansible_job(job_id: str) -> None:
    job = await _start_job(job_id)
    if job is None:
        return
    settings = get_settings()
    params = job.get("params") or {}
    selected_modules = params.get("selected_modules") or []
    intent = params.get("intent")
    final_status = "failed"
    final_payload: dict[str, Any] = {"status": "failed", "results": [], "attempts": 1}
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
            }
    await _finish_stream_job(
        job_id=job_id,
        final_status=final_status,
        result=final_payload,
        failed_message="ansible job failed",
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


def _pipeline_message(project: Project, result: dict[str, Any]) -> str:
    status = str(result.get("status") or "failed")
    apply_status = str(result.get("apply", {}).get("status") or "failed")
    ansible_status = str(result.get("ansible", {}).get("status") or "failed")
    return (
        f"[{project.name} | {project.id}] Pipeline {'succeeded' if status == 'ok' else 'failed'}\n"
        f"OpenTofu: {apply_status}\n"
        f"Ansible: {ansible_status}"
    )


async def _notify_pipeline(job: dict[str, Any], result: dict[str, Any]) -> None:
    project = await _load_project(job["project_id"])
    if project is None:
        return
    await telegram_notifications.notify_project(project, get_settings(), _pipeline_message(project, result))


async def _run_pipeline_job(job_id: str) -> None:
    job = await _start_job(job_id)
    if job is None:
        return
    settings = get_settings()
    params = job.get("params") or {}
    selected_modules = params.get("selected_modules") or []
    intent = params.get("intent")
    options = params.get("options") if isinstance(params.get("options"), dict) else {}
    policy_override = bool(options.get("override_policy", False))
    await _emit(job_id, {"type": "pipeline.start", "selected_modules": selected_modules})
    apply_status = "failed"
    apply_results: list[dict[str, Any]] = []
    async for event in opentofu_deploy.apply_modules_stream(
        project_id=job["project_id"],
        settings=settings,
        selected_modules=selected_modules,
        intent=intent,
        policy_override=policy_override,
        cancel_checker=lambda: _should_cancel(job_id),
    ):
        await _emit(job_id, event)
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
            "ansible": None,
        }
        await _emit(job_id, {"type": "pipeline.done", "status": "failed"})
        await jobs_service.mark_job_terminal(
            job_id=job_id, status="failed", result=failed_result, error={"message": "pipeline apply stage failed"}
        )
        await _notify_pipeline(job, failed_result)
        return
    ansible_status = "failed"
    ansible_results: list[dict[str, Any]] = []
    ansible_attempts = 1
    async for event in ansible_deploy.run_playbook_stream(
        project_id=job["project_id"],
        settings=settings,
        selected_modules=selected_modules,
        intent=intent,
        cancel_checker=lambda: _should_cancel(job_id),
    ):
        await _emit(job_id, event)
        if event.get("type") == "config.done":
            ansible_status = str(event.get("status") or "failed")
            ansible_results = event.get("results") if isinstance(event.get("results"), list) else []
            ansible_attempts = int(event.get("attempts", 1) or 1)
    final_ok = ansible_status == "ok"
    final_result = {
        "status": "ok" if final_ok else "failed",
        "apply": {"status": apply_status, "results": apply_results},
        "ansible": {"status": ansible_status, "results": ansible_results, "attempts": ansible_attempts},
    }
    await _emit(job_id, {"type": "pipeline.done", "status": final_result["status"]})
    await jobs_service.mark_job_terminal(
        job_id=job_id,
        status="succeeded" if final_ok else "failed",
        result=final_result,
        error=None if final_ok else {"message": "pipeline config stage failed"},
    )
    await _notify_pipeline(job, final_result)


def _chat_result_text(result: dict[str, Any] | None, *, limit: int = 3200) -> str:
    if not isinstance(result, dict):
        return ""
    text = str(result.get("text") or "").strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit]}..."


def _chat_message(project: Project, result: dict[str, Any] | None) -> str:
    text = _chat_result_text(result)
    if not text:
        return f"[{project.name} | {project.id}] Agent finished with no response text."
    return f"[{project.name} | {project.id}] Agent response\n{text}"


async def _notify_chat(job: dict[str, Any], result: dict[str, Any] | None) -> None:
    project = await _load_project(job["project_id"])
    if project is None:
        return
    await telegram_notifications.notify_project(project, get_settings(), _chat_message(project, result))


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
    async for event in chat_service.stream_response_events(
        payload,
        settings,
        cancel_checker=lambda: _should_cancel(job_id),
    ):
        await _emit(job_id, event)
        if event.get("type") == "text.delta":
            text_parts.append(str(event.get("delta") or ""))
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
    refreshed = await _job_or_none(job_id)
    options = (refreshed or {}).get("params", {}).get("options", {})
    if isinstance(options, dict) and bool(options.get("notify_telegram")):
        await _notify_chat(job, result)


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
