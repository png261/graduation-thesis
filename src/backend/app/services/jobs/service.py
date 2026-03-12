from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator
from uuid import uuid4

from celery.result import AsyncResult
from fastapi import Request
from sqlalchemy import Select, func, select
from sqlalchemy.exc import IntegrityError

from app import db
from app.core.config import Settings, get_settings
from app.models import Project, ProjectJob
from app.services.jobs import redis_bus
from app.services.jobs.errors import JobConflictError, JobNotFoundError, JobValidationError
from app.services.jobs.types import ACTIVE_JOB_STATUSES, FINAL_JOB_STATUSES, MUTATING_JOB_KINDS
from app.services.jobs.validation import parse_job_payload


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _parse_payload(kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    parsed = parse_job_payload(kind, payload)
    options = parsed.get("options")
    if (
        isinstance(options, dict)
        and "override_policy" in options
        and not isinstance(options.get("override_policy"), bool)
    ):
        raise JobValidationError("options.override_policy must be a boolean")
    return parsed


def serialize_job(job: ProjectJob) -> dict[str, Any]:
    return {
        "id": job.id,
        "project_id": job.project_id,
        "user_id": job.user_id,
        "kind": job.kind,
        "status": job.status,
        "params": job.params_json or {},
        "result": job.result_json,
        "error": job.error_json,
        "event_tail": job.event_tail_json or [],
        "celery_task_id": job.celery_task_id,
        "rerun_of_job_id": job.rerun_of_job_id,
        "created_at": _iso(job.created_at),
        "started_at": _iso(job.started_at),
        "finished_at": _iso(job.finished_at),
        "cancel_requested_at": _iso(job.cancel_requested_at),
    }


async def _has_mutating_conflict(project_id: str) -> bool:
    async with db.get_session() as session:
        result = await session.execute(
            select(func.count(ProjectJob.id)).where(
                ProjectJob.project_id == project_id,
                ProjectJob.kind.in_(tuple(MUTATING_JOB_KINDS)),
                ProjectJob.status.in_(tuple(ACTIVE_JOB_STATUSES)),
            )
        )
        return int(result.scalar() or 0) > 0


async def enqueue_project_job(
    *,
    project: Project,
    kind: str,
    payload: dict[str, Any],
    rerun_of_job_id: str | None = None,
) -> dict[str, Any]:
    parsed = _parse_payload(kind, payload)
    if kind in MUTATING_JOB_KINDS and await _has_mutating_conflict(project.id):
        raise JobConflictError()
    job = ProjectJob(
        id=str(uuid4()),
        project_id=project.id,
        user_id=str(project.user_id or ""),
        kind=kind,
        status="queued",
        params_json=parsed,
        result_json=None,
        error_json=None,
        event_tail_json=[],
        rerun_of_job_id=rerun_of_job_id,
    )
    try:
        async with db.get_session() as session:
            session.add(job)
            await session.flush()
    except IntegrityError as exc:
        raise JobConflictError() from exc
    await append_job_event_by_id(job.id, {"type": "job.queued", "kind": kind})
    celery_task_id = enqueue_celery_task(job.id, kind)
    if celery_task_id:
        await set_job_celery_task(job.id, celery_task_id)
    return await get_job_by_id(project.id, str(project.user_id or ""), job.id)


def enqueue_celery_task(job_id: str, kind: str) -> str | None:
    from app.services.jobs import tasks

    handlers = {
        "plan": tasks.run_plan,
        "apply": tasks.run_apply,
        "ansible": tasks.run_ansible,
        "graph": tasks.run_graph,
        "cost": tasks.run_cost,
        "pipeline": tasks.run_pipeline,
        "chat": tasks.run_chat,
    }
    handler = handlers.get(kind)
    if handler is None:
        return None
    task = handler.delay(job_id)
    return str(task.id)


async def set_job_celery_task(job_id: str, celery_task_id: str) -> None:
    async with db.get_session() as session:
        job = await session.get(ProjectJob, job_id)
        if job is None:
            return
        job.celery_task_id = celery_task_id
        await session.flush()


async def merge_job_options(job_id: str, options: dict[str, Any]) -> None:
    if not options:
        return
    async with db.get_session() as session:
        job = await session.get(ProjectJob, job_id)
        if job is None:
            return
        params = dict(job.params_json or {})
        current_options = params.get("options") if isinstance(params.get("options"), dict) else {}
        params["options"] = {**current_options, **options}
        job.params_json = params
        await session.flush()


def _job_query(project_id: str, user_id: str) -> Select[tuple[ProjectJob]]:
    return select(ProjectJob).where(ProjectJob.project_id == project_id, ProjectJob.user_id == user_id)


async def list_jobs(
    *,
    project_id: str,
    user_id: str,
    status: str | None,
    kind: str | None,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    base = _job_query(project_id, user_id)
    conditions = []
    if status:
        conditions.append(ProjectJob.status == status)
    if kind:
        conditions.append(ProjectJob.kind == kind)
    stmt = (
        base.where(*conditions)
        .order_by(ProjectJob.created_at.desc())
        .offset(max(offset, 0))
        .limit(max(1, min(limit, 100)))
    )
    count_stmt = select(func.count(ProjectJob.id)).where(
        ProjectJob.project_id == project_id, ProjectJob.user_id == user_id, *conditions
    )
    async with db.get_session() as session:
        rows = (await session.execute(stmt)).scalars().all()
        total = int((await session.execute(count_stmt)).scalar() or 0)
    return {"total": total, "items": [serialize_job(row) for row in rows]}


async def _load_job(project_id: str, user_id: str, job_id: str) -> ProjectJob:
    async with db.get_session() as session:
        result = await session.execute(
            select(ProjectJob).where(
                ProjectJob.id == job_id,
                ProjectJob.project_id == project_id,
                ProjectJob.user_id == user_id,
            )
        )
        job = result.scalar_one_or_none()
    if job is None:
        raise JobNotFoundError()
    return job


async def get_job_by_id(project_id: str, user_id: str, job_id: str) -> dict[str, Any]:
    job = await _load_job(project_id, user_id, job_id)
    return serialize_job(job)


async def request_cancel(
    *,
    project_id: str,
    user_id: str,
    job_id: str,
) -> dict[str, Any]:
    async with db.get_session() as session:
        result = await session.execute(
            select(ProjectJob).where(
                ProjectJob.id == job_id,
                ProjectJob.project_id == project_id,
                ProjectJob.user_id == user_id,
            )
        )
        job = result.scalar_one_or_none()
        if job is None:
            raise JobNotFoundError()
        if job.status in FINAL_JOB_STATUSES:
            return serialize_job(job)
        job.cancel_requested_at = _now()
        if job.status == "queued":
            job.status = "canceled"
            job.finished_at = _now()
        await session.flush()
        serialized = serialize_job(job)
    if serialized.get("celery_task_id"):
        AsyncResult(serialized["celery_task_id"]).revoke(terminate=True, signal="SIGTERM")
    if serialized["status"] == "canceled":
        await append_job_event_by_id(job_id, {"type": "job.canceled", "reason": "cancel_requested"})
        await append_job_event_by_id(job_id, {"type": "job.terminal", "status": "canceled"})
    else:
        await append_job_event_by_id(job_id, {"type": "job.cancel_requested"})
    return serialized


async def rerun_job(*, project: Project, source_job_id: str) -> dict[str, Any]:
    source = await _load_job(project.id, str(project.user_id or ""), source_job_id)
    payload = source.params_json if isinstance(source.params_json, dict) else {}
    return await enqueue_project_job(
        project=project,
        kind=source.kind,
        payload=payload,
        rerun_of_job_id=source.id,
    )


async def append_job_event_by_id(job_id: str, event: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    record = await redis_bus.publish_job_event(settings=settings, job_id=job_id, event=event)
    async with db.get_session() as session:
        job = await session.get(ProjectJob, job_id)
        if job is None:
            return record
        tail = list(job.event_tail_json or [])
        tail.append(record)
        if len(tail) > settings.jobs_event_tail_limit:
            tail = tail[-settings.jobs_event_tail_limit :]
        job.event_tail_json = tail
        await session.flush()
    return record


async def mark_job_running(job_id: str) -> dict[str, Any] | None:
    async with db.get_session() as session:
        job = await session.get(ProjectJob, job_id)
        if job is None:
            return None
        if job.status in FINAL_JOB_STATUSES:
            return serialize_job(job)
        job.status = "running"
        if job.started_at is None:
            job.started_at = _now()
        await session.flush()
    await append_job_event_by_id(job_id, {"type": "job.running"})
    return await get_job_by_global_id(job_id)


async def mark_job_terminal(
    *,
    job_id: str,
    status: str,
    result: dict[str, Any] | None,
    error: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if status not in FINAL_JOB_STATUSES:
        raise JobValidationError(f"Unsupported terminal status '{status}'")
    async with db.get_session() as session:
        job = await session.get(ProjectJob, job_id)
        if job is None:
            return None
        job.status = status
        job.result_json = result
        job.error_json = error
        if job.started_at is None:
            job.started_at = _now()
        job.finished_at = _now()
        await session.flush()
        serialized = serialize_job(job)
    await append_job_event_by_id(job_id, {"type": "job.terminal", "status": status})
    return serialized


async def get_job_by_global_id(job_id: str) -> dict[str, Any] | None:
    async with db.get_session() as session:
        job = await session.get(ProjectJob, job_id)
        if job is None:
            return None
        return serialize_job(job)


async def is_cancel_requested(job_id: str) -> bool:
    async with db.get_session() as session:
        job = await session.get(ProjectJob, job_id)
        if job is None:
            return False
        return bool(job.cancel_requested_at)


async def stream_job_events(
    *,
    project_id: str,
    user_id: str,
    job_id: str,
    request: Request,
    from_seq: int = 0,
) -> AsyncIterator[str]:
    settings = get_settings()
    job = await _load_job(project_id, user_id, job_id)
    replay = await redis_bus.load_replay_events(settings=settings, job_id=job_id, from_seq=from_seq)
    last_seq = from_seq
    if not replay:
        for event in list(job.event_tail_json or []):
            seq = int(event.get("seq", 0) or 0)
            if seq <= from_seq:
                continue
            replay.append(event)
    for event in replay:
        seq = int(event.get("seq", 0) or 0)
        last_seq = max(last_seq, seq)
        yield f"data: {json.dumps(event)}\n\n"
    if job.status in FINAL_JOB_STATUSES:
        return
    try:
        redis = await redis_bus.get_redis(settings)
        pubsub = redis.pubsub(ignore_subscribe_messages=True)
        await pubsub.subscribe(redis_bus.events_channel(job_id))
    except Exception:
        pubsub = None
    while True:
        if await request.is_disconnected():
            break
        current = await get_job_by_global_id(job_id)
        if current and current["status"] in FINAL_JOB_STATUSES and pubsub is None:
            break
        if pubsub is None:
            await asyncio.sleep(1.0)
            continue
        message = await pubsub.get_message(timeout=1.0)
        if not message:
            if current and current["status"] in FINAL_JOB_STATUSES:
                break
            continue
        data = message.get("data")
        if not isinstance(data, str):
            continue
        try:
            event = json.loads(data)
        except json.JSONDecodeError:
            continue
        seq = int(event.get("seq", 0) or 0)
        if seq <= last_seq:
            continue
        last_seq = seq
        yield f"data: {json.dumps(event)}\n\n"
        if event.get("type") == "job.terminal":
            break
    if pubsub is not None:
        await pubsub.unsubscribe(redis_bus.events_channel(job_id))
        await pubsub.aclose()


async def cleanup_old_jobs(settings: Settings) -> int:
    cutoff = _now() - timedelta(days=max(1, settings.jobs_history_retention_days))
    async with db.get_session() as session:
        rows = await session.execute(
            select(ProjectJob).where(ProjectJob.finished_at.is_not(None), ProjectJob.finished_at < cutoff)
        )
        deleted = 0
        for job in rows.scalars().all():
            await session.delete(job)
            deleted += 1
        await session.flush()
    return deleted
