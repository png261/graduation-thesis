from __future__ import annotations

from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "deepagents_jobs",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["app.services.jobs.tasks", "app.services.state_backends.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    task_track_started=True,
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "state-backends-sync-due": {
            "task": "state_backends.sync_due",
            "schedule": max(300, settings.state_sync_scan_interval_minutes * 60),
        },
        "jobs-cleanup-history": {
            "task": "jobs.cleanup_history",
            "schedule": 6 * 60 * 60,
        },
    },
)
